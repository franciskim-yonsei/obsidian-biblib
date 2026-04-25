import { Platform } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { PtyManager, getPreferredWindowsBackend } from "./pty-manager";
import type { WindowsTerminalBackend } from "./pty-manager";
import { DirectProcessManager } from "./direct-process-manager";
import { getTheme } from "./themes";
import type { TerminalPluginSettings } from "./settings";
import type { BinaryManager } from "./binary-manager";

/**
 * Subset of PtyManager's surface that a tab needs once spawned. Shared by
 * PtyManager (shell tabs through node-pty/ConPTY) and DirectProcessManager
 * (direct child_process.spawn tabs that bypass the PTY layer).
 */
export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (info: { exitCode: number; signal?: number }) => void): void;
  kill(): void;
  readonly pid: number | undefined;
}

export const TAB_COLORS = [
  { name: "None", value: "" },
  { name: "Red", value: "#e54d4d" },
  { name: "Orange", value: "#e8a838" },
  { name: "Yellow", value: "#e5d74e" },
  { name: "Green", value: "#4ec955" },
  { name: "Blue", value: "#4e9de5" },
  { name: "Purple", value: "#b04ee5" },
] as const;

export interface TerminalSession {
  id: string;
  name: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  pty: TerminalProcess;
  syncGate: SynchronizedOutputGate;
  containerEl: HTMLElement;
  color: string;
  kind: "shell" | "direct";
}

let sessionCounter = 0;

function getWindowsPtyOptions(
  backend: WindowsTerminalBackend | undefined = getPreferredWindowsBackend()
):
  | {
      backend: WindowsTerminalBackend;
      buildNumber?: number;
    }
  | undefined {
  if (!Platform.isWin || !backend) return undefined;

  try {
    const os = (window as any).require("os");
    const rawBuild = os.release().split(".").pop();
    const buildNumber = rawBuild ? Number.parseInt(rawBuild, 10) : Number.NaN;
    return Number.isFinite(buildNumber)
      ? { backend, buildNumber }
      : { backend };
  } catch {
    return { backend };
  }
}

const SYNCHRONIZED_OUTPUT_TIMEOUT_MS = 100;
const CONTROL_SEQUENCE_SCAN_TAIL_LENGTH = 128;

let syncGateCounter = 0;

type SynchronizedOutputMarker = {
  start: number;
  end: number;
  final: "h" | "l";
};

/**
 * Implements DECSET 2026 synchronized output for xterm.js.
 *
 * Windows Terminal honors \x1b[?2026h / \x1b[?2026l by withholding paints
 * until the synchronized block ends. xterm.js 5.5 does not currently implement
 * that mode. This shim does two targeted things:
 *
 * 1. If a synchronized block is split across PTY chunks, buffer the block and
 *    hand it to xterm as one write when the end marker arrives. This prevents
 *    parser-side side effects like viewport scrolling from leaking between the
 *    clear phase and the draw phase.
 * 2. While xterm parses a completed synchronized block, suppress renderer row
 *    refreshes and flush one coalesced refresh after the write callback fires.
 */
class SynchronizedOutputGate {
  private readonly renderService: any | null;
  private readonly debugId = ++syncGateCounter;
  private readonly originalRefreshRows: ((start: number, end: number, isRedrawOnly?: boolean) => void) | null = null;
  private readonly originalRenderRows: ((start: number, end: number) => void) | null = null;
  private readonly originalHandleCursorMove: (() => void) | null = null;
  private readonly originalClear: (() => void) | null = null;
  private scanTail = "";
  private buffering = false;
  private bufferedData = "";
  private paused = false;
  private disposed = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSynchronizedWrites = 0;
  private queuedStart: number | null = null;
  private queuedEnd: number | null = null;
  private needsCursorRefresh = false;
  private needsClear = false;
  private readonly stats = {
    writes: 0,
    chars: 0,
    beginMarkers: 0,
    endMarkers: 0,
    bufferedBlocks: 0,
    bufferedChars: 0,
    flushedBlocks: 0,
    bufferTimeouts: 0,
    renderPauses: 0,
    renderTimeouts: 0,
    renderFlushes: 0,
    queuedRefreshes: 0,
    queuedCursorMoves: 0,
    queuedClears: 0,
    maxQueuedRows: 0,
  };

