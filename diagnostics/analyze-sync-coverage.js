#!/usr/bin/env node
/* Analyze how much raw PTY output is actually inside DECSET 2026 sync blocks. */
const fs = require("node:fs");
const path = require("node:path");

const file = process.argv.find((a, i) => i > 1 && !a.startsWith("-"));
const samples = process.argv.includes("--samples");
if (!file) {
  console.error("Usage: node diagnostics/analyze-sync-coverage.js [--samples] diagnostics/captures/<raw>.jsonl");
  process.exit(2);
}

function count(text, regex) {
  let count = 0;
  regex.lastIndex = 0;
  while (regex.exec(text)) count++;
  return count;
}

function stripControls(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, "");
}

function emptyPart() {
  return { pieces: 0, bytes: 0, printable: 0, csi: 0, sgr: 0, clearEol: 0, clearScreen: 0, cursorMove: 0, hideCursor: 0, showCursor: 0 };
}

function add(part, text) {
  if (!text) return;
  part.pieces++;
  part.bytes += Buffer.byteLength(text);
  part.printable += stripControls(text).length;
  part.csi += count(text, /\x1b\[[0-?]*[ -/]*[@-~]/g);
  part.sgr += count(text, /\x1b\[[0-9;:]*m/g);
  part.clearEol += count(text, /\x1b\[[0-2]?K/g);
  part.clearScreen += count(text, /\x1b\[[0-3]?J/g);
  part.cursorMove += count(text, /\x1b\[[0-9;]*[HfGABCD]/g);
  part.hideCursor += count(text, /\x1b\[\?25l/g);
  part.showCursor += count(text, /\x1b\[\?25h/g);
}

const events = fs.readFileSync(file, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const start = events.find((e) => e.type === "start");
const outs = events.filter((e) => e.type === "out" && e.rawBase64);
if (outs.length === 0) {
  console.error("No raw output chunks found. Record with pty-recorder.js --raw.");
  process.exit(1);
}

const summary = {
  file: path.basename(file),
  command: start?.commandArgs?.join(" ") ?? "",
  env: {
    TERM: start?.terminalEnv?.TERM ?? "",
    TERM_PROGRAM: start?.terminalEnv?.TERM_PROGRAM ?? "",
    WT_SESSION: start?.terminalEnv?.WT_SESSION ? "yes" : "",
  },
  size: start?.size ?? null,
  chunks: outs.length,
  syncChunks: { both: 0, beginOnly: 0, endOnly: 0 },
  blocks: { total: 0, empty: 0, smallLt50: 0, nonempty: 0, p50Bytes: 0, p90Bytes: 0, p99Bytes: 0, maxBytes: 0 },
  inside: emptyPart(),
  outside: emptyPart(),
  topBlocks: [],
  outsideSamples: [],
};

let inSync = false;
let blockStartSeq = null;
let blockBytes = 0;
let blockPrintable = 0;
const blockList = [];

function maybeSampleOutside(text, seq) {
  if (!samples || !text || summary.outsideSamples.length >= 12) return;
  const printable = stripControls(text).length;
  const clears = count(text, /\x1b\[[0-3]?[JK]/g);
  if (printable < 40 && clears === 0) return;
  summary.outsideSamples.push({
    seq,
    bytes: Buffer.byteLength(text),
    printable,
    clears,
    preview: text.slice(0, 160).replace(/\x1b/g, "<ESC>").replace(/\r/g, "<CR>").replace(/\n/g, "<LF>"),
  });
}

for (const event of outs) {
  const data = Buffer.from(event.rawBase64, "base64").toString("utf8");
  const pattern = /\x1b\[\?([0-9;]*)([hl])/g;
  let cursor = 0;
  let begins = 0;
  let ends = 0;
  let match;

  while ((match = pattern.exec(data)) !== null) {
    if (!match[1].split(";").includes("2026")) continue;
    const before = data.slice(cursor, match.index);
    add(inSync ? summary.inside : summary.outside, before);
    if (inSync) {
      blockBytes += Buffer.byteLength(before);
      blockPrintable += stripControls(before).length;
    } else {
      maybeSampleOutside(before, event.seq);
    }

    const marker = data.slice(match.index, match.index + match[0].length);
    add(summary.inside, marker);
    if (match[2] === "h") {
      begins++;
      inSync = true;
      blockStartSeq = event.seq;
      blockBytes = 0;
      blockPrintable = 0;
    } else {
      ends++;
      if (inSync) {
        blockList.push({ startSeq: blockStartSeq, endSeq: event.seq, bytes: blockBytes, printable: blockPrintable });
      }
      inSync = false;
      blockStartSeq = null;
      blockBytes = 0;
      blockPrintable = 0;
    }
    cursor = match.index + match[0].length;
  }

  if (begins && ends) summary.syncChunks.both++;
  else if (begins) summary.syncChunks.beginOnly++;
  else if (ends) summary.syncChunks.endOnly++;

  const rest = data.slice(cursor);
  add(inSync ? summary.inside : summary.outside, rest);
  if (inSync) {
    blockBytes += Buffer.byteLength(rest);
    blockPrintable += stripControls(rest).length;
  } else {
    maybeSampleOutside(rest, event.seq);
  }
}

const sizes = blockList.filter((b) => b.bytes > 0).map((b) => b.bytes).sort((a, b) => a - b);
const percentile = (p) => sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))] : 0;
summary.blocks.total = blockList.length;
summary.blocks.empty = blockList.filter((b) => b.bytes === 0).length;
summary.blocks.smallLt50 = blockList.filter((b) => b.bytes > 0 && b.bytes < 50).length;
summary.blocks.nonempty = sizes.length;
summary.blocks.p50Bytes = percentile(0.5);
summary.blocks.p90Bytes = percentile(0.9);
summary.blocks.p99Bytes = percentile(0.99);
summary.blocks.maxBytes = sizes.at(-1) ?? 0;
summary.topBlocks = blockList.filter((b) => b.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 10);

const insideTotal = summary.inside.bytes + summary.outside.bytes;
summary.insidePct = insideTotal ? Number(((summary.inside.bytes / insideTotal) * 100).toFixed(1)) : 0;
summary.outsidePct = insideTotal ? Number(((summary.outside.bytes / insideTotal) * 100).toFixed(1)) : 0;
summary.inSyncEndState = inSync;

console.log(JSON.stringify(summary, null, 2));
