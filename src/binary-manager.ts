import { requestUrl } from "obsidian";

export type BinaryStatus = "not-installed" | "checking" | "downloading" | "ready" | "error";

interface BinaryManifest {
  version: string;
  platform: string;
  arch: string;
  installedAt: string;
  nativePatch?: string;
}

const REPO_OWNER = "sdkasper";
const REPO_NAME = "lean-obsidian-terminal";
const WINDOWS_NATIVE_PATCH = "conpty-passthrough-v1";

export class BinaryManager {
  private status: BinaryStatus = "not-installed";
  private statusMessage = "";
  private readonly expectedVersion: string;
  private readonly nodePtyDir: string;
  private readonly manifestPath: string;

  private readonly fs: typeof import("fs");
  private readonly path: typeof import("path");
  private readonly os: typeof import("os");
  private readonly childProcess: typeof import("child_process");
  private readonly crypto: typeof import("crypto");

  constructor(pluginDir: string, expectedVersion: string) {
    this.expectedVersion = expectedVersion.replace(/^v/, "");

    const electronRequire = (window as any).require;
    this.fs = electronRequire("fs");
    this.path = electronRequire("path");
    this.os = electronRequire("os");
    this.childProcess = electronRequire("child_process");
    this.crypto = electronRequire("crypto");

    this.nodePtyDir = this.path.join(pluginDir, "node_modules", "node-pty");
    this.manifestPath = this.path.join(this.nodePtyDir, ".binary-manifest.json");
  }

  checkInstalled(): boolean {
    this.setStatus("checking");

    try {
      const platform = process.platform;
      const arch = process.arch;

      // Check core JS entry point.
      const indexPath = this.path.join(this.nodePtyDir, "lib", "index.js");
      if (!this.fs.existsSync(indexPath)) {
        this.setStatus("not-installed");
        return false;
      }

      // Check for native binary — prebuilds (win32/darwin) or build/Release
      // (linux and patched Windows CI builds).
      const prebuildDir = this.path.join(this.nodePtyDir, "prebuilds", `${platform}-${arch}`);
      const buildReleaseDir = this.path.join(this.nodePtyDir, "build", "Release");
      const hasPrebuild = this.fs.existsSync(this.path.join(prebuildDir, "pty.node"));
      const hasBuildRelease = this.fs.existsSync(this.path.join(buildReleaseDir, "pty.node"));

      if (!hasPrebuild && !hasBuildRelease) {
        this.setStatus("not-installed");
        return false;
      }

      // Platform-specific checks.
      if (platform === "win32") {
        const hasCompleteWindowsNativeSet = (dir: string): boolean =>
          this.fs.existsSync(this.path.join(dir, "pty.node")) &&
          this.fs.existsSync(this.path.join(dir, "conpty.node")) &&
          this.fs.existsSync(this.path.join(dir, "winpty.dll")) &&
          this.fs.existsSync(this.path.join(dir, "conpty", "conpty.dll")) &&
          this.fs.existsSync(this.path.join(dir, "conpty", "OpenConsole.exe"));

        if (!hasCompleteWindowsNativeSet(prebuildDir) && !hasCompleteWindowsNativeSet(buildReleaseDir)) {
          this.setStatus("not-installed");
          return false;
        }
      } else if (hasPrebuild) {
        const spawnHelper = this.path.join(prebuildDir, "spawn-helper");
        if (!this.fs.existsSync(spawnHelper)) {
          this.setStatus("not-installed");
          return false;
        }
      }

      // Check manifest matches the current plugin release.
      if (this.fs.existsSync(this.manifestPath)) {
        const manifest = this.readManifest();
        if (
          manifest.platform !== platform ||
          manifest.arch !== arch ||
          manifest.version !== this.expectedVersion ||
          (platform === "win32" && manifest.nativePatch !== WINDOWS_NATIVE_PATCH)
        ) {
          this.setStatus("not-installed");
          return false;
        }
      } else if (platform === "win32") {
        // Windows binaries now carry native patches. Unmanifested Windows
        // installs may be older/unpatched, so force a fresh download.
        this.setStatus("not-installed");
        return false;
      } else {
        // Legacy non-Windows installs predate the manifest. Migrate them in place
        // so future checks are version-aware without breaking existing local installs.
        this.writeManifest({
          version: this.expectedVersion,
          platform,
          arch,
          installedAt: new Date().toISOString(),
        });
      }

      this.setStatus("ready");
      return true;
    } catch {
      this.setStatus("not-installed");
      return false;
    }
  }

