# Background Color Override Setting

## Context

Users want to match their terminal background to their Obsidian note background or other custom colors. Currently, background color is locked to the selected theme with no override.

## Design

### Setting

- New field `backgroundColor` (string, default `""` — empty means use theme default)
- When non-empty, replaces the theme's `background` property before passing to xterm.js

### Settings UI

Single settings row with three controls:

1. **Text input** — accepts any CSS color value (hex `#1e1e1e`, RGB `rgb(30,30,30)`, etc.)
2. **Color picker** — Obsidian's `ColorComponent`, synced bidirectionally with the text input
3. **Reset button** — clears override back to empty (theme default)

When the text input changes, update the color picker (if valid hex). When the color picker changes, update the text input. Non-hex CSS values (like `rgb()`) work in the text input but the color picker only reflects hex values.

### Theme Application

At terminal creation in `terminal-tab-manager.ts`, after calling `getTheme()`, merge the override:

```typescript
const theme = getTheme(this.settings.theme);
if (this.settings.backgroundColor) {
  theme.background = this.settings.backgroundColor;
}
```

### Live Update

When settings change, iterate existing sessions and update via:

```typescript
session.terminal.options.theme = { ...session.terminal.options.theme, background: newColor };
```

This avoids recreating terminals.

## Files

- `src/settings.ts` — add `backgroundColor` to `TerminalPluginSettings` and `DEFAULT_SETTINGS`, add settings row
- `src/terminal-tab-manager.ts` — apply override at creation, add `updateSettings()` method for live updates

## Verification

1. `npm run build` — clean build
2. Install to test vault, open settings
3. Enter hex color in text field — color picker updates, terminal background changes
4. Use color picker — text field updates, terminal background changes
5. Click Reset — background reverts to theme default
6. Switch themes with override set — override still applies
7. Clear override, switch themes — theme background applies normally
