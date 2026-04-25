#!/usr/bin/env node
/*
 * PTY recorder / pass-through diagnostic.
 *
 * Usage:
 *   node diagnostics/pty-recorder.js -- codex
 *   node diagnostics/pty-recorder.js -- pi
 *   node diagnostics/pty-recorder.js --raw -- codex   # captures raw base64 chunks; may contain secrets
 *   node diagnostics/pty-recorder.js --winpty -- pi       # force winpty on Windows
 *   node diagnostics/pty-recorder.js --conpty -- pi       # force ConPTY on Windows
 *   node diagnostics/pty-recorder.js --conpty-dll -- pi   # use bundled conpty.dll
 *   node diagnostics/pty-recorder.js --passthrough -- pi  # request ConPTY passthrough mode
 *
 * It runs the command in a nested PTY, mirrors it to the current terminal, and
 * writes timing/escape summaries to diagnostics/captures/*.jsonl.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const pty = require("node-pty");

const argv = process.argv.slice(2);
const raw = argv.includes("--raw");
const forceWinpty = argv.includes("--winpty");
const forceConpty = argv.includes("--conpty");
const forceConptyDll = argv.includes("--conpty-dll") || argv.includes("--passthrough");
const passthrough = argv.includes("--passthrough");
const sep = argv.indexOf("--");
const recorderFlags = new Set(["--raw", "--winpty", "--conpty", "--conpty-dll", "--passthrough"]);
const commandArgs = (sep >= 0 ? argv.slice(sep + 1) : argv.filter((a) => !recorderFlags.has(a)));
if (forceWinpty && (forceConpty || forceConptyDll || passthrough)) {
  console.error("Choose only one of --winpty, --conpty, --conpty-dll, or --passthrough");
  process.exit(2);
}
if (commandArgs.length === 0) {
  console.error("Usage: node diagnostics/pty-recorder.js [--raw] [--winpty|--conpty|--conpty-dll|--passthrough] -- <command> [args...]");
  process.exit(2);
}

const captureDir = path.join(__dirname, "captures");
fs.mkdirSync(captureDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const safeCommand = commandArgs[0].replace(/[^a-z0-9_.-]+/gi, "_");
const logPath = path.join(captureDir, `${stamp}-${safeCommand}.jsonl`);

function quoteForCmd(arg) {
  if (/^[A-Za-z0-9_/:\\.@%+=,-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnSpec(args) {
  if (process.platform === "win32") {
    return {
      file: process.env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", args.map(quoteForCmd).join(" ")],
    };
  }
  return { file: args[0], args: args.slice(1) };
}

function countMatches(text, regex) {
  let count = 0;
  regex.lastIndex = 0;
  while (regex.exec(text)) count++;
  return count;
}

function stripCsi(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[@-_]/g, "");
}

function analyze(data) {
  const printable = stripCsi(data).replace(/[\r\n\t\x00-\x1f\x7f]/g, "").length;
  return {
    bytes: Buffer.byteLength(data),
    chars: data.length,
    printable,
    cr: countMatches(data, /\r/g),
    lf: countMatches(data, /\n/g),
    csi: countMatches(data, /\x1b\[[0-?]*[ -/]*[@-~]/g),
    cursorMove: countMatches(data, /\x1b\[[0-9;]*[HfGABCD]/g),
    clearEol: countMatches(data, /\x1b\[[0-2]?K/g),
    clearScreen: countMatches(data, /\x1b\[[0-3]?J/g),
    sgr: countMatches(data, /\x1b\[[0-9;:]*m/g),
    hideCursor: countMatches(data, /\x1b\[\?25l/g),
    showCursor: countMatches(data, /\x1b\[\?25h/g),
    altEnter: countMatches(data, /\x1b\[\?1049h/g),
    altLeave: countMatches(data, /\x1b\[\?1049l/g),
    syncBegin: countMatches(data, /\x1b\[\?[^hl]*2026[^hl]*h/g),
    syncEnd: countMatches(data, /\x1b\[\?[^hl]*2026[^hl]*l/g),
  };
}

function writeLog(event) {
  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
}

const { file, args } = spawnSpec(commandArgs);
const env = { ...process.env };
const cols = process.stdout.columns || 100;
const rows = process.stdout.rows || 30;

writeLog({
  type: "start",
  t: Date.now(),
  commandArgs,
  spawned: { file, args },
  cwd: process.cwd(),
  platform: process.platform,
  node: process.version,
  terminalEnv: {
    TERM: env.TERM,
    COLORTERM: env.COLORTERM,
    TERM_PROGRAM: env.TERM_PROGRAM,
    WT_SESSION: env.WT_SESSION,
    ConEmuANSI: env.ConEmuANSI,
  },
  size: { cols, rows },
  raw,
  backend: forceWinpty
    ? "winpty"
    : passthrough
      ? "conpty-dll-passthrough"
      : forceConptyDll
        ? "conpty-dll"
        : forceConpty
          ? "conpty"
          : "default",
  useConptyDll: forceConptyDll,
  passthrough,
});

console.error(`\n[pty-recorder] logging to ${logPath}`);
console.error("[pty-recorder] exit the child normally or press Ctrl+C; raw=false by default.\n");

if (passthrough) {
  env.LEAN_TERMINAL_CONPTY_PASSTHROUGH = "1";
}

const spawnPty = () => pty.spawn(file, args, {
  name: env.TERM || "xterm-256color",
  cols,
  rows,
  cwd: process.cwd(),
  env,
  ...(process.platform === "win32" && forceWinpty ? { useConpty: false } : {}),
  ...(process.platform === "win32" && (forceConpty || forceConptyDll || passthrough) ? { useConpty: true } : {}),
  ...(process.platform === "win32" && forceConptyDll ? { useConptyDll: true } : {}),
});

const previousPassthrough = process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH;
if (passthrough) {
  process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH = "1";
}
let child;
try {
  child = spawnPty();
} finally {
  if (passthrough) {
    if (previousPassthrough === undefined) {
      delete process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH;
    } else {
      process.env.LEAN_TERMINAL_CONPTY_PASSTHROUGH = previousPassthrough;
    }
  }
}

let last = Date.now();
let seq = 0;
let totals = {
  chunks: 0,
  bytes: 0,
  printable: 0,
  clearEol: 0,
  cursorMove: 0,
  hideCursor: 0,
  showCursor: 0,
  syncBegin: 0,
  syncEnd: 0,
};

child.onData((data) => {
  process.stdout.write(data);
  const now = Date.now();
  const summary = analyze(data);
  totals.chunks++;
  totals.bytes += summary.bytes;
  totals.printable += summary.printable;
  totals.clearEol += summary.clearEol;
  totals.cursorMove += summary.cursorMove;
  totals.hideCursor += summary.hideCursor;
  totals.showCursor += summary.showCursor;
  totals.syncBegin += summary.syncBegin;
  totals.syncEnd += summary.syncEnd;

  writeLog({
    type: "out",
    seq: seq++,
    t: now,
    dt: now - last,
    ...summary,
    ...(raw ? { rawBase64: Buffer.from(data).toString("base64") } : {}),
  });
  last = now;
});

child.onExit((info) => {
  writeLog({ type: "exit", t: Date.now(), info, totals });
  console.error(`\n[pty-recorder] child exited; log: ${logPath}`);
  process.exit(info.exitCode ?? 0);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (buf) => child.write(buf.toString("binary")));
process.stdout.on("resize", () => {
  const nextCols = process.stdout.columns || cols;
  const nextRows = process.stdout.rows || rows;
  child.resize(nextCols, nextRows);
  writeLog({ type: "resize", t: Date.now(), size: { cols: nextCols, rows: nextRows } });
});

process.on("SIGINT", () => {
  try { child.kill(); } catch {}
});
process.on("SIGTERM", () => {
  try { child.kill(); } catch {}
});
