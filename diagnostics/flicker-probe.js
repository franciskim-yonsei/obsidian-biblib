#!/usr/bin/env node
/*
 * Diagnostic terminal flicker probe.
 *
 * Run inside the Obsidian terminal and compare with Windows Terminal:
 *   node diagnostics/flicker-probe.js single
 *   node diagnostics/flicker-probe.js ratatui
 *   node diagnostics/flicker-probe.js split 20
 *   node diagnostics/flicker-probe.js syncsplit 20
 *   node diagnostics/flicker-probe.js fullsync
 *   node diagnostics/flicker-probe.js scrollsync
 *   node diagnostics/flicker-probe.js stylesync
 *   node diagnostics/flicker-probe.js stylesync 8 16
 *
 * Press Ctrl+C to exit.
 */

const mode = process.argv[2] || "ratatui";
const splitDelay = Number.parseInt(process.argv[3] || "8", 10);
const frameInterval = Math.max(1, Number.parseInt(process.argv[4] || "100", 10) || 100);
const termRows = process.stdout.rows || 24;
const rows = mode === "fullsync" || mode === "scrollsync" || mode === "stylesync"
  ? Math.max(6, Math.min(termRows - 4, Number.parseInt(process.argv[5] || "0", 10) || termRows - 4))
  : 18;
const cols = Math.min(process.stdout.columns || 100, 120);
const useAltScreen = !mode.startsWith("normal");
let frame = 0;
let timer = null;

function write(s) {
  process.stdout.write(s);
}

function lineText(row, frameNo) {
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][frameNo % 10];
  const wave = "·".repeat((frameNo + row) % 20);
  const text = `${spinner} row ${String(row).padStart(2, "0")} frame ${String(frameNo).padStart(5, "0")} ${wave} ${"x".repeat((row * 7 + frameNo) % 50)}`;
  return text.slice(0, Math.max(0, cols - 1));
}

function header() {
  return `mode=${mode} splitDelay=${splitDelay}ms interval=${frameInterval}ms frame=${frame} cols=${cols}   Ctrl+C exits`;
}

function styledLine(row, frameNo) {
  // Many short style runs approximate pi/markdown output better than the plain
  // text probes. This stresses xterm's DOM renderer span churn after sync has
  // already done its job.
  const labels = ["●", "◆", "◇", "○", "▸", "•", "✦", "·"];
  let out = "";
  let visible = 0;
  for (let i = 0; visible < cols - 2 && i < 32; i++) {
    const r = (80 + ((frameNo * 7 + row * 11 + i * 23) % 176));
    const g = (80 + ((frameNo * 5 + row * 17 + i * 19) % 176));
    const b = (80 + ((frameNo * 3 + row * 13 + i * 29) % 176));
    const bg = 16 + ((row + i + frameNo) % 6);
    const style = i % 5 === 0
      ? `\x1b[1;38;2;${r};${g};${b};48;5;${bg}m`
      : i % 3 === 0
        ? `\x1b[2;38;2;${r};${g};${b}m`
        : `\x1b[38;2;${r};${g};${b}m`;
    const text = `${labels[(row + i + frameNo) % labels.length]}${String((row * 31 + i * 7 + frameNo) % 100).padStart(2, "0")}`;
    if (visible + text.length > cols - 2) break;
    out += style + text + "\x1b[0m";
    visible += text.length;
  }
  return out;
}

function singleWriteFrame() {
  let out = "\x1b[H";
  out += header() + "\x1b[K\r\n";
  for (let r = 0; r < rows; r++) {
    out += lineText(r, frame) + "\x1b[K\r\n";
  }
  write(out);
}

function ratatuiLikeFrame() {
  // Mimic Codex/ratatui's broad shape: clear row tails first, then write changed cells.
  // This is still emitted as ONE stdout write. If this flickers, the terminal/frontend is
  // exposing partial parsing/painting of a single frame-sized command stream.
  let out = "";

  out += "\x1b[H" + header() + "\x1b[K";

  for (let r = 0; r < rows; r++) {
    out += `\x1b[${r + 2};1H\x1b[K`;
  }

  for (let r = 0; r < rows; r++) {
    out += `\x1b[${r + 2};1H${lineText(r, frame)}`;
  }

  out += `\x1b[${rows + 3};1H`;
  write(out);
}