  constructor(private readonly terminal: Terminal) {
    const core = (terminal as any)._core;
    this.renderService = core?._renderService ?? null;

    if (this.renderService) {
      if (typeof this.renderService.refreshRows === "function") {
        this.originalRefreshRows = this.renderService.refreshRows.bind(this.renderService);
        this.renderService.refreshRows = (start: number, end: number, isRedrawOnly?: boolean) => {
          if (this.paused) {
            this.queueRows(start, end);
            return;
          }
          this.originalRefreshRows?.(start, end, isRedrawOnly);
        };
      }

      if (typeof this.renderService._renderRows === "function") {
        this.originalRenderRows = this.renderService._renderRows.bind(this.renderService);
        this.renderService._renderRows = (start: number, end: number) => {
          if (this.paused) {
            this.queueRows(start, end);
            return;
          }
          this.originalRenderRows?.(start, end);
        };
      }

      if (typeof this.renderService.handleCursorMove === "function") {
        this.originalHandleCursorMove = this.renderService.handleCursorMove.bind(this.renderService);
        this.renderService.handleCursorMove = () => {
          if (this.paused) {
            this.needsCursorRefresh = true;
            this.stats.queuedCursorMoves++;
            return;
          }
          this.originalHandleCursorMove?.();
        };
      }

      if (typeof this.renderService.clear === "function") {
        this.originalClear = this.renderService.clear.bind(this.renderService);
        this.renderService.clear = () => {
          if (this.paused) {
            this.needsClear = true;
            this.queueRows(0, Math.max(0, this.terminal.rows - 1));
            this.stats.queuedClears++;
            return;
          }
          this.originalClear?.();
        };
      }
    }

    this.registerDebugHandle();
  }

