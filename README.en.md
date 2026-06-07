# Cursor IME HUD

[简体中文](README.md) | English

Cursor IME HUD is a VS Code extension for Windows that shows a lightweight semi-transparent IME label near the primary caret and mirrors the current state in the status bar.

The extension is intentionally narrow in scope:

- show the current input state near the caret
- keep the signal low-noise and readable
- fall back to the status bar and diagnostics when the state is unknown
- avoid any automatic IME switching or semantic heuristics

## Features

- Caret-adjacent HUD rendered with `TextEditorDecorationType`
- Built-in label styles for `中` / `英` and `ZH` / `EN`
- Conservative `unknown` handling:
  - overlay hides when the state is unknown
  - status bar shows `?`
  - a short 500ms grace window can briefly keep the last stable state to reduce flicker
- Windows native helper process for IME state detection
- Status bar fallback with tooltip details
- Diagnostics command with raw detector information and recent logs

### Assets

<!-- TODO: Add a screenshot of the HUD in cn and en modes. A real animated GIF is preferred but static PNGs are acceptable. Drop the file under resources/screenshots/ and reference it here; the marketplace metadata will pick it up automatically. -->

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

| Setting                                        | Default  | Notes                                                                                                |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `cursorImeHud.overlay.enabled`                 | `true`   | Enables the caret-adjacent HUD.                                                                      |
| `cursorImeHud.overlay.labelPreset`             | `custom` | Label preset: `custom` uses custom labels, `zh-en` shows `中` / `英`, and `en-zh` shows `ZH` / `EN`. |
| `cursorImeHud.overlay.cnLabel`                 | `中`     | Custom label used for Chinese input mode when `labelPreset` is `custom`.                             |
| `cursorImeHud.overlay.enLabel`                 | `英`     | Custom label used for English input mode when `labelPreset` is `custom`.                             |
| `cursorImeHud.overlay.opacity`                 | `0.78`   | Background opacity for the overlay.                                                                  |
| `cursorImeHud.overlay.mode`                    | `text`   | `text+icon` is reserved for future work and currently behaves the same as `text`.                    |
| `cursorImeHud.statusBar.enabled`               | `true`   | Shows the current state in the status bar.                                                           |
| `cursorImeHud.overlay.hideWhenEditorUnfocused` | `true`   | Hides the overlay when the VS Code window loses focus.                                               |
| `cursorImeHud.overlay.offsetX`                 | `6`      | Horizontal offset for the overlay.                                                                   |
| `cursorImeHud.overlay.offsetY`                 | `0`      | Vertical offset for the overlay.                                                                     |

> The VS Code/Cursor Settings UI and command titles follow the editor display language automatically: Simplified Chinese uses Chinese strings, while English and unsupported locales fall back to English. Setting IDs such as `cursorImeHud.overlay.enabled` remain stable.

### Configuration deep-dive

- **500ms grace period.** When a snapshot reports `unknown`, the controller keeps the last stable `cn` or `en` state for up to 500ms before falling back to `unknown`. This avoids flicker when Windows briefly drops IME signals (e.g. when a context menu opens). The grace window resets on every fresh `cn`/`en` snapshot.
- **`overlay.labelPreset`.** Use `custom` to keep the editable `cnLabel` / `enLabel` strings, `zh-en` for `中` / `英`, or `en-zh` for `ZH` / `EN`.
- **`overlay.opacity` (0.15 - 1.0).** The value is a multiplier on the background alpha used by `TextEditorDecorationType`. Values below `0.15` may become hard to see; values above `1.0` are clamped. The default `0.78` is tuned for typical light and dark themes.
- **`overlay.mode = "text+icon"`.** Reserved for a future dual-render mode (label plus a tiny icon glyph). In v1 it behaves identically to `"text"`. The setting is exposed so user `settings.json` does not need to change when the icon path lands.
- **`overlay.hideWhenEditorUnfocused`.** When `true` (default), the overlay is cleared whenever the active editor loses focus, the workbench is hidden, or the window is minimized. The status bar continues to reflect the latest state. Set to `false` if you want the HUD to remain visible across window blur (rarely useful).

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
- The native helper is conservative and can return `unknown` when Windows does not expose enough reliable IME signals
- `text+icon` is not a distinct rendering mode yet
- The bundled helper is a self-contained single-file executable, so package size is still relatively large

### Language support

