import { Platform } from "obsidian";

export type WindowsTerminalBackend = "conpty" | "winpty";

export interface PtySpawnOptions {
  /**
   * On Windows 11 22H2+ with patched node-pty binaries, request
   * PSEUDOCONSOLE_PASSTHROUGH_MODE via the bundled conpty.dll path.
   */
  conptyPassthrough?: boolean;
}

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

export function supportsConptyPassthrough(): boolean {
  const buildNumber = getWindowsBuildNumber();
  return buildNumber !== undefined && buildNumber >= 22621;
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
    env?: Record<string, string>,
    options: PtySpawnOptions = {}
  ): WindowsTerminalBackend | undefined {
    const nodePty = loadNodePty(this.pluginDir);

    const shell = shellPath.trim() || getDefaultShell();
    validateShellPath(shell);
    const args = getShellArgs(shell);

    const passthroughRequested =
      Platform.isWin && options.conptyPassthrough === true && supportsConptyPassthrough();

    const basePtyEnv = {
      ...process.env,
      ...(process.env.COLORTERM ? {} : { COLORTERM: "truecolor" }),
      ...(process.env.TERM_PROGRAM ? {} : { TERM_PROGRAM: "Obsidian" }),
      ...env,
    };

    const spawnWithOptions = (
      useConpty?: boolean,
      useConptyDll = false,
      requestPassthrough = false
    ): void => {
      const spawn = (): void => {
        this.ptyProcess = nodePty.spawn(shell, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env: requestPassthrough
            ? { ...basePtyEnv, LEAN_TERMINAL_CONPTY_PASSTHROUGH: "1" }
            : basePtyEnv,
          ...(Platform.isWin ? { useConpty, ...(useConptyDll ? { useConptyDll: true } : {}) } : {}),
        });
      };

      // The native ConPTY is created before node-pty passes env to the child,
      // so the patched addon must see this flag in the current process env too.
      if (Platform.isWin && useConptyDll && requestPassthrough) {
        const previous = process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH;
        process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH = "1";
        try {
          spawn();
        } finally {
          if (previous === undefined) {
            delete process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH;
          } else {
            process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH = previous;
          }
        }
        return;
      }

      spawn();
    };

    if (Platform.isWin) {
      const preferredBackend = getPreferredWindowsBackend();
      if (preferredBackend === "conpty") {
        try {
          spawnWithOptions(true, passthroughRequested, passthroughRequested);
          return "conpty";
        } catch (error) {
          console.warn(
            passthroughRequested
              ? "Terminal: ConPTY passthrough spawn failed, retrying without passthrough"
              : "Terminal: ConPTY spawn failed, falling back to winpty",
            error
          );
        }

        if (passthroughRequested) {
          try {
            spawnWithOptions(true, true, false);
            return "conpty";
          } catch (error) {
            console.warn("Terminal: bundled ConPTY DLL spawn failed, retrying system ConPTY", error);
          }

          try {
            spawnWithOptions(true, false, false);
            return "conpty";
          } catch (error) {
            console.warn("Terminal: ConPTY spawn failed, falling back to winpty", error);
          }
        }
      }

      spawnWithOptions(false, false);
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