  async download(version = this.expectedVersion): Promise<void> {
    const normalizedVersion = version.replace(/^v/, "");
    this.setStatus("downloading", `Preparing download for v${normalizedVersion}...`);

    try {
      const platform = process.platform;
      const arch = process.arch;
      const assetName = `node-pty-${platform}-${arch}.zip`;
      const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${normalizedVersion}`;

      // Download checksums.
      this.setStatus("downloading", "Downloading checksums...");
      let checksums: Record<string, string> = {};
      try {
        const checksumResp = await requestUrl({ url: `${baseUrl}/checksums.json` });
        checksums = checksumResp.json;
      } catch {
        // Checksums are optional — warn but continue.
        console.warn("Terminal: checksums.json not found, skipping verification");
      }

      // Download binary zip.
      this.setStatus("downloading", `Downloading ${assetName}...`);
      const zipResp = await requestUrl({
        url: `${baseUrl}/${assetName}`,
        contentType: "application/octet-stream",
      });
      const zipBuffer = Buffer.from(zipResp.arrayBuffer);

      // Verify checksum if available.
      if (checksums[assetName]) {
        const hash = this.crypto
          .createHash("sha256")
          .update(zipBuffer)
          .digest("hex");
        if (hash !== checksums[assetName]) {
          throw new Error(
            `Checksum mismatch for ${assetName}: expected ${checksums[assetName]}, got ${hash}`
          );
        }
      }

      // Write zip to temp file.
      this.setStatus("downloading", "Extracting...");
      const tmpZip = this.path.join(this.os.tmpdir(), assetName);
      this.fs.writeFileSync(tmpZip, zipBuffer);

      // Clean existing node-pty dir.
      if (this.fs.existsSync(this.nodePtyDir)) {
        this.fs.rmSync(this.nodePtyDir, { recursive: true, force: true });
      }
      this.fs.mkdirSync(this.nodePtyDir, { recursive: true });

      // Extract zip using platform-native tools.
      if (platform === "win32") {
        this.childProcess.execSync(
          `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${this.nodePtyDir}' -Force"`,
          { timeout: 30000 }
        );
      } else {
        this.childProcess.execSync(
          `unzip -o "${tmpZip}" -d "${this.nodePtyDir}"`,
          { timeout: 30000 }
        );

        // Ensure spawn-helper is executable.
        const spawnHelper = this.path.join(
          this.nodePtyDir,
          "prebuilds",
          `${platform}-${arch}`,
          "spawn-helper"
        );
        if (this.fs.existsSync(spawnHelper)) {
          this.fs.chmodSync(spawnHelper, 0o755);
        }
      }

      try {
        this.fs.unlinkSync(tmpZip);
      } catch {
        // ignore
      }

      this.writeManifest({
        version: normalizedVersion,
        platform,
        arch,
        installedAt: new Date().toISOString(),
        ...(platform === "win32" ? { nativePatch: WINDOWS_NATIVE_PATCH } : {}),
      });

      this.setStatus("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Terminal: binary download failed", err);
      this.setStatus("error", message);
      throw err;
    }
  }

  remove(): void {
    try {
      if (this.fs.existsSync(this.nodePtyDir)) {
        this.fs.rmSync(this.nodePtyDir, { recursive: true, force: true });
      }
      this.setStatus("not-installed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      throw err;
    }
  }

  getVersion(): string | null {
    try {
      if (this.fs.existsSync(this.manifestPath)) {
        return this.readManifest().version;
      }
    } catch {
      // ignore
    }
    return null;
  }

  getPlatformInfo(): { platform: string; arch: string } {
    return { platform: process.platform, arch: process.arch };
  }

  isReady(): boolean {
    return this.status === "ready";
  }

  getStatus(): BinaryStatus {
    return this.status;
  }

  getStatusMessage(): string {
    return this.statusMessage;
  }

  private readManifest(): BinaryManifest {
    return JSON.parse(this.fs.readFileSync(this.manifestPath, "utf-8"));
  }

  private writeManifest(manifest: BinaryManifest): void {
    this.fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  private setStatus(status: BinaryStatus, message = ""): void {
    this.status = status;
    this.statusMessage = message;
  }
}
