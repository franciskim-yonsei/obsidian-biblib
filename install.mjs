/**
 * Installs the plugin into an Obsidian vault's .obsidian/plugins directory.
 *
 * Usage: node install.mjs [vault-path]
 * Default vault: D:\LOS Test
 */

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";

const vaultPath = process.argv[2] || "D:\\LOS Test";
const pluginDir = join(vaultPath, ".obsidian", "plugins", "lean-terminal");
const WINDOWS_NATIVE_PATCH = "conpty-passthrough-v1";

if (!existsSync(join(vaultPath, ".obsidian"))) {
  console.error(`Error: ${vaultPath} does not appear to be an Obsidian vault (no .obsidian folder)`);
  process.exit(1);
}

const srcDir = resolve(import.meta.dirname);
const pluginManifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf-8"));

mkdirSync(pluginDir, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  const src = join(srcDir, file);
  if (!existsSync(src)) {
    console.error(`Error: ${file} not found. Run 'npm run build' first.`);
    process.exit(1);
  }
  cpSync(src, join(pluginDir, file));
  console.log(`  Copied ${file}`);
}

// Copy node-pty (native module needed at runtime).
const nodePtySrc = join(srcDir, "node_modules", "node-pty");
const nodePtyDest = join(pluginDir, "node_modules", "node-pty");
const binaryManifestDest = join(nodePtyDest, ".binary-manifest.json");

function hasCompleteWindowsNativeSet(dir) {
  return (
    existsSync(join(dir, "pty.node")) &&
    existsSync(join(dir, "conpty.node")) &&
    existsSync(join(dir, "winpty.dll")) &&
    existsSync(join(dir, "conpty", "conpty.dll")) &&
    existsSync(join(dir, "conpty", "OpenConsole.exe"))
  );
}

function hasPassthroughSourcePatch(dir) {
  try {
    const source = readFileSync(join(dir, "src", "win", "conpty.cc"), "utf-8");
    return source.includes("IsConptyPassthroughRequested") &&
      source.includes("PSEUDOCONSOLE_PASSTHROUGH_MODE");
  } catch {
    return false;
  }
}

if (!existsSync(nodePtySrc)) {
  console.error("Error: node_modules/node-pty not found. Run 'npm install' first.");
  process.exit(1);
}

mkdirSync(join(nodePtyDest, "lib"), { recursive: true });
cpSync(join(nodePtySrc, "lib"), join(nodePtyDest, "lib"), { recursive: true });

const patchSrc = join(srcDir, "patches", "windowsConoutConnection.js");
if (existsSync(patchSrc)) {
  cpSync(patchSrc, join(nodePtyDest, "lib", "windowsConoutConnection.js"));
  console.log("  Applied ConoutConnection patch (no Worker threads)");
}

let binaryWarning = false;
try {
  cpSync(join(nodePtySrc, "prebuilds"), join(nodePtyDest, "prebuilds"), { recursive: true });
} catch {
  binaryWarning = true;
}

const buildRelease = join(nodePtySrc, "build", "Release");
if (existsSync(buildRelease)) {
  try {
    cpSync(buildRelease, join(nodePtyDest, "build", "Release"), { recursive: true });
  } catch {
    binaryWarning = true;
  }
}

try {
  cpSync(join(nodePtySrc, "package.json"), join(nodePtyDest, "package.json"));
} catch {
  binaryWarning = true;
}

const thirdParty = join(nodePtySrc, "third_party");
if (existsSync(thirdParty)) {
  try {
    cpSync(thirdParty, join(nodePtyDest, "third_party"), { recursive: true });
  } catch {
    binaryWarning = true;
  }
}

const hasPatchedWindowsBuild = process.platform === "win32" &&
  hasCompleteWindowsNativeSet(buildRelease) &&
  hasPassthroughSourcePatch(nodePtySrc);

if (!binaryWarning) {
  writeFileSync(
    binaryManifestDest,
    JSON.stringify(
      {
        version: pluginManifest.version,
        platform: process.platform,
        arch: process.arch,
        installedAt: new Date().toISOString(),
        ...(hasPatchedWindowsBuild ? { nativePatch: WINDOWS_NATIVE_PATCH } : {}),
      },
      null,
      2
    ),
    "utf-8"
  );
}

if (binaryWarning) {
  console.log("  Copied node-pty lib + patch (binaries locked by Obsidian — existing binaries unchanged)");
} else if (process.platform === "win32" && hasPatchedWindowsBuild) {
  console.log("  Copied node-pty (patched local Windows build)");
} else if (process.platform === "win32") {
  console.log("  Copied node-pty, but no patched local Windows build was found");
  console.log("  The plugin will ask to download terminal binaries instead of trusting this local copy");
} else {
  console.log("  Copied node-pty (prebuilt N-API binaries)");
}

console.log(`\nPlugin installed to: ${pluginDir}`);
console.log("Restart Obsidian and enable the 'Terminal' plugin in Settings > Community Plugins.");
