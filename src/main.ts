import { App, FileSystemAdapter, Modal, Notice, Plugin, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL } from "./constants";
import { TerminalView } from "./terminal-view";
import { TerminalSettingTab, DEFAULT_SETTINGS, type TerminalPluginSettings } from "./settings";
import { BinaryManager } from "./binary-manager";

const DIRECT_PROCESS_DEFAULT_COMMAND = "pi --no-session";

export default class TerminalPlugin extends Plugin {
  settings: TerminalPluginSettings = DEFAULT_SETTINGS;
  binaryManager!: BinaryManager;
  pluginDir!: string;
  private ribbonEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    const path = (window as any).require("path");
    this.pluginDir = path.join(
      (this.app.vault.adapter as any).getBasePath(),
      ".obsidian",
      "plugins",
      this.manifest.id
    );

    this.binaryManager = new BinaryManager(this.pluginDir, this.manifest.version);
    await this.binaryManager.checkInstalled();

    this.registerView(VIEW_TYPE_TERMINAL, (leaf: WorkspaceLeaf) => {
      return new TerminalView(leaf, this);
    });

    this.ribbonEl = this.addRibbonIcon(this.settings.ribbonIcon, "Toggle terminal", () => {
      this.toggleTerminal();
    });

    this.addCommand({
      id: "open-terminal",
      name: "Open terminal",
      callback: () => void this.activateTerminal(),
    });

    this.addCommand({
      id: "close-terminal",
      name: "Close terminal",
      callback: () => this.closeTerminal(),
    });

    this.addCommand({
      id: "new-terminal-tab",
      name: "New terminal tab",
      callback: () => this.newTab(),
    });

    this.addCommand({
      id: "toggle-terminal",
      name: "Toggle terminal",
      callback: () => this.toggleTerminal(),
    });

    this.addCommand({
      id: "direct-process-tab",
      name: "Open direct-process tab (bypass PTY)…",
      callback: () => void this.openDirectProcessTab(),
    });

    this.addSettingTab(new TerminalSettingTab(this.app, this));
  }

  onunload(): void {
    // Detach after a tick to avoid disrupting the settings modal.
    setTimeout(() => {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
    }, 0);
  }

  async activateTerminal(): Promise<void> {
    const existing = this.getPreferredTerminalLeaf();
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf =
      this.settings.defaultLocation === "right"
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf("split", "horizontal");

    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TERMINAL, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  closeTerminal(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }

  toggleTerminal(): void {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      this.closeTerminal();
    } else {
      void this.activateTerminal();
    }
  }

  private newTab(): void {
    const leaf = this.getPreferredTerminalLeaf();
    if (leaf) {
      const view = leaf.view as TerminalView;
      view.createNewTab();
    } else {
      void this.activateTerminal();
    }
  }

  private async openDirectProcessTab(): Promise<void> {
    let leaf = this.getPreferredTerminalLeaf();
    if (!leaf) {
      await this.activateTerminal();
      leaf = this.getPreferredTerminalLeaf();
    }
    if (!leaf) return;

    const view = leaf.view as TerminalView;
    new DirectProcessPromptModal(this.app, DIRECT_PROCESS_DEFAULT_COMMAND, (commandLine) => {
      try {
        view.getTabManager()?.createDirectTab(commandLine);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Direct-process tab failed: ${message}`);
      }
    }).open();
  }

  private getPreferredTerminalLeaf(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType?.() === VIEW_TYPE_TERMINAL) {
      return activeLeaf;
    }

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    return leaves[0] ?? null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  updateTerminalBackgrounds(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    for (const leaf of leaves) {
      const view = leaf.view as TerminalView;
      view.updateBackgroundColor();
    }
  }

  updateIcon(name: string): void {
    const safeName = name || "terminal";
    if (this.ribbonEl) setIcon(this.ribbonEl, safeName);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)) {
      const iconEl = (leaf as any).tabHeaderInnerIconEl as HTMLElement | undefined;
      if (iconEl) setIcon(iconEl, safeName);
    }
  }
}

class DirectProcessPromptModal extends Modal {
  private readonly defaultValue: string;
  private readonly onSubmit: (commandLine: string) => void;

  constructor(app: App, defaultValue: string, onSubmit: (commandLine: string) => void) {
    super(app);
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("Open direct-process tab");

    contentEl.createEl("p", {
      text: "Spawns the command with child_process.spawn (no node-pty/ConPTY). " +
        "Use for TUIs whose synchronized output is degraded by the PTY layer. " +
        "Live resize is not signaled to the child.",
    });

    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.defaultValue;
    input.style.width = "100%";
    input.style.fontFamily = "var(--font-monospace)";
    input.placeholder = "command [args…]";
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    const submit = (): void => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      this.onSubmit(value);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    const buttonRow = contentEl.createDiv();
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginTop = "12px";

    const cancel = buttonRow.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    const ok = buttonRow.createEl("button", { text: "Open" });
    ok.classList.add("mod-cta");
    ok.addEventListener("click", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