  write(data: string): void {
    if (this.disposed) return;

    this.stats.writes++;
    this.stats.chars += data.length;

    const markers = this.findSynchronizedOutputMarkers(data);
    if (markers.length === 0) {
      if (this.buffering) {
        this.appendBufferedData(data);
      } else {
        this.writeThrough(data);
      }
      return;
    }

    let cursor = 0;
    for (const marker of markers) {
      if (marker.end < cursor) continue;

      if (marker.final === "h") {
        if (this.buffering) {
          this.appendBufferedData(data.slice(cursor, marker.end));
        } else {
          this.writeThrough(data.slice(cursor, marker.start));
          this.startBuffering();
          this.appendBufferedData(data.slice(marker.start, marker.end));
        }
        cursor = marker.end;
      } else {
        if (this.buffering) {
          this.appendBufferedData(data.slice(cursor, marker.end));
          this.flushBufferedBlock(false);
        } else {
          // Unmatched end marker. Pass it through; xterm will ignore the
          // unsupported private mode, matching its baseline behavior.
          this.writeThrough(data.slice(cursor, marker.end));
        }
        cursor = marker.end;
      }
    }

    const remaining = data.slice(cursor);
    if (this.buffering) {
      this.appendBufferedData(remaining);
    } else {
      this.writeThrough(remaining);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimeoutTimer();
    this.unregisterDebugHandle();
    this.buffering = false;
    this.bufferedData = "";
    this.pendingSynchronizedWrites = 0;

    if (this.renderService) {
      if (this.originalRefreshRows) this.renderService.refreshRows = this.originalRefreshRows;
      if (this.originalRenderRows) this.renderService._renderRows = this.originalRenderRows;
      if (this.originalHandleCursorMove) this.renderService.handleCursorMove = this.originalHandleCursorMove;
      if (this.originalClear) this.renderService.clear = this.originalClear;
    }

    if (this.paused) {
      this.paused = false;
      this.flushQueuedRefresh();
    }
  }

  getDebugStats(): Record<string, number | boolean> {
    return {
      id: this.debugId,
      buffering: this.buffering,
      paused: this.paused,
      pendingSynchronizedWrites: this.pendingSynchronizedWrites,
      heldChars: this.bufferedData.length,
      queuedStart: this.queuedStart ?? -1,
      queuedEnd: this.queuedEnd ?? -1,
      ...this.stats,
    };
  }

  private findSynchronizedOutputMarkers(data: string): SynchronizedOutputMarker[] {
    const previousTail = this.scanTail;
    const scanData = previousTail + data;
    const previousTailLength = previousTail.length;
    const markers: SynchronizedOutputMarker[] = [];
    const sequencePattern = /\x1b\[\?([0-9;]*)([hl])/g;
    let match: RegExpExecArray | null;

    while ((match = sequencePattern.exec(scanData)) !== null) {
      const matchEnd = match.index + match[0].length;
      if (matchEnd <= previousTailLength) continue;
      if (!match[1].split(";").includes("2026")) continue;

      const final = match[2] as "h" | "l";
      const start = Math.max(0, match.index - previousTailLength);
      const end = Math.max(0, matchEnd - previousTailLength);
      markers.push({ start, end, final });
      if (final === "h") this.stats.beginMarkers++;
      else this.stats.endMarkers++;
    }

    this.scanTail = scanData.slice(-CONTROL_SEQUENCE_SCAN_TAIL_LENGTH);
    return markers;
  }

  private startBuffering(): void {
    this.buffering = true;
    this.stats.bufferedBlocks++;
    this.resetBufferTimeout();
  }

  private appendBufferedData(data: string): void {
    if (!data) return;
    this.bufferedData += data;
    this.stats.bufferedChars += data.length;
    this.resetBufferTimeout();
  }

  private flushBufferedBlock(timedOut: boolean): void {
    const data = this.bufferedData;
    this.buffering = false;
    this.bufferedData = "";
    this.clearTimeoutTimer();

    if (timedOut) {
      this.stats.bufferTimeouts++;
    }
    if (!data) return;

    this.stats.flushedBlocks++;
    this.writeThrough(data, true);
  }

  private writeThrough(data: string, synchronizedBlock = false): void {
    if (!data || this.disposed) return;

    if (!synchronizedBlock) {
      this.terminal.write(data);
      return;
    }

    this.pendingSynchronizedWrites++;
    this.beginRenderPause();
    this.terminal.write(data, () => {
      this.pendingSynchronizedWrites = Math.max(0, this.pendingSynchronizedWrites - 1);
      if (this.pendingSynchronizedWrites === 0 && !this.buffering) {
        this.endRenderPause();
      }
    });
  }

  private beginRenderPause(): void {
    if (!this.renderService || this.disposed) return;

    if (!this.paused) {
      this.paused = true;
      this.stats.renderPauses++;
    }
    this.clearTimeoutTimer();
    this.timeoutTimer = setTimeout(() => {
      this.stats.renderTimeouts++;
      this.pendingSynchronizedWrites = 0;
      this.endRenderPause();
    }, SYNCHRONIZED_OUTPUT_TIMEOUT_MS);
  }

  private endRenderPause(): void {
    if (this.disposed) return;

    this.clearTimeoutTimer();
    if (!this.paused) return;

    this.flushQueuedRefresh();
    this.paused = false;
  }

  private resetBufferTimeout(): void {
    this.clearTimeoutTimer();
    this.timeoutTimer = setTimeout(() => {
      this.flushBufferedBlock(true);
    }, SYNCHRONIZED_OUTPUT_TIMEOUT_MS);
  }

  private queueRows(start: number, end: number): void {
    this.queuedStart = this.queuedStart === null ? start : Math.min(this.queuedStart, start);
    this.queuedEnd = this.queuedEnd === null ? end : Math.max(this.queuedEnd, end);
    this.stats.queuedRefreshes++;
    if (this.queuedStart !== null && this.queuedEnd !== null) {
      this.stats.maxQueuedRows = Math.max(this.stats.maxQueuedRows, this.queuedEnd - this.queuedStart + 1);
    }
  }

  private flushQueuedRefresh(): void {
    try {
      const start = this.queuedStart ?? 0;
      const end = this.queuedEnd ?? Math.max(0, this.terminal.rows - 1);
      const needsClear = this.needsClear;
      this.queuedStart = null;
      this.queuedEnd = null;
      this.needsClear = false;
      this.stats.renderFlushes++;
      if (needsClear) {
        this.originalClear?.();
      }
      this.originalRefreshRows?.(start, end);
      if (this.needsCursorRefresh) {
        this.needsCursorRefresh = false;
        this.originalHandleCursorMove?.();
      }
    } catch (err) {
      console.warn("Terminal: failed to flush synchronized output refresh", err);
    }
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private registerDebugHandle(): void {
    try {
      const target = window as any;
      const gates = target.leanTerminalSyncGates instanceof Map
        ? target.leanTerminalSyncGates as Map<number, SynchronizedOutputGate>
        : new Map<number, SynchronizedOutputGate>();
      gates.set(this.debugId, this);
      target.leanTerminalSyncGates = gates;
      target.leanTerminalSyncStats = () => Array.from(gates.values()).map((gate) => gate.getDebugStats());
    } catch {
      // Debug handle is best-effort only.
    }
  }

  private unregisterDebugHandle(): void {
    try {
      const gates = (window as any).leanTerminalSyncGates;
      if (gates instanceof Map) gates.delete(this.debugId);
    } catch {
      // Debug handle is best-effort only.
    }
  }
}

export class TerminalTabManager {
  private sessions: TerminalSession[] = [];
  private activeId: string | null = null;
  private tabBarEl: HTMLElement;
  private terminalHostEl: HTMLElement;
  private bottomBarEl: HTMLElement;
  private settings: TerminalPluginSettings;
  private cwd: string;
  private pluginDir: string;
  private binaryManager: BinaryManager;
  private onActiveChange?: () => void;
  private onTabsEmpty?: () => void;

  constructor(
    tabBarEl: HTMLElement,
    terminalHostEl: HTMLElement,
    bottomBarEl: HTMLElement,
    settings: TerminalPluginSettings,
    cwd: string,
    pluginDir: string,
    binaryManager: BinaryManager,
    onActiveChange?: () => void,
    onTabsEmpty?: () => void
  ) {
    this.tabBarEl = tabBarEl;
    this.terminalHostEl = terminalHostEl;
    this.bottomBarEl = bottomBarEl;
    this.settings = settings;
    this.cwd = cwd;
    this.pluginDir = pluginDir;
    this.binaryManager = binaryManager;
    this.onActiveChange = onActiveChange;
    this.onTabsEmpty = onTabsEmpty;
    this.renderBottomBar();
  }

  createTab(): TerminalSession {
    const pty = new PtyManager(this.pluginDir);
    const session = this.buildSession({
      kind: "shell",
      labelPrefix: "Terminal",
      process: pty,
      useWindowsPty: true,
    });

    setTimeout(() => {
      try { session.fitAddon.fit(); } catch { /* ignore */ }

      const cols = session.terminal.cols || 80;
      const rows = session.terminal.rows || 24;

      if (!this.binaryManager.isReady()) {
        session.terminal.write("\r\n\x1b[33mTerminal binaries not installed.\x1b[0m\r\n");
        session.terminal.write("Go to Settings \u2192 Terminal to download them.\r\n");
        return;
      }

      try {
        const backend = pty.spawn(this.settings.shellPath, this.cwd, cols, rows, undefined, {
          conptyPassthrough: this.settings.conptyPassthrough,
        });
        if (Platform.isWin) {
          session.terminal.options.windowsPty = getWindowsPtyOptions(backend);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        console.error("Terminal: failed to spawn shell", err);
        session.terminal.write(`\r\nFailed to spawn shell: ${message}\r\n`);
        return;
      }

      this.wireProcess(session);
    }, 100);

    return session;
  }

  /**
   * Creates a tab whose process is spawned with `child_process.spawn` and piped
   * stdio rather than node-pty/ConPTY. Used as an escape hatch for TUIs whose
   * synchronized output stream is degraded by ConPTY's reserialization (the
   * `pi` flicker case documented in diagnostics/README.md).
   */
  createDirectTab(commandLine: string, displayName?: string): TerminalSession {
    const trimmed = commandLine.trim();
    if (!trimmed) {
      throw new Error("Direct-process command line is empty.");
    }

    const direct = new DirectProcessManager(this.pluginDir);
    const label = displayName?.trim() || trimmed.split(/\s+/)[0] || "Direct";
    const session = this.buildSession({
      kind: "direct",
      labelPrefix: label,
      process: direct,
      useWindowsPty: false,
    });

    setTimeout(() => {
      try { session.fitAddon.fit(); } catch { /* ignore */ }

      const cols = session.terminal.cols || 80;
      const rows = session.terminal.rows || 24;

      try {
        direct.spawn(trimmed, this.cwd, cols, rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        console.error("Terminal: failed to spawn direct process", err);
        session.terminal.write(`\r\nFailed to spawn process: ${message}\r\n`);
        return;
      }

      this.wireProcess(session);
    }, 100);

    return session;
  }

  private buildSession(opts: {
    kind: "shell" | "direct";
    labelPrefix: string;
    process: TerminalProcess;
    useWindowsPty: boolean;
  }): TerminalSession {
    sessionCounter++;
    const id = `terminal-${sessionCounter}`;
    const name = `${opts.labelPrefix} ${sessionCounter}`;

    const containerEl = this.terminalHostEl.createDiv({ cls: "terminal-session" });

    const theme = getTheme(this.settings.theme);
    if (this.settings.backgroundColor) {
      theme.background = this.settings.backgroundColor;
    }
    const terminal = new Terminal({
      fontSize: this.settings.fontSize,
      fontFamily: this.settings.fontFamily,
      cursorBlink: this.settings.cursorBlink,
      scrollback: this.settings.scrollback,
      theme,
      ...(opts.useWindowsPty ? { windowsPty: getWindowsPtyOptions() } : {}),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerEl);

    // Intercept clipboard shortcuts — Obsidian captures them before xterm.js.
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const mod = e.metaKey || e.ctrlKey;

      if (e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        const s = this.sessions.find((s) => s.id === id);
        if (s) s.pty.write("\n");
        return false;
      }

      if ((mod && e.key === "v") || (e.shiftKey && e.key === "Insert")) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) {
            const s = this.sessions.find((s) => s.id === id);
            if (s) s.pty.write(text);
          }
        }).catch(() => { /* clipboard unavailable */ });
        return false;
      }

      if (mod && e.key === "c" && terminal.hasSelection()) {
        const text = terminal
          .getSelection()
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n");
        navigator.clipboard.writeText(text).catch(() => { /* clipboard unavailable */ });
        terminal.clearSelection();
        return false;
      }

      return true;
    });

    const syncGate = new SynchronizedOutputGate(terminal);
    const session: TerminalSession = {
      id, name, terminal, fitAddon, pty: opts.process, syncGate, containerEl, color: "",
      kind: opts.kind,
    };
    this.sessions.push(session);
    this.switchTab(id);
    this.renderTabBar();
    this.renderBottomBar();

    return session;
  }

