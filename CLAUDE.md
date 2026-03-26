# lean-terminal

Obsidian desktop plugin providing an embedded PTY terminal panel using xterm.js + node-pty. No external windows.

## Stack

- TypeScript 5.8, Obsidian Plugin API (1.5.0+)
- xterm.js 5.5 (terminal rendering) + node-pty 1.0 (pseudo-terminal)
- esbuild (bundler), no test framework

## Commands

```bash
npm install         # Install dependencies
npm run dev         # Watch mode (auto-rebuild on changes)
npm run build       # Production build (minified, type-checked)
node install.mjs    # Copy plugin to D:\Lean Notes vault
```

## Architecture

```
src/
  main.ts                # Plugin lifecycle: commands, ribbon icon, settings
  terminal-view.ts       # Obsidian ItemView: container, resize observer, tab manager
  terminal-tab-manager.ts # Tab UI + terminal session lifecycle (spawn, wiring, cleanup)
  pty-manager.ts         # PTY wrapper: platform shell detection, I/O, resize
  binary-manager.ts      # Download/manage node-pty native binaries from GitHub releases
  settings.ts            # Settings UI (shell, font, theme, cursor, scrollback, location)
  themes.ts              # 4 themes: Obsidian Dark/Light, Monokai, Solarized
  constants.ts           # View type & icon constants
```

Plugin > View > TabManager > PtyManager chain. BinaryManager handles native module downloads separately.

## Key details

- **Desktop-only** (`isDesktopOnly: true`)
- **Native modules**: node-pty NOT bundled by esbuild; loaded at runtime via Electron's `require()`
- **Binary download**: Users click "Download binaries" in Settings; fetches platform-specific node-pty from GitHub releases
- **Windows**: winpty backend + ConoutConnection patch (Obsidian's Electron renderer doesn't support Worker threads for ConPTY)
- **Shell auto-detect**: Windows tries PowerShell 7 then cmd.exe; macOS/Linux uses `$SHELL`
- **CI/CD**: Tag `v*` triggers GitHub Actions (build plugin + native binaries + create release)
- **No tests configured**

## Plugin commands

- `open-terminal` / `close-terminal` / `toggle-terminal`
- `new-terminal-tab`
- `open-terminal-split`
