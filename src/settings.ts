import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TerminalPlugin from "./main";
import { THEME_NAMES } from "./themes";

export type NotificationSound = "beep" | "chime" | "ping" | "pop";

export interface TerminalPluginSettings {
  shellPath: string;
  fontSize: number;
  fontFamily: string;
  theme: string;
  cursorBlink: boolean;
  scrollback: number;
  defaultLocation: "right" | "bottom";
  notifyOnCompletion: boolean;
  notificationSound: NotificationSound;
  notificationVolume: number;
}

export const DEFAULT_SETTINGS: TerminalPluginSettings = {
  shellPath: "",
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  theme: "obsidian-dark",
  cursorBlink: true,
  scrollback: 5000,
  defaultLocation: "bottom",
  notifyOnCompletion: false,
  notificationSound: "beep",
  notificationVolume: 50,
};

export class TerminalSettingTab extends PluginSettingTab {
  plugin: TerminalPlugin;

  constructor(app: App, plugin: TerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Binary Management ---
    containerEl.createEl("h3", { text: "Terminal Binary" });

    const bm = this.plugin.binaryManager;
    const { platform, arch } = bm.getPlatformInfo();
    const version = bm.getVersion();
    const status = bm.getStatus();

    let statusDesc: string;
    if (status === "ready") {
      statusDesc = `Installed (v${version}) \u2014 ${platform}-${arch}`;
    } else if (status === "error") {
      statusDesc = `Error: ${bm.getStatusMessage()}`;
    } else if (status === "downloading") {
      statusDesc = `Downloading\u2026 ${bm.getStatusMessage()}`;
    } else {
      statusDesc = `Not installed \u2014 ${platform}-${arch}`;
    }

    new Setting(containerEl).setName("Status").setDesc(statusDesc);

    new Setting(containerEl)
      .setName("Download binaries")
      .setDesc("Download platform-specific node-pty binaries from GitHub")
      .addButton((btn) => {
        btn
          .setButtonText(status === "downloading" ? "Downloading\u2026" : "Download")
          .setDisabled(status === "ready" || status === "downloading")
          .onClick(async () => {
            btn.setButtonText("Downloading\u2026");
            btn.setDisabled(true);
            try {
              await bm.download();
              new Notice("Terminal binaries installed successfully.");
            } catch (err: any) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Failed to download binaries: ${msg}`);
            }
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Remove binaries")
      .setDesc("Delete downloaded node-pty binaries")
      .addButton((btn) => {
        btn
          .setButtonText("Remove")
          .setDisabled(status !== "ready")
          .onClick(async () => {
            await bm.remove();
            new Notice("Terminal binaries removed.");
            this.display();
          });
      });

    // --- Appearance & Behavior ---
    containerEl.createEl("h3", { text: "Appearance & Behavior" });

    new Setting(containerEl)
      .setName("Shell path")
      .setDesc("Leave empty for auto-detect (PowerShell on Windows, $SHELL on macOS/Linux)")
      .addText((text) =>
        text
          .setPlaceholder("Auto-detect")
          .setValue(this.plugin.settings.shellPath)
          .onChange(async (value) => {
            this.plugin.settings.shellPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font size")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.fontSize))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.fontSize = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Font family")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async (value) => {
            this.plugin.settings.fontFamily = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Theme")
      .addDropdown((dropdown) => {
        for (const name of THEME_NAMES) {
          dropdown.addOption(name, name);
        }
        dropdown.setValue(this.plugin.settings.theme);
        dropdown.onChange(async (value) => {
          this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Cursor blink")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cursorBlink).onChange(async (value) => {
          this.plugin.settings.cursorBlink = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Scrollback lines")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.scrollback))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.scrollback = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default location")
      .setDesc("Where to open new terminal panels")
      .addDropdown((dropdown) => {
        dropdown.addOption("bottom", "Bottom");
        dropdown.addOption("right", "Right");
        dropdown.setValue(this.plugin.settings.defaultLocation);
        dropdown.onChange(async (value: string) => {
          this.plugin.settings.defaultLocation = value as "right" | "bottom";
          await this.plugin.saveSettings();
        });
      });

    // --- Notifications ---
    containerEl.createEl("h3", { text: "Notifications" });

    new Setting(containerEl)
      .setName("Notify on command completion")
      .setDesc("Play a sound and show a notice when a command finishes in a background tab")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.notifyOnCompletion).onChange(async (value) => {
          this.plugin.settings.notifyOnCompletion = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Notification sound")
      .setDesc("Sound to play when a background command finishes")
      .addDropdown((dropdown) => {
        dropdown.addOption("beep", "Beep");
        dropdown.addOption("chime", "Chime");
        dropdown.addOption("ping", "Ping");
        dropdown.addOption("pop", "Pop");
        dropdown.setValue(this.plugin.settings.notificationSound);
        dropdown.onChange(async (value: string) => {
          this.plugin.settings.notificationSound = value as NotificationSound;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Notification volume")
      .setDesc("Volume for the notification sound (0–100)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(this.plugin.settings.notificationVolume)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.notificationVolume = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
