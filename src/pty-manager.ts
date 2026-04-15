import { Platform } from "obsidian";

export type WindowsTerminalBackend = "conpty" | "winpty";

function getElectronRequire(): any {
  const electronRequire = (window as any).require;
  if (!electronRequire) {
    throw new Error("Cannot access Electron require — this plugin only works on desktop.");
  }
  return electronRequire;
}

function getWindowsBuildNumber(): number | undefined {
  if (!Platform.isWin) return undefined;

  try {
    const os = getElectronRequire()("os");
    const rawBuild = os.release().split(".").pop();
    const buildNumber = rawBuild ? Number.parseInt(rawBuild, 10) : Number.NaN;
    return Number.isFinite(buildNumber) ? buildNumber : undefined;
  } catch {
    return undefined;
  }
}

export function getPreferredWindowsBackend(): WindowsTerminalBackend | undefined {
  const buildNumber = getWindowsBuildNumber();
  if (buildNumber === undefined) return Platform.isWin ? "winpty" : undefined;
  return buildNumber >= 18309 ? "conpty" : "winpty";
}

// node-pty is loaded at runtime via Electron's require, not bundled by esbuild.
function loadNodePty(pluginDir: string): any {
  const electronRequire = getElectronRequire();
  const path = electronRequire("path");
  const explicitPath = path.join(pluginDir, "node_modules", "node-pty");

  try {
    return electronRequire(explicitPath);
  } catch {
    return electronRequire("node-pty");
  }
}

function getDefaultShell(): string {
  if (Platform.isWin) {
    const pwsh = process.env.ProgramFiles + "\\PowerShell\\7\\pwsh.exe";
    try {
      const fs = getElectronRequire()("fs");
      if (fs.existsSync(pwsh)) return pwsh;
    } catch {
      // ignore
    }
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellArgs(shellPath: string): string[] {
  if (Platform.isWin) {
    const lower = shellPath.toLowerCase();
    if (lower.includes("pwsh") || lower.includes("powershell")) {
      return ["-NoLogo"];
    }
    return [];
  }

  // macOS/Linux: launch as a login shell so user PATH and shell startup files load.
  return ["-l"];
}

/**
 * Validates that a shell path points to an existing file.
 * Throws if the path does not exist or is not a file.
 */
function validateShellPath(shellPath: string): void {
  const fs = getElectronRequire()("fs");
  try {
    const stat = fs.statSync(shellPath);
    if (!stat.isFile()) {
      throw new Error(`Shell path is not a file: ${shellPath}`);
    }
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      throw new Error(`Shell not found: ${shellPath}`);
    }
    throw err;
  }
}

export class PtyManager {
  private ptyProcess: any = null;
  private readonly pluginDir: string;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
  }

  spawn(
    shellPath: string,
    cwd: string,
    cols: number,
    rows: number,
    env?: Record<string, string>
  ): WindowsTerminalBackend | undefined {
    const nodePty = loadNodePty(this.pluginDir);

    const shell = shellPath.trim() || getDefaultShell();
    validateShellPath(shell);
    const args = getShellArgs(shell);

    const ptyEnv = {
      ...process.env,
      ...(process.env.COLORTERM ? {} : { COLORTERM: "truecolor" }),
      ...(process.env.TERM_PROGRAM ? {} : { TERM_PROGRAM: "Obsidian" }),
      ...env,
    };

    const spawnWithOptions = (useConpty?: boolean): void => {
      this.ptyProcess = nodePty.spawn(shell, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: ptyEnv,
        ...(Platform.isWin ? { useConpty } : {}),
      });
    };

    if (Platform.isWin) {
      const preferredBackend = getPreferredWindowsBackend();
      if (preferredBackend === "conpty") {
        try {
          spawnWithOptions(true);
          return "conpty";
        } catch (error) {
          console.warn("Terminal: ConPTY spawn failed, falling back to winpty", error);
        }
      }

      spawnWithOptions(false);
      return "winpty";
    }

    spawnWithOptions();
    return undefined;
  }

  write(data: string): void {
    this.ptyProcess?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(cols, rows);
    } catch {
      // Ignore resize errors (can happen during rapid resizing)
    }
  }

  onData(callback: (data: string) => void): void {
    this.ptyProcess?.onData(callback);
  }

  onExit(callback: (exitInfo: { exitCode: number; signal?: number }) => void): void {
    this.ptyProcess?.onExit(callback);
  }

  kill(): void {
    try {
      this.ptyProcess?.kill();
    } catch {
      // Process may already be dead
    }
    this.ptyProcess = null;
  }

  get pid(): number | undefined {
    return this.ptyProcess?.pid;
  }
}