  private wireProcess(session: TerminalSession): void {
    // PTY/process -> xterm via SynchronizedOutputGate (DECSET 2026 shim).
    session.pty.onData((data: string) => {
      session.syncGate.write(data);
    });
    session.terminal.onData((data: string) => {
      session.pty.write(data);
    });
    session.pty.onExit(() => {
      this.closeTab(session.id);
    });
  }

  switchTab(id: string): void {
    this.activeId = id;

    for (const session of this.sessions) {
      if (session.id === id) {
        session.containerEl.removeClass("terminal-session-hidden");
        // Fit after showing
        setTimeout(() => {
          try {
            session.fitAddon.fit();
            session.pty.resize(session.terminal.cols, session.terminal.rows);
            session.terminal.focus();
          } catch {
            // ignore
          }
        }, 10);
      } else {
        session.containerEl.addClass("terminal-session-hidden");
      }
    }

    this.renderTabBar();
    this.onActiveChange?.();
  }

  closeTab(id: string): void {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;

    const session = this.sessions[idx];
    session.syncGate.dispose();
    session.pty.kill();
    session.terminal.dispose();
    session.containerEl.remove();
    this.sessions.splice(idx, 1);

    // Switch to adjacent tab if we closed the active one
    if (this.activeId === id) {
      if (this.sessions.length > 0) {
        const newIdx = Math.min(idx, this.sessions.length - 1);
        this.switchTab(this.sessions[newIdx].id);
      } else {
        this.activeId = null;
      }
    }

    if (this.sessions.length === 0 && this.onTabsEmpty) {
      this.onTabsEmpty();
      return;
    }

    this.renderTabBar();
    this.renderBottomBar();
  }

