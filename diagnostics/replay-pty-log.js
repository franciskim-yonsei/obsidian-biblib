#!/usr/bin/env node
/* Replay raw output captured by diagnostics/pty-recorder.js --raw. */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
function takeFlag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  args.splice(i, 1);
  return true;
}
function takeValue(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

const noTiming = takeFlag("--no-timing", false);
const loop = takeFlag("--loop", false);
const sandbox = takeFlag("--sandbox", false);
const fitCapture = takeFlag("--fit-capture", false);
const speed = Number(takeValue("--speed", "1"));
const maxDelay = Number(takeValue("--max-delay", "500"));
const initialDelay = Number(takeValue("--initial-delay", "250"));
const fromSeq = Number(takeValue("--from-seq", "-Infinity"));
const toSeq = Number(takeValue("--to-seq", "Infinity"));
const count = Number(takeValue("--count", loop ? "Infinity" : "1"));
const file = args.find((a) => !a.startsWith("-"));

if (!file) {
  console.error([
    "Usage: node diagnostics/replay-pty-log.js [options] diagnostics/captures/<raw>.jsonl",
    "",
    "Options:",
    "  --no-timing        Replay chunks as fast as stdout accepts them",
    "  --sandbox          Replay inside alternate screen and restore on exit",
    "  --fit-capture      Ask terminal to resize to captured rows/cols before replay",
    "  --initial-delay <ms> Wait after sandbox/resize setup (default 250)",
    "  --speed <n>        Timing multiplier, e.g. 2 = twice as fast (default 1)",
    "  --max-delay <ms>   Cap inter-chunk sleep while preserving timing (default 500)",
    "  --from-seq <n>     Start at output chunk sequence number",
    "  --to-seq <n>       End at output chunk sequence number",
    "  --loop             Loop replay until Ctrl+C",
    "  --count <n>        Number of replay passes (default 1, Infinity with --loop)",
  ].join("\n"));
  process.exit(2);
}

const events = fs.readFileSync(file, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const startEvent = events.find((e) => e.type === "start");
const capturedSize = startEvent?.size ?? null;
const outs = events
  .filter((e) => e.type === "out" && e.rawBase64 && e.seq >= fromSeq && e.seq <= toSeq)
  .map((e) => ({ ...e, raw: Buffer.from(e.rawBase64, "base64") }));

if (outs.length === 0) {
  console.error(`No raw output chunks found in ${file}. Did you record with --raw?`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function write(buf) {
  return new Promise((resolve) => {
    if (process.stdout.write(buf)) resolve();
    else process.stdout.once("drain", resolve);
  });
}

function restoreTerminal() {
  process.stdout.write(`\x1b[0m\x1b[?25h${sandbox ? "\x1b[?1049l" : ""}`);
}

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
  restoreTerminal();
  process.exit(130);
});

async function replayOnce() {
  for (let i = 0; i < outs.length && !stopped; i++) {
    const e = outs[i];
    if (!noTiming && i > 0) {
      const delay = Number.isFinite(e.dt) ? Math.max(0, Math.min(maxDelay, e.dt / Math.max(0.001, speed))) : 0;
      if (delay > 0) await sleep(delay);
    }
    await write(e.raw);
  }
}

(async () => {
  const currentSize = { cols: process.stdout.columns || 0, rows: process.stdout.rows || 0 };
  console.error(`[replay-pty-log] ${path.basename(file)} chunks=${outs.length} timing=${noTiming ? "off" : "on"} speed=${speed}`);
  if (capturedSize) {
    console.error(`[replay-pty-log] captured size=${capturedSize.cols}x${capturedSize.rows} current size=${currentSize.cols || "?"}x${currentSize.rows || "?"}`);
    if (currentSize.cols && currentSize.rows && (currentSize.cols !== capturedSize.cols || currentSize.rows !== capturedSize.rows)) {
      console.error("[replay-pty-log] WARNING: size mismatch can make normal-buffer TUI replays look chaotic.");
    }
  }

  if (sandbox) {
    await write("\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H");
  }
  if (fitCapture && capturedSize) {
    await write(`\x1b[8;${capturedSize.rows};${capturedSize.cols}t`);
  }
  if ((sandbox || fitCapture) && initialDelay > 0) {
    await sleep(initialDelay);
  }

  for (let i = 0; i < count && !stopped; i++) {
    await replayOnce();
    if (loop && !stopped) await sleep(250);
  }
  restoreTerminal();
})().catch((err) => {
  restoreTerminal();
  console.error(err);
  process.exit(1);
});
