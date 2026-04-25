# Win10 ConPTY passthrough handoff

This is a handoff note for a future agent running on a Windows 10 machine. The
current Windows 11 test confirmed that ConPTY passthrough fixes the `pi` flicker
case in the Obsidian plugin. The next question is whether the same patched
`node-pty` + bundled `conpty.dll` path works on Windows 10.

## Current state

Implemented in the repo:

- `patches/conpty-passthrough.patch` patches `node-pty/src/win/conpty.cc` so the
  native addon ORs `PSEUDOCONSOLE_PASSTHROUGH_MODE` into the pseudoconsole flags
  when both are true:
  - node-pty was spawned with `useConptyDll: true`, and
  - parent env has `LEAN_TERMINAL_CONPTY_PASSTHROUGH=1`.
- `src/pty-manager.ts` requests the bundled `conpty.dll` path and temporarily
  sets the parent env around `nodePty.spawn()`.
- `src/settings.ts` adds a Windows-only "ConPTY passthrough mode" toggle,
  default on.
- `diagnostics/pty-recorder.js` has diagnostic flags:
  - `--conpty-dll` uses bundled `conpty.dll` without passthrough.
  - `--passthrough` uses bundled `conpty.dll` and requests passthrough.
- `install.mjs` detects a patched local Windows build and writes
  `.binary-manifest.json` with:

  ```json
  "nativePatch": "conpty-passthrough-v1"
  ```

Important: the plugin currently gates normal UI passthrough to Windows build
`>= 22621` in `supportsConptyPassthrough()` (`src/pty-manager.ts`). On Win10,
that means the Obsidian plugin will **not** request passthrough unless the gate
is changed or a force/probe mechanism is added. The diagnostic recorder does not
have that OS-build gate, so test Win10 there first.

## Baseline evidence from Win11

Before passthrough:

- Obsidian/node-pty/ConPTY: about `17.6%` inside DECSET 2026 sync spans.
- Nested `pty-recorder.js`/ConPTY: about `21.8%` inside sync.
- Direct console recorder: about `97.3%` inside sync and visually smooth.

After local patched passthrough was installed into Obsidian on Win11, `pi` was
visually smooth in the plugin.

## Goal on Win10

Determine whether the bundled modern `conpty.dll` can honor
`PSEUDOCONSOLE_PASSTHROUGH_MODE` on Windows 10, especially Win10 22H2
(build 19045).

Success target:

- `node diagnostics/analyze-sync-coverage.js <passthrough-capture>` reports
  roughly `>= 90%` bytes inside sync for `pi --no-session`, or at least a large
  jump from the default/nested ConPTY baseline.
- Visual `pi --no-session` in the Obsidian plugin is smooth after the plugin gate
  is relaxed/probed.

If sync coverage remains under about `50%`, passthrough is probably not honored
on that Win10 setup.

## Setup on the Win10 machine

From the repo after pulling this commit:

```powershell
npm ci
npm run build
```

Then make sure local `node_modules/node-pty` has the native patch and rebuilt
Windows binaries.

Preferred local native build path, from a Visual Studio Developer PowerShell or
Developer Command Prompt with C++ build tools installed:

```powershell
cd node_modules/node-pty

git apply --unidiff-zero ../../patches/conpty-passthrough.patch
npx --yes node-gyp rebuild --arch=x64
$env:npm_config_arch = "x64"
node scripts/post-install.js
Remove-Item Env:npm_config_arch -ErrorAction SilentlyContinue

cd ../..
```

Notes:

- `--unidiff-zero` is intentional. The patch is compact and was validated this
  way against the npm `node-pty@1.1.0` tarball.
- The patch also changes `#include <node_api.h>` to `#include <napi.h>` because
  the source uses the C++ `Napi::` API and needs node-addon-api in local builds.
- On the original Win11 dev machine, VS2026/MSBuild hit an internal StringTools
  error. The release workflow was pinned to `windows-2022` to avoid that. If a
  Win10 local build hits a similar MSBuild issue, try VS Build Tools 2022.

Verify the patched build exists:

```powershell
Test-Path node_modules/node-pty/build/Release/conpty.node
Test-Path node_modules/node-pty/build/Release/conpty/conpty.dll
Test-Path node_modules/node-pty/build/Release/conpty/OpenConsole.exe
```

## Diagnostic test sequence

Run these from the repo root. Keep the raw captures; they are ignored by git
under `diagnostics/captures/`.