  fitActive(): void {
    const active = this.getActiveSession();
    if (!active) return;
    try {
      active.fitAddon.fit();
      active.pty.resize(active.terminal.cols, active.terminal.rows);
    } catch {
      // ignore
    }
  }

  getActiveSession(): TerminalSession | null {
    return this.sessions.find((s) => s.id === this.activeId) || null;
  }

  getSessions(): TerminalSession[] {
    return this.sessions;
  }

  destroyAll(): void {
    for (const session of this.sessions) {
      session.syncGate.dispose();
      session.pty.kill();
      session.terminal.dispose();
      session.containerEl.remove();
    }
    this.sessions = [];
    this.activeId = null;
  }

  private renderBottomBar(): void {
    this.bottomBarEl.empty();

    const hasSession = this.sessions.length > 0;
    const dot = this.bottomBarEl.createDiv({ cls: "terminal-bottom-indicator" });
    if (!hasSession) dot.classList.add("inactive");

    this.bottomBarEl.createSpan({ text: this.getShellDisplayName() });
  }

  private getShellDisplayName(): string {
    const path = this.settings.shellPath.trim();
    if (!path) {
      return Platform.isWin ? "pwsh" : "shell";
    }
    const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
    return base.replace(/\.exe$/i, "");
  }

  private renameTab(id: string, labelEl: HTMLElement): void {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    const input = document.createElement("input");
    input.type = "text";
    input.value = session.name;
    input.className = "terminal-tab-rename-input";

    labelEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newName = input.value.trim() || session.name;
      session.name = newName;
      this.renderTabBar();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = session.name;
        input.blur();
      }
    });
  }

  private showTabContextMenu(e: MouseEvent, sessionId: string, labelEl: HTMLElement): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // Remove any existing context menu
    document.querySelector(".terminal-tab-context-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "terminal-tab-context-menu";
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    // Rename option
    const renameItem = menu.createDiv({ cls: "terminal-ctx-item", text: "Rename" });
    renameItem.addEventListener("click", () => {
      menu.remove();
      this.renameTab(sessionId, labelEl);
    });

    // Color submenu
    menu.createDiv({ cls: "terminal-ctx-item terminal-ctx-color-label", text: "Color" });
    const colorRow = menu.createDiv({ cls: "terminal-ctx-color-row" });

    for (const c of TAB_COLORS) {
      const swatch = colorRow.createDiv({ cls: "terminal-ctx-swatch" });
      if (c.value) {
        swatch.style.background = c.value;
      } else {
        swatch.classList.add("terminal-ctx-swatch-none");
      }
      if (session.color === c.value) {
        swatch.classList.add("active");
      }
      swatch.title = c.name;
      swatch.addEventListener("click", () => {
        session.color = c.value;
        this.renderTabBar();
        menu.remove();
      });
    }

    document.body.appendChild(menu);

    // Close on click outside
    const close = (evt: MouseEvent) => {
      if (!menu.contains(evt.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close, true);
      }
    };
    setTimeout(() => document.addEventListener("click", close, true), 0);
  }

  updateBackgroundColor(): void {
    const theme = getTheme(this.settings.theme);
    if (this.settings.backgroundColor) {
      theme.background = this.settings.backgroundColor;
    }
    for (const session of this.sessions) {
      session.terminal.options.theme = { ...session.terminal.options.theme, background: theme.background };
    }
  }

  private renderTabBar(): void {
    this.tabBarEl.empty();

    for (const session of this.sessions) {
      const tab = this.tabBarEl.createDiv({
        cls: `terminal-tab${session.id === this.activeId ? " active" : ""}`,
      });

      // Apply tab color as left border + active highlight
      if (session.color) {
        tab.style.borderLeft = `3px solid ${session.color}`;
        tab.style.setProperty("--tab-accent", session.color);
      }

      const label = tab.createSpan({ cls: "terminal-tab-label", text: session.name });
      tab.addEventListener("click", () => this.switchTab(session.id));
      tab.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTabContextMenu(e, session.id, label);
      });

      const closeBtn = tab.createSpan({ cls: "terminal-tab-close", text: "\u00d7" });
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(session.id);
      });
    }

    const addBtn = this.tabBarEl.createDiv({ cls: "terminal-new-tab", text: "+" });
    addBtn.addEventListener("click", () => this.createTab());
  }
}
