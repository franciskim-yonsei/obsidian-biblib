#!/usr/bin/env node
/*
 * Windows-only raw console recorder that runs a child directly in the current
 * console instead of nesting it inside node-pty. Useful when node-pty itself
 * changes terminal behavior (for example, Windows Terminal + ConPTY).
 *
 * Usage:
 *   node diagnostics/win-console-recorder.js -- pi --no-session
 *
 * This captures the child's stdout/stderr bytes while also writing them through
 * to the current console. Interactive stdin remains inherited directly by the
 * child, so this is less invasive than pty-recorder.js on Windows.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

if (process.platform !== "win32") {
  console.error("win-console-recorder.js is intended for Windows only.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const raw = argv.includes("--raw") || true;
const sep = argv.indexOf("--");
const commandArgs = (sep >= 0 ? argv.slice(sep + 1) : argv.filter((a) => a !== "--raw"));
if (commandArgs.length === 0) {
  console.error("Usage: node diagnostics/win-console-recorder.js -- <command> [args...]");
  process.exit(2);
}

const captureDir = path.join(__dirname, "captures");
fs.mkdirSync(captureDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const safeCommand = commandArgs[0].replace(/[^a-z0-9_.-]+/gi, "_");
const logPath = path.join(captureDir, `${stamp}-${safeCommand}-console.jsonl`);

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
  const text = data.toString("utf8");
  const printable = stripCsi(text).replace(/[\r\n\t\x00-\x1f\x7f]/g, "").length;
  return {
    bytes: data.length,
    chars: text.length,
    printable,
    cr: countMatches(text, /\r/g),
    lf: countMatches(text, /\n/g),
    csi: countMatches(text, /\x1b\[[0-?]*[ -/]*[@-~]/g),
    cursorMove: countMatches(text, /\x1b\[[0-9;]*[HfGABCD]/g),
    clearEol: countMatches(text, /\x1b\[[0-2]?K/g),
    clearScreen: countMatches(text, /\x1b\[[0-3]?J/g),
    sgr: countMatches(text, /\x1b\[[0-9;:]*m/g),
    hideCursor: countMatches(text, /\x1b\[\?25l/g),
    showCursor: countMatches(text, /\x1b\[\?25h/g),
    altEnter: countMatches(text, /\x1b\[\?1049h/g),
    altLeave: countMatches(text, /\x1b\[\?1049l/g),
    syncBegin: countMatches(text, /\x1b\[\?[^hl]*2026[^hl]*h/g),
    syncEnd: countMatches(text, /\x1b\[\?[^hl]*2026[^hl]*l/g),
  };
}

function writeLog(event) {
  fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
}

function writeOut(stream, data) {
  return new Promise((resolve) => {
    if (stream.write(data)) resolve();
    else stream.once("drain", resolve);
  });
}

function quoteForShell(arg) {
  if (/^[A-Za-z0-9_/:\\.@%+=,-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

const cols = process.stdout.columns || 100;
const rows = process.stdout.rows || 30;
const shimPath = path.join(__dirname, "win-stdio-shim.js");
const shimOption = `--require=${shimPath}`;
const env = {
  ...process.env,
  COLUMNS: String(cols),
  LINES: String(rows),
  WIN_CONSOLE_RECORDER_COLUMNS: String(cols),
  WIN_CONSOLE_RECORDER_ROWS: String(rows),
  NODE_OPTIONS: process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ${shimOption}` : shimOption,
};

writeLog({
  type: "start",
  t: Date.now(),
  commandArgs,
  spawned: { file: commandArgs[0], args: commandArgs.slice(1), mode: "child_process" },
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
});

console.error(`\n[win-console-recorder] logging to ${logPath}`);
console.error("[win-console-recorder] stdin is inherited directly by child; exit child normally.\n");

const child = spawn(commandArgs.map(quoteForShell).join(" "), {
  cwd: process.cwd(),
  env,
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
  windowsHide: false,
});

let last = Date.now();
let seq = 0;
let totals = { chunks: 0, bytes: 0, printable: 0, clearEol: 0, cursorMove: 0, hideCursor: 0, showCursor: 0, syncBegin: 0, syncEnd: 0 };

async function handleData(source, data) {
  await writeOut(source === "stderr" ? process.stderr : process.stdout, data);
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
    source,
    seq: seq++,
    t: now,
    dt: now - last,
    ...summary,
    rawBase64: data.toString("base64"),
  });
  last = now;
}

child.stdout.on("data", (data) => void handleData("stdout", data));
child.stderr.on("data", (data) => void handleData("stderr", data));
child.on("error", (error) => {
  writeLog({ type: "error", t: Date.now(), error: String(error?.stack || error) });
  console.error(error);
});
child.on("exit", (exitCode, signal) => {
  writeLog({ type: "exit", t: Date.now(), info: { exitCode, signal }, totals });
  console.error(`\n[win-console-recorder] child exited; log: ${logPath}`);
  process.exit(exitCode ?? (signal ? 1 : 0));
});
