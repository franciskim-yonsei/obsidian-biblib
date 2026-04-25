# ConPTY passthrough mode — implementation plan

Follow-up to `diagnostics/README.md`. The investigation concluded that ConPTY's
reserialization of the child's VT stream is the meaningful transformer that
breaks `pi`'s synchronized output. This document plans the root-cause fix:
enable `PSEUDOCONSOLE_PASSTHROUGH_MODE` so ConPTY writes the child's bytes
through verbatim instead of diffing against its own screen state.

## Why this is viable

`node_modules/node-pty/src/win/conpty.h:27` already declares the flag:

```cpp
#define PSEUDOCONSOLE_PASSTHROUGH_MODE (8u)
```

The header knows about it — node-pty just doesn't pass it. The call site is
`conpty.cc:292`:

```cpp
CreateNamedPipesAndPseudoConsole(info, {cols, rows},
    inheritCursor ? 1/*PSEUDOCONSOLE_INHERIT_CURSOR*/ : 0,
    &hIn, &hOut, &hpc, inName, outName, pipeName, useConptyDll);
```

Fix is OR-ing `PSEUDOCONSOLE_PASSTHROUGH_MODE` (`8u`) into that flags arg.

Two knobs, not one: `useConptyDll == true` calls Microsoft's standalone
`conpty.dll` (the modern one shipped with Windows Terminal) via
`ConptyCreatePseudoConsole`. That's the path that actually honors passthrough.
The legacy `kernel32!CreatePseudoConsole` path may not.

## Phase 0 — Verify (cheap, do first)

1. Confirm `useConptyDll` is reachable from node-pty's JS API (`spawn`
   options). If not, the C++ patch needs to set it unconditionally too.
2. Confirm the bundled `conpty.dll` (in node-pty's prebuild) is recent enough
   that `ConptyCreatePseudoConsole` honors flag `8`. The flag was added with
   conpty.dll v1.20+.
3. Read `windowsPtyAgent.ts` to see how spawn options reach the native call —
   that's where any new JS option would land.
4. Re-skim `BinaryManager` + release CI: confirm prebuild builds happen via
   `prebuildify` in a GitHub Action and we can inject a patch step.

## Phase 1 — Native patch

Single file under `patches/conpty-passthrough.patch`, applied to
`node_modules/node-pty/src/win/conpty.cc`:

- Read env var `LEAN_TERMINAL_CONPTY_PASSTHROUGH` at the call site (cheap, no
  JS API change).
- OR `PSEUDOCONSOLE_PASSTHROUGH_MODE` into `dwFlags` when env var is set AND
  `useConptyDll == true`.
- No-op otherwise (pre-22H2 / non-conpty.dll path keeps existing behavior).

Also force `useConptyDll: true` from the plugin side when passthrough is
requested — the conpty.dll path is what actually carries the flag through.

## Phase 2 — Build & distribute

1. Add a hand-rolled `git apply` step in CI that applies the `.patch` before
   rebuilding the Windows native addon.
2. Rebuild Windows binaries: `win32-x64`, `win32-arm64`. Ship as new
   `node-pty-win32-*.zip` release assets.
3. Bump `manifest.json` version and require a Windows native patch marker in
   `.binary-manifest.json` so old/unpatched local installs are invalidated.
4. Update `checksums.json` for the release.

Local dev note: `install.mjs` installs this Obsidian plugin directly into a
vault and copies whatever is currently under local `node_modules/node-pty`. It
does **not** compile the C++ patch by itself. For Windows passthrough testing via
`install.mjs`, local `node_modules/node-pty/build/Release` must contain a
patched `conpty.node`; otherwise the installed binary manifest intentionally
omits the patch marker and the plugin will ask to download terminal binaries.

Open question: do we also need to ship a refreshed `conpty.dll` in the
prebuild zip, or does node-pty's prebuild already include one? Check
`node_modules/node-pty/conpty/` after a fresh install. If we have to bump
conpty.dll, source it from Microsoft's
[terminal repo releases](https://github.com/microsoft/terminal/releases).

## Phase 3 — Plugin wiring

1. `pty-manager.ts`: detect Windows build ≥ 22621. If yes, spawn with
   `useConptyDll: true` and set env `LEAN_TERMINAL_CONPTY_PASSTHROUGH=1`.
   Older builds: leave alone.
2. Settings: add toggle "ConPTY passthrough mode (Win11 22H2+)" defaulting on
   with help text. Lets users disable for A/B.
3. Re-evaluate `SynchronizedOutputGate`: with passthrough, xterm.js sees the
   source's actual DECSET 2026 markers. xterm.js 5.5 still doesn't natively
   implement 2026, so the gate stays useful — keep it. Verify after.

## Phase 4 — Validate

1. Run `diagnostics/pty-recorder.js --raw -- pi --no-session` from inside the
   Obsidian terminal with passthrough on, capture, and run
   `analyze-sync-coverage.js`. Target: ≥ 90 % inside-sync (vs current 17.6 %).
   If < 50 %, passthrough isn't actually wired through.
2. Visual: pi, codex, ratatui demo, htop (WSL), vim. Spot-check for flicker.
3. Regression: pwsh, cmd, bash login flow — make sure passthrough doesn't
   break things ConPTY normally smooths over (codepage handling on cmd is the
   main suspect). If issues, narrow passthrough to specific child names or
   make the toggle per-tab.
4. Update `diagnostics/README.md` with the new sync-coverage row and
   conclusion.

## Phase 5 — Retire the hack

Once Phase 4 is green, delete:

- `src/direct-process-manager.ts`
- `src/direct-process-shim.ts`
- `createDirectTab` + `kind: "direct" | "shell"` in `terminal-tab-manager.ts`
  (revert `pty: TerminalProcess` back to `pty: PtyManager`)
- `DirectProcessPromptModal` + `direct-process-tab` command in `main.ts`
- The `direct-process-shim.js` file written into `pluginDir`

Keep `diagnostics/` as historical evidence.

## Risks

- **Pre-22H2 users get nothing.** Acceptable — they keep current (flickery)
  behavior, no regression. Could surface a settings notice.
- **conpty.dll version skew.** If the bundled dll predates passthrough
  support, the flag is silently ignored. Phase 0 step 2 catches this; Phase 2
  may need a dll bump.
- **CI complexity.** Patching native code in CI is the heaviest part. If
  rebuild infrastructure isn't set up in the existing release workflow, this
  turns from a 1-line patch into days of CI work. Inspect
  `.github/workflows/` to estimate.
- **node-pty upstreaming.** After validation, file an issue / PR on
  `microsoft/node-pty` to add a `passthroughMode` option natively. Eventually
  drop the local patch.

## Effort estimate

| Phase | Estimate |
| --- | --- |
| 0 — Verification | 30 min |
| 1 — Native patch | 1 hour (literally one OR) |
| 2 — Build / release | 1 day (mostly CI plumbing — heaviest unknown) |
| 3 — Plugin wiring | 1 hour |
| 4 — Validation | half a day |
| 5 — Cleanup | 30 min |

## Pivot points to flag back

1. After Phase 0 if `useConptyDll` isn't surfaced or conpty.dll is too old —
   that materially changes the patch surface.
2. After Phase 2 if CI rebuild infrastructure doesn't exist — we'd need to
   hand-build prebuilds locally for now.
3. After Phase 4 if sync coverage doesn't move significantly — root cause was
   something else and we go back to the drawing board.
