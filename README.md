# Cursor IME HUD

Cursor IME HUD is a VS Code extension for Windows that shows a lightweight semi-transparent IME label near the primary caret and mirrors the current state in the status bar.

The extension is intentionally narrow in scope:

- show the current input state near the caret
- keep the signal low-noise and readable
- fall back to the status bar and diagnostics when the state is unknown
- avoid any automatic IME switching or semantic heuristics

## Features

- Caret-adjacent HUD rendered with `TextEditorDecorationType`
- Two stable labels by default: `中` and `英`
- Conservative `unknown` handling:
  - overlay hides when the state is unknown
  - status bar shows `?`
  - a short 500ms grace window can briefly keep the last stable state to reduce flicker
- Windows native helper process for IME state detection
- Status bar fallback with tooltip details
- Diagnostics command with raw detector information and recent logs

## Screenshots

Screenshots coming soon.

## Requirements

### To use the extension

- Windows 10 or Windows 11
- VS Code `^1.107.0`

### To build or debug from source

- Node.js 24+
- npm 11+
- .NET 8 SDK

`.NET 8 SDK` is only required when you build the bundled Windows helper from source. It is not required to install the packaged VSIX.

## Development

```powershell
npm install
npm run compile
npm run build:helper
```

## Debugging

1. Open this repository in VS Code.
2. Run:

   ```powershell
   npm install
   npm run compile
   npm run build:helper
   ```

3. Press `F5` and choose `Run Cursor IME HUD`.
4. In the Extension Development Host, open a text file and switch the Windows IME between Chinese and English input.

The repository already includes `.vscode/launch.json` and `.vscode/tasks.json` so the helper build and TypeScript watch flow are ready for local debugging.

## Commands

- `Cursor IME HUD: Toggle Overlay`
- `Cursor IME HUD: Refresh IME State`
- `Cursor IME HUD: Show Diagnostics`

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `cursorImeHud.overlay.enabled` | `true` | Enables the caret-adjacent HUD. |
| `cursorImeHud.overlay.cnLabel` | `中` | Label used for Chinese input mode. |
| `cursorImeHud.overlay.enLabel` | `英` | Label used for English input mode. |
| `cursorImeHud.overlay.opacity` | `0.78` | Background opacity for the overlay. |
| `cursorImeHud.overlay.mode` | `text` | `text+icon` is reserved for future work and currently behaves the same as `text`. |
| `cursorImeHud.statusBar.enabled` | `true` | Shows the current state in the status bar. |
| `cursorImeHud.overlay.hideWhenEditorUnfocused` | `true` | Hides the overlay when the VS Code window loses focus. |
| `cursorImeHud.overlay.offsetX` | `6` | Horizontal offset for the overlay. |
| `cursorImeHud.overlay.offsetY` | `0` | Vertical offset for the overlay. |

## Validation

### Automated

```powershell
npm test
```

This runs:

- TypeScript compilation
- helper build
- extension smoke tests
- focused behavior tests for unknown/fallback, render caching, helper parsing, and detector fallback
- helper `--once` protocol smoke test

### Manual

1. Press `F5` to launch the Extension Development Host.
2. Open a text editor and move the primary caret.
3. Switch the Windows IME state.
4. Verify:
   - the overlay follows the caret without obvious clear/repaint flicker
   - `unknown` hides the overlay and shows `?` in the status bar
   - `Show Diagnostics` reports the detected state, displayed state, reason, and recent logs

## Known Limitations

- Windows only, currently `win-x64` only
- Only the primary caret is rendered in v1
- Empty lines do not render the caret HUD; the status bar remains available
- The native helper is conservative and can return `unknown` when Windows does not expose enough reliable IME signals
- `text+icon` is not a distinct rendering mode yet
- The bundled helper is a self-contained single-file executable, so package size is still relatively large

## Packaging

```powershell
npm run package:vsix
```

This produces a local VSIX such as:

```text
cursor-ime-hud-0.0.1.vsix
```

To install the packaged extension locally:

```powershell
code --install-extension .\cursor-ime-hud-0.0.1.vsix
```

## Marketplace Publishing

Before publishing, replace the single placeholder value in `package.json`:

- `publisher`: `publisher-placeholder`

The repository metadata already points to the real GitHub repository:

- Repository: `https://github.com/GJYNBB/cursor-ime-hud`
- Issues: `https://github.com/GJYNBB/cursor-ime-hud/issues`

Login and publish with `vsce`:

```powershell
npx @vscode/vsce login publisher-placeholder
npx @vscode/vsce publish
```

Version bump shortcuts:

```powershell
npx @vscode/vsce publish patch
npx @vscode/vsce publish minor
npx @vscode/vsce publish major
```

Use:

- `patch` for fixes and compatibility work
- `minor` for backward-compatible feature additions
- `major` for breaking changes

## Project Structure

```text
.
├─ native/WinImeWatcher/
├─ resources/
│  ├─ bin/win-x64/
│  └─ icon.png
├─ scripts/
├─ src/
│  ├─ commands/
│  ├─ controller/
│  ├─ detector/
│  ├─ model/
│  ├─ presenters/
│  ├─ renderer/
│  ├─ services/
│  └─ test/
├─ package.json
└─ README.md
```