The native helper currently detects Chinese IME only (Win32 primary language id `0x0004`). Japanese (`0x0011`), Korean (`0x0012`), and other CJK IMEs will be reported as `en` or `unknown`. Generalizing the detector to additional primary language ids and to non-Chinese input methods is tracked as future work; see `docs/helper-protocol.md` for the wire format and `ARCHITECTURE.md` for the detector extension points.

## How it works

The native helper uses Windows IMM32 APIs (`ImmGetOpenStatus`, `ImmGetDescription`) and `GetKeyboardLayout` to detect the Chinese primary language id `0x0004` for the foreground window. It streams state, log, and snapshot messages to the extension over a line-delimited JSON protocol on stdio (UTF-8, max 64KB per line, 1MB rolling buffer) - see `docs/helper-protocol.md` for the full wire format. The extension parses each line via `src/detector/helperProtocol.ts` and forwards the result to a `ImeDetector` chain (`SampleOrNativeDetector`) that prefers the native helper and falls back to the in-process `SampleImeDetector` on macOS/Linux or if the helper is unavailable. The helper integrity check reads the generated `resources/bin/win-x64/WinImeWatcher.exe.sha256` sidecar. The extension never reads file contents, the clipboard, or typed text; the helper only inspects IME state for the foreground window.

## Troubleshooting

- **HUD never appears.**
  - Open the **Output** channel and select **Cursor IME HUD**. Look for `hello` handshake failures, JSON parse errors, or helper exit events.
  - Run the **Cursor IME HUD: Show Diagnostics** command. It prints the current detector source, lifecycle phase, last snapshot, and the rolling log buffer.
  - Verify `resources/bin/win-x64/WinImeWatcher.exe` exists and that the adjacent `resources/bin/win-x64/WinImeWatcher.exe.sha256` sidecar matches. `npm run build:helper` regenerates both files on Windows. A mismatch disables the helper and the extension falls back to the sample detector.
  - On macOS and Linux, the native helper cannot run. The extension automatically falls back to `SampleImeDetector`, which reports `unknown` so diagnostics and fallback paths can still be tested. This is expected.
- **Status bar shows `?` persistently.**
  - The foreground window is non-Chinese (e.g. Explorer, a browser, a non-IME-aware app) - the helper correctly reports `unknown` in that case.
  - The active IME is not Chinese (Japanese, Korean, etc.) - see [Language support](#language-support) above.
  - The helper process has crashed or stalled. Run **Cursor IME HUD: Refresh IME State** to force a re-probe; if the status bar recovers, the helper was alive but the foreground window was unresponsive.
- **Extension fails to activate.**
  - Check the **Output** channel for the host extension log. Activation requires `package.json` `engines.vscode` `^1.107.0`.
  - If activation throws synchronously, VS Code surfaces the error in the Extensions view. Open an issue with the full stack trace from the Output channel.

## Frequently Asked Questions

- **Does the helper require administrator privileges?**
  No. The helper only uses user-mode IMM32 APIs (`ImmGetOpenStatus`, `ImmGetDescription`) and `GetKeyboardLayout`. It does not require elevation, UAC consent, or a driver.
- **What does the Diagnostics command show?**
  It shows the current `ImeSnapshot` (state, timestamp, IME name, layout hex, hwnd, reason, confidence), the active detector source (native-helper or sample), the controller lifecycle phase, and the last ~50 log entries.
- **Can I replace `WinImeWatcher.exe` with my own build?**
  Yes, but the integrity check compares the file against the adjacent `WinImeWatcher.exe.sha256` sidecar. A mismatch disables the helper and you will see `helper integrity check failed` in the Output channel. Rebuild with `npm run build:helper` so the sidecar is regenerated, or update the sidecar after you intentionally replace the binary.
- **Why is only the primary caret rendered?**
  Multi-caret decoration composition requires careful handling of `revealRange`, selection, and overlap. It is tracked as future work to avoid surprising layout regressions in v1.
- **What happens on empty lines?**
  The HUD renders on empty lines by anchoring a zero-width `TextEditorDecorationType` range at the caret. The status bar still updates with the latest state if a theme or layout makes the overlay hard to see.

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

Before publishing, make sure `package.json` contains your Marketplace publisher id:

- `publisher`: `chestnut-ch`

The repository metadata already points to the real GitHub repository:

- Repository: `https://github.com/GJYNBB/cursor-ime-hud`
- Issues: `https://github.com/GJYNBB/cursor-ime-hud/issues`

Login and publish with `vsce`:

```powershell
npx @vscode/vsce login chestnut-ch
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
