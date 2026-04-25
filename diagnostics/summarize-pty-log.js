#!/usr/bin/env node
/* Summarize diagnostics/captures/*.jsonl from pty-recorder.js. */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json") || args.includes("-j");
const compactMode = args.includes("--compact") || args.includes("-c");
const file = args.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node diagnostics/summarize-pty-log.js [--json|--compact] diagnostics/captures/<file>.jsonl");
  process.exit(2);
}

const events = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const outs = events.filter((e) => e.type === "out");
const start = events.find((e) => e.type === "start");
const exit = events.find((e) => e.type === "exit");

function pctNum(n, d) { return d ? Number(((n / d) * 100).toFixed(1)) : 0; }
function pct(n, d) { return `${pctNum(n, d).toFixed(1)}%`; }
function sum(key) { return outs.reduce((a, e) => a + (e[key] || 0), 0); }
function max(key) { return outs.reduce((a, e) => Math.max(a, e[key] || 0), 0); }
function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0; }

const clearOnly = outs.filter((e) => e.clearEol + e.clearScreen > 0 && e.printable === 0);
const clearHeavy = outs.filter((e) => e.clearEol + e.clearScreen >= 3 && e.printable < 10);
const syncBeginChunks = outs.filter((e) => e.syncBegin > 0);
const syncEndChunks = outs.filter((e) => e.syncEnd > 0);
const syncBothChunks = outs.filter((e) => e.syncBegin > 0 && e.syncEnd > 0);
const syncBeginOnlyChunks = outs.filter((e) => e.syncBegin > 0 && e.syncEnd === 0);
const syncEndOnlyChunks = outs.filter((e) => e.syncEnd > 0 && e.syncBegin === 0);
const printableAfterClear = [];
for (let i = 0; i < outs.length - 1; i++) {
  const a = outs[i];
  const b = outs[i + 1];
  if ((a.clearEol + a.clearScreen > 0) && a.printable < 10 && b.printable > 0) {
    printableAfterClear.push({ seq: a.seq, gapMs: b.t - a.t, clearEol: a.clearEol, clearScreen: a.clearScreen, nextPrintable: b.printable });
  }
}

const dtBuckets = { "0-4": 0, "5-15": 0, "16-33": 0, "34-100": 0, ">100": 0 };
for (const e of outs) {
  if (e.dt <= 4) dtBuckets["0-4"]++;
  else if (e.dt <= 15) dtBuckets["5-15"]++;
  else if (e.dt <= 33) dtBuckets["16-33"]++;
  else if (e.dt <= 100) dtBuckets["34-100"]++;
  else dtBuckets[">100"]++;
}

const gaps = printableAfterClear.map((p) => p.gapMs).sort((a, b) => a - b);
const gapStats = gaps.length ? {
  min: gaps[0],
  p50: percentile(gaps, 0.5),
  p90: percentile(gaps, 0.9),
  max: gaps[gaps.length - 1],
  avg: Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)),
} : null;

const summary = {
  file: path.basename(file),
  command: start?.commandArgs?.join(" ") ?? "",
  env: {
    TERM: start?.terminalEnv?.TERM ?? "",
    TERM_PROGRAM: start?.terminalEnv?.TERM_PROGRAM ?? "",
    WT_SESSION: start?.terminalEnv?.WT_SESSION ?? "",
  },
  chunks: outs.length,
  bytes: sum("bytes"),
  printable: sum("printable"),
  csi: sum("csi"),
  cursorMove: sum("cursorMove"),
  clearEol: sum("clearEol"),
  clearScreen: sum("clearScreen"),
  hideCursor: sum("hideCursor"),
  showCursor: sum("showCursor"),
  syncBegin: sum("syncBegin"),
  syncEnd: sum("syncEnd"),
  syncBeginChunks: syncBeginChunks.length,
  syncEndChunks: syncEndChunks.length,
  syncBothChunks: syncBothChunks.length,
  syncBeginOnlyChunks: syncBeginOnlyChunks.length,
  syncEndOnlyChunks: syncEndOnlyChunks.length,
  clearOnly: clearOnly.length,
  clearOnlyPct: pctNum(clearOnly.length, outs.length),
  clearHeavyLowPrint: clearHeavy.length,
  clearHeavyLowPrintPct: pctNum(clearHeavy.length, outs.length),
  maxDtMs: max("dt"),
  dtBuckets,
  clearToPrintablePairs: printableAfterClear.length,
  clearToPrintableGapMs: gapStats,
  samplePairs: printableAfterClear.slice(0, 12),
  exit: exit?.info ?? null,
  totals: exit?.totals ?? null,
};

