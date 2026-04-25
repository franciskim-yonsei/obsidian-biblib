# Flicker investigation notes

This directory contains the diagnostic tooling and retained local evidence from the terminal flicker investigation.

## Current headline finding

`pi` does **not** flicker in Windows Terminal when run directly, but it does flicker when run through `node-pty`/ConPTY and then rendered by a frontend such as xterm.js in the Obsidian plugin.

The most important comparison is:

| Scenario | Capture | Result | Sync coverage |
| --- | --- | --- | --- |
| Obsidian terminal (`node-pty`/ConPTY -> xterm.js) | `captures/2026-04-25T08-13-25-044Z-pi.jsonl` | flickers | 17.6% inside sync / 82.4% outside sync |
| Windows Terminal with `pty-recorder.js` (`node-pty`/ConPTY nested in WT) | `captures/2026-04-25T08-53-17-912Z-pi.jsonl` | flickers | 21.8% inside sync / 78.2% outside sync |
| Windows Terminal with `win-console-recorder.js` (`child_process`, no nested PTY) | `captures/2026-04-25T08-59-12-098Z-pi-console.jsonl` | smooth | 97.3% inside sync / 2.7% outside sync |
| Windows Terminal with `pty-recorder.js --winpty` | `captures/2026-04-25T09-02-20-898Z-pi.jsonl` | chaotic | sync markers not preserved (`0/0`) |

Interpretation: the meaningful transformer is `node-pty`'s Windows PTY layer, especially ConPTY. Direct Windows Terminal receives pi's synchronized stream as intended. The nested PTY path reserializes/transforms the stream so many visible updates occur outside `DECSET 2026` synchronized-output spans.

## Plugin changes retained

`src/terminal-tab-manager.ts` now includes `SynchronizedOutputGate`, a targeted xterm.js shim for `DECSET 2026`:

- detects `ESC[?2026h` and `ESC[?2026l`, including combined private modes;
- buffers synchronized blocks that are split across PTY chunks;
- suppresses xterm renderer row refreshes while a synchronized block is being parsed;
- flushes one coalesced refresh after the xterm write callback;
- exposes best-effort runtime stats via `leanTerminalSyncStats()` in Obsidian devtools/eval.

This was validated by the `syncsplit` probe: Windows Terminal was smooth, baseline xterm was flickery, and the plugin shim made Obsidian much closer to Windows Terminal for that controlled protocol case.

The broader empty-sync/post-sync coalescing workaround was tested, found ineffective for real `pi`, and removed.

## Important conclusions

1. **There is no pi flickering in WT** when `pi` is run directly.
2. xterm.js 5.5 does not appear to implement `DECSET 2026` natively.
3. Adding targeted `DECSET 2026` support helps controlled cases and is worth keeping.
4. Real `pi` flicker in Obsidian is not fixed by terminal-side sync support alone.
5. `pi` through `node-pty`/ConPTY emits a stream where most visible output is outside sync blocks.
6. Direct WT/child-process capture preserves pi's intended synchronized stream, with nearly all visible output inside sync blocks.
7. Forcing `winpty` is not a solution; it produced chaotic output and lost sync markers in the retained capture.
8. The next serious fix path is not another xterm renderer tweak. It is likely one of:
   - bypass `node-pty`/ConPTY for specific direct TUI commands such as `pi`, or
   - investigate/patch `node-pty`/ConPTY behavior, or
   - find a way to make pi avoid the ConPTY transformation path.

## Diagnostic tools

### `flicker-probe.js`

Synthetic terminal probes used to isolate protocol/renderer behavior.

Useful modes:

```bash
node diagnostics/flicker-probe.js single
node diagnostics/flicker-probe.js ratatui
node diagnostics/flicker-probe.js split 20
node diagnostics/flicker-probe.js syncsplit 20
node diagnostics/flicker-probe.js fullsync
node diagnostics/flicker-probe.js scrollsync
node diagnostics/flicker-probe.js stylesync 8 16
```

### `pty-recorder.js`

Runs a command inside `node-pty`, mirrors output to the current terminal, and records chunk/timing/control-sequence summaries. With `--raw`, stores raw output bytes as base64.

