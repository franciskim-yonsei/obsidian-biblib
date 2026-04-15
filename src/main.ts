import { FileSystemAdapter, Plugin, WorkspaceLeaf, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL } from "./constants";
import { TerminalView } from "./terminal-view";
import { TerminalSettingTab, DEFAULT_SETTINGS, type TerminalPluginSettings } from "./settings";
import { BinaryManager } from "./binary-manager";

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