### 1. Default/nested ConPTY baseline

```powershell
node diagnostics/pty-recorder.js --raw -- pi --no-session
node diagnostics/analyze-sync-coverage.js diagnostics/captures/<baseline-file>.jsonl
```

Expected current-problem shape: low inside-sync percentage, likely around the
old `20%` range.

### 2. Bundled conpty.dll without passthrough

```powershell
node diagnostics/pty-recorder.js --raw --conpty-dll -- pi --no-session
node diagnostics/analyze-sync-coverage.js diagnostics/captures/<conpty-dll-file>.jsonl
```

This separates "using bundled conpty.dll" from "using passthrough mode".

### 3. Bundled conpty.dll with passthrough

```powershell
node diagnostics/pty-recorder.js --raw --passthrough -- pi --no-session
node diagnostics/analyze-sync-coverage.js diagnostics/captures/<passthrough-file>.jsonl
```

This is the key Win10 test. If the inside-sync percentage jumps near the direct
console result, Win10 passthrough is viable.

Optional: add `--samples` to the analyzer to inspect what remains outside sync:

```powershell
node diagnostics/analyze-sync-coverage.js --samples diagnostics/captures/<file>.jsonl
```

## If diagnostics succeed on Win10

The plugin still has a Win11-only gate. The next implementation step is one of:

### Conservative quick gate

Change `supportsConptyPassthrough()` in `src/pty-manager.ts` from:

```ts
return buildNumber !== undefined && buildNumber >= 22621;
```

to a validated Win10 threshold, probably starting with Win10 22H2 only:

```ts
return buildNumber !== undefined && buildNumber >= 19045;
```

Then:

```powershell
npm run build
node install.mjs "C:\\path\\to\\ObsidianVault"
```

Close Obsidian before running `install.mjs`; otherwise native binaries can be
locked and the install will leave old binaries in place.

After install, verify:

```powershell
Get-Content "C:\\path\\to\\ObsidianVault\\.obsidian\\plugins\\lean-terminal\\node_modules\\node-pty\\.binary-manifest.json"
```

It should include:

```json
"nativePatch": "conpty-passthrough-v1"
```

### Better long-term gate

Add an automatic capability probe instead of a fixed OS-build threshold:

1. Spawn a tiny child through patched node-pty with:
   - `useConpty: true`
   - `useConptyDll: true`
   - parent env `LEAN_TERMINAL_CONPTY_PASSTHROUGH=1`
2. Have it emit a small synchronized-output sequence.
3. Check whether the raw `ESC[?2026h ... ESC[?2026l` markers survive.
4. Cache the result by OS build / arch / plugin version / conpty.dll version or
   hash.
5. Use setting modes like `Auto / On / Off`.

This avoids guessing whether a particular Win10 build supports the flag.

## Obsidian visual validation

After relaxing/probing the gate and installing into the Win10 vault:

1. Restart Obsidian.
2. Open the Lean Terminal panel.
3. Ensure setting "ConPTY passthrough mode" is on.
4. Run:

   ```powershell
   pi --no-session
   ```

Expected success: smooth rendering, similar to direct Windows Terminal.

Also spot-check ordinary shell behavior:

- `pwsh` startup
- `cmd`
- paste
- Ctrl+C
- resize
- simple Node command
- any available native TUI (`vim`, `nvim`, etc.)

## Updating docs after Win10 result

If Win10 succeeds, update:

- `diagnostics/README.md` with a new sync-coverage row for Win10 passthrough.
- `diagnostics/conpty-passthrough-plan.md` with the validated Win10 build(s) and
  the chosen gate/probe behavior.

Do not commit raw captures unless explicitly requested; `diagnostics/captures/`
is intentionally ignored.

## Troubleshooting interpretation

- Spawn fails immediately with `useConptyDll:true`: bundled `conpty.dll` may not
  load on that Win10 build, or the native build/package is incomplete.
- `--conpty-dll` works but `--passthrough` has no sync-coverage improvement:
  flag is probably ignored by bundled conpty.dll on that OS build.
- `--passthrough` improves sync coverage but shell/cmd behavior regresses:
  consider keeping passthrough per-tab/per-command or adding `Auto / On / Off`.
- Diagnostics succeed but Obsidian is still flickery: check that the plugin was
  installed while Obsidian was closed and that `.binary-manifest.json` contains
  `nativePatch: conpty-passthrough-v1`; also check the Win10 gate in
  `supportsConptyPassthrough()`.
