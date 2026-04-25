import { Platform } from "obsidian";
import { ensureDirectProcessShim } from "./direct-process-shim";

function getElectronRequire(): any {
  const electronRequire = (window as any).require;
  if (!electronRequire) {
    throw new Error("Cannot access Electron require — this plugin only works on desktop.");
  }
  return electronRequire;
}

/**
 * Splits a command line into argv. Honors double quotes and backslash escapes.
 * Mirrors what users would expect when typing into a shell prompt without
 * routing through a real shell.
 */
export function parseCommandLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const ch of line) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) out.push(current);
  return out;
}

type DataCallback = (data: string) => void;
type ExitCallback = (info: { exitCode: number; signal?: number }) => void;

/**
 * Spawns a single command using `child_process.spawn` with piped stdio rather
 * than going through node-pty/ConPTY. Used for TUIs whose synchronized output
 * stream is degraded by ConPTY's reserialization (the documented `pi` case).
 *
 * Limitations vs PtyManager:
 * - No live resize signaling. Geometry is frozen at spawn time via env.
 * - Programs that demand a real TTY may misbehave; the Node stdio shim
 *   mitigates Node-based children but cannot fix arbitrary native binaries.
 */
export class DirectProcessManager {
  private child: any = null;
  private readonly pluginDir: string;
  private dataCallbacks: DataCallback[] = [];
  private exitCallbacks: ExitCallback[] = [];
  private decoder: any = null;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
  }

  spawn(
    commandLine: string,
    cwd: string,
    cols: number,
    rows: number,
    extraEnv?: Record<string, string>
  ): void {
    const argv = parseCommandLine(commandLine);
    if (argv.length === 0) {
      throw new Error("Direct-process command line is empty.");
    }

    const electronRequire = getElectronRequire();
    const childProcess = electronRequire("child_process");
    const fs = electronRequire("fs");
    const path = electronRequire("path");
    const StringDecoder = electronRequire("string_decoder").StringDecoder;

    const shimPath = ensureDirectProcessShim(this.pluginDir, fs, path);
    const shimOption = `--require=${shimPath}`;

    const env = {
      ...process.env,
      ...(process.env.COLORTERM ? {} : { COLORTERM: "truecolor" }),
      ...(process.env.TERM_PROGRAM ? {} : { TERM_PROGRAM: "Obsidian" }),
      ...(process.env.TERM ? {} : { TERM: "xterm-256color" }),
      COLUMNS: String(cols),
      LINES: String(rows),
      LEAN_TERMINAL_DIRECT_COLUMNS: String(cols),
      LEAN_TERMINAL_DIRECT_ROWS: String(rows),
      NODE_OPTIONS: process.env.NODE_OPTIONS
        ? `${process.env.NODE_OPTIONS} ${shimOption}`
        : shimOption,
      ...extraEnv,
    };

    const [file, ...args] = argv;
    this.child = childProcess.spawn(file, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      // shell:true on Windows so PATHEXT lookups (.cmd/.bat shims) work the
      // same way users see at a real prompt. macOS/Linux can spawn directly.
      shell: Platform.isWin,
      windowsHide: false,
    });

    this.decoder = new StringDecoder("utf8");

    this.child.stdout?.on("data", (chunk: Buffer) => {
      const text = this.decoder.write(chunk);
      if (text) this.emitData(text);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const text = this.decoder.write(chunk);
      if (text) this.emitData(text);
    });

    this.child.on("error", (err: Error) => {
      this.emitData(`\r\n[direct-process error] ${err.message}\r\n`);
    });
    this.child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      const tail = this.decoder?.end?.();
      if (tail) this.emitData(tail);
      const exitInfo = {
        exitCode: typeof code === "number" ? code : signal ? 1 : 0,
        signal: signal ? 1 : undefined,
      };
      for (const cb of this.exitCallbacks) {
        try { cb(exitInfo); } catch { /* ignore */ }
      }
      this.child = null;
    });
  }

  write(data: string): void {
    try {
      this.child?.stdin?.write(data);
    } catch {
      // Child may have closed stdin; ignore.
    }
  }

  resize(_cols: number, _rows: number): void {
    // No PTY in the loop — children only learn geometry at spawn time.
    // Nothing to do here. Kept to satisfy the TerminalProcess interface.
  }

  onData(callback: DataCallback): void {
    this.dataCallbacks.push(callback);
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  kill(): void {
    try {
      this.child?.kill();
    } catch {
      // already dead
    }
    this.child = null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  private emitData(text: string): void {
    for (const cb of this.dataCallbacks) {
      try { cb(text); } catch { /* ignore */ }
    }
  }
}
