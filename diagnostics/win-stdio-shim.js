// Injected by win-console-recorder.js for Node-based CLIs whose stdout is piped.
// It preserves the parent console geometry so TUIs don't fall back to 80x24.
const cols = Number(process.env.WIN_CONSOLE_RECORDER_COLUMNS || process.env.COLUMNS || 0);
const rows = Number(process.env.WIN_CONSOLE_RECORDER_ROWS || process.env.LINES || 0);

function patchStream(stream) {
  if (!stream) return;
  try {
    if (cols > 0) Object.defineProperty(stream, "columns", { configurable: true, get: () => cols });
    if (rows > 0) Object.defineProperty(stream, "rows", { configurable: true, get: () => rows });
    Object.defineProperty(stream, "isTTY", { configurable: true, get: () => true });
    stream.getWindowSize = () => [cols || 80, rows || 24];
  } catch {
    // Best-effort diagnostic shim only.
  }
}

patchStream(process.stdout);
patchStream(process.stderr);