Examples:

```bash
node diagnostics/pty-recorder.js --raw -- pi --no-session
node diagnostics/pty-recorder.js --raw --conpty -- pi --no-session
node diagnostics/pty-recorder.js --raw --conpty-dll -- pi --no-session
node diagnostics/pty-recorder.js --raw --passthrough -- pi --no-session
node diagnostics/pty-recorder.js --raw --winpty -- pi --no-session
```

`--passthrough` requires patched Windows node-pty binaries; it implies the bundled
`conpty.dll` path and sets `LEAN_TERMINAL_CONPTY_PASSTHROUGH=1` around the
native spawn call.

This recorder is intentionally invasive on Windows because it nests a PTY inside the current terminal. That invasiveness became part of the diagnosis.

### `win-console-recorder.js` and `win-stdio-shim.js`

Windows-only recorder that avoids nested `node-pty` and uses `child_process.spawn` with piped stdout/stderr. It injects `win-stdio-shim.js` through `NODE_OPTIONS` so Node-based CLIs such as `pi` still see the parent console size and TTY-like stdout metadata.

Example:

```powershell
node diagnostics/win-console-recorder.js -- pi --no-session
```

This produced the key smooth WT direct-console evidence capture.

### `summarize-pty-log.js`

Summarizes recorder JSONL files.

```bash
node diagnostics/summarize-pty-log.js --compact diagnostics/captures/<file>.jsonl
node diagnostics/summarize-pty-log.js --json diagnostics/captures/<file>.jsonl
```

### `analyze-sync-coverage.js`

Requires a raw capture. Splits decoded output into bytes/counts inside vs outside `ESC[?2026h ... ESC[?2026l` spans.

```bash
node diagnostics/analyze-sync-coverage.js diagnostics/captures/<raw-file>.jsonl
```

### `replay-pty-log.js`

Replays raw captures. This is useful for some controlled output, but normal-buffer TUI replays are geometry/state-sensitive and can look chaotic if terminal size or scroll state differs.

```bash
node diagnostics/replay-pty-log.js --sandbox --fit-capture diagnostics/captures/<raw-file>.jsonl
```

## Retained local evidence captures

`diagnostics/captures/` is ignored by git. The following local files were intentionally retained as evidence:

- `2026-04-25T06-49-02-861Z-codex.jsonl` — Codex in Obsidian terminal; useful baseline that Codex emits sync markers but also flickers in WT.
- `2026-04-25T06-51-11-513Z-codex.jsonl` — Codex in Windows Terminal; comparison for the Codex baseline.
- `2026-04-25T08-13-25-044Z-pi.jsonl` — `pi --no-session` in Obsidian terminal through plugin/node-pty/ConPTY; flickery; 17.6% inside sync.
- `2026-04-25T08-53-17-912Z-pi.jsonl` — `pi --no-session` through `pty-recorder.js` in Windows Terminal, therefore nested node-pty/ConPTY; flickery; 21.8% inside sync.
- `2026-04-25T08-59-12-098Z-pi-console.jsonl` — `pi --no-session` through `win-console-recorder.js` in Windows Terminal, no nested PTY; smooth; 97.3% inside sync.
- `2026-04-25T09-02-20-898Z-pi.jsonl` — `pi --no-session` through `pty-recorder.js --winpty` in Windows Terminal; chaotic; sync markers not preserved.

Removed transient/invalid captures included failed console-recorder attempts, narrow-width console-recorder attempts before the stdio shim, and an oversized `pi -r` replay capture superseded by cleaner `pi --no-session` captures.

## Recommended next move

Implement and validate **ConPTY passthrough mode** as described in
`diagnostics/conpty-passthrough-plan.md`. A direct-process mode remains useful
as a fallback/escape hatch, but the preferred root-cause fix is now:

```text
Obsidian plugin -> patched node-pty -> bundled conpty.dll with PSEUDOCONSOLE_PASSTHROUGH_MODE -> xterm.js
```

If passthrough restores `pi --no-session` sync coverage to roughly the direct
console-recorder range, the direct-process workaround can be retired.