function fullSyncFrame() {
  // Stress xterm's renderer after successful synchronization: one atomic write
  // that changes nearly the whole viewport. If this flickers while syncsplit is
  // smooth, the bottleneck is final paint cost rather than split clear/draw.
  let out = "\x1b[?2026h\x1b[H";
  out += header() + "\x1b[K\r\n";
  for (let r = 0; r < rows; r++) {
    out += lineText(r, frame) + "\x1b[K\r\n";
  }
  out += `\x1b[${rows + 3};1H\x1b[?2026l`;
  write(out);
}

function styleSyncFrame() {
  let out = "\x1b[?2026h\x1b[H";
  out += header() + "\x1b[K\r\n";
  for (let r = 0; r < rows; r++) {
    out += styledLine(r, frame) + "\x1b[K\r\n";
  }
  out += `\x1b[${rows + 3};1H\x1b[?2026l`;
  write(out);
}

function scrollSyncFrame() {
  // Stress synchronized scrolling. Normal-buffer TUIs like pi often cause
  // xterm to mark the viewport dirty on scroll, which syncsplit does not test.
  const bottom = Math.max(4, Math.min(termRows - 1, rows + 2));
  let out = "\x1b[?2026h";
  if (frame === 1) {
    out += `\x1b[2;${bottom}r\x1b[H${header()}\x1b[K`;
    for (let r = 0; r < bottom - 2; r++) {
      out += `\x1b[${r + 2};1H${lineText(r, frame)}\x1b[K`;
    }
  } else {
    out += `\x1b[${bottom};1H\r\n`;
    out += `\x1b[1;1H${header()}\x1b[K`;
    out += `\x1b[${bottom};1H${lineText(frame % rows, frame)}\x1b[K`;
  }
  out += `\x1b[${bottom + 1};1H\x1b[r\x1b[?2026l`;
  write(out);
}

function splitFrame(synchronized = false) {
  // Deliberately flickery unless synchronized output is honored: clear pass and
  // draw pass in separate writes. With synchronized=true, the writes are wrapped
  // in DECSET 2026 markers, which Windows Terminal honors.
  let clear = `${synchronized ? "\x1b[?2026h" : ""}\x1b[H${header()}\x1b[K`;
  for (let r = 0; r < rows; r++) {
    clear += `\x1b[${r + 2};1H\x1b[K`;
  }
  write(clear);

  setTimeout(() => {
    let draw = "";
    for (let r = 0; r < rows; r++) {
      draw += `\x1b[${r + 2};1H${lineText(r, frame)}`;
    }
    draw += `\x1b[${rows + 3};1H${synchronized ? "\x1b[?2026l" : ""}`;
    write(draw);
  }, Number.isFinite(splitDelay) ? splitDelay : 8);
}

function tick() {
  frame++;
  if (mode === "single") {
    singleWriteFrame();
  } else if (mode === "split") {
    splitFrame(false);
  } else if (mode === "syncsplit") {
    splitFrame(true);
  } else if (mode === "fullsync") {
    fullSyncFrame();
  } else if (mode === "scrollsync") {
    scrollSyncFrame();
  } else if (mode === "stylesync") {
    styleSyncFrame();
  } else {
    ratatuiLikeFrame();
  }
}

function cleanup() {
  if (timer) clearInterval(timer);
  write(`\x1b[?25h\x1b[0m\x1b[r${useAltScreen ? "\x1b[?1049l" : ""}`);
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.on("exit", cleanup);

write(`${useAltScreen ? "\x1b[?1049h" : ""}\x1b[?25l\x1b[2J\x1b[H`);
tick();
timer = setInterval(tick, frameInterval);