if (jsonMode) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

if (compactMode) {
  console.log([
    `file=${summary.file}`,
    `cmd=${summary.command}`,
    `env TERM=${summary.env.TERM || ""} TERM_PROGRAM=${summary.env.TERM_PROGRAM || ""} WT_SESSION=${summary.env.WT_SESSION ? "yes" : ""}`,
    `chunks=${summary.chunks}`,
    `bytes=${summary.bytes}`,
    `printable=${summary.printable}`,
    `CSI=${summary.csi}`,
    `moves=${summary.cursorMove}`,
    `clearEol=${summary.clearEol}`,
    `clearScreen=${summary.clearScreen}`,
    `cursor=${summary.hideCursor}/${summary.showCursor}`,
    `sync=${summary.syncBegin}/${summary.syncEnd}`,
    `syncChunks both=${summary.syncBothChunks} beginOnly=${summary.syncBeginOnlyChunks} endOnly=${summary.syncEndOnlyChunks}`,
    `clearOnly=${summary.clearOnly}(${summary.clearOnlyPct}%)`,
    `clearHeavy=${summary.clearHeavyLowPrint}(${summary.clearHeavyLowPrintPct}%)`,
    `maxDt=${summary.maxDtMs}ms`,
    `clearPairs=${summary.clearToPrintablePairs}`,
    `gap=${gapStats ? `min${gapStats.min}/p50${gapStats.p50}/p90${gapStats.p90}/max${gapStats.max}/avg${gapStats.avg}` : "none"}`,
  ].join(" | "));
  process.exit(0);
}

console.log(`file: ${summary.file}`);
console.log(`command: ${summary.command}`);
console.log(`env: TERM=${summary.env.TERM} TERM_PROGRAM=${summary.env.TERM_PROGRAM} WT_SESSION=${summary.env.WT_SESSION}`);
console.log(`chunks: ${summary.chunks}`);
console.log(`bytes: ${summary.bytes}`);
console.log(`printable: ${summary.printable}`);
console.log(`CSI: ${summary.csi}, cursorMove: ${summary.cursorMove}, clearEol: ${summary.clearEol}, clearScreen: ${summary.clearScreen}`);
console.log(`cursor hide/show: ${summary.hideCursor}/${summary.showCursor}`);
console.log(`sync begin/end: ${summary.syncBegin}/${summary.syncEnd}`);
console.log(`sync chunks: both=${summary.syncBothChunks} beginOnly=${summary.syncBeginOnlyChunks} endOnly=${summary.syncEndOnlyChunks}`);
console.log(`clear-only chunks: ${summary.clearOnly} (${pct(summary.clearOnly, outs.length)})`);
console.log(`clear-heavy low-print chunks: ${summary.clearHeavyLowPrint} (${pct(summary.clearHeavyLowPrint, outs.length)})`);
console.log(`max dt: ${summary.maxDtMs}ms`);
console.log(`dt buckets: ${JSON.stringify(summary.dtBuckets)}`);
console.log(`clear->printable next-chunk pairs: ${summary.clearToPrintablePairs}`);
if (gapStats) {
  console.log(`clear->printable gap ms: min=${gapStats.min} p50=${gapStats.p50} p90=${gapStats.p90} max=${gapStats.max} avg=${gapStats.avg}`);
  console.log("sample pairs:");
  for (const p of summary.samplePairs) console.log(`  seq ${p.seq} gap=${p.gapMs}ms clears=${p.clearEol + p.clearScreen} nextPrintable=${p.nextPrintable}`);
}
if (exit) console.log(`exit: ${JSON.stringify(summary.exit)} totals=${JSON.stringify(summary.totals)}`);
