<p align="center">
  <img src="resources/icon.png" alt="Cursor IME HUD" width="96" height="96">
</p>

<h1 align="center">Cursor IME HUD</h1>

<p align="center">
  Chinese / English IME state, next to your caret<br>
  for <strong>VS Code</strong>, <strong>Cursor</strong>, and <strong>JetBrains IDEs</strong>
</p>

<p align="center">
  <a href="https://github.com/GJYNBB/cursor-ime-hud/releases"><img src="https://img.shields.io/github/v/release/GJYNBB/cursor-ime-hud?label=release" alt="Release"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-%5E1.107.0-007ACC" alt="VS Code"></a>
  <a href="https://www.jetbrains.com/"><img src="https://img.shields.io/badge/JetBrains-2026.1%2B-000000" alt="JetBrains"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

---

You mean to type English. A string of pinyin appears instead.

**Cursor IME HUD** shows the current Chinese / English input state next to the primary caret and mirrors it in the status bar. It indicates only — it never switches IME, and it never reads what you type.

## Preview

<table>
  <tr>
    <td align="center" width="50%">
      <strong>VS Code / Cursor</strong><br>
      <img src="resources/screenshots/vscode-demo.gif" alt="VS Code / Cursor demo" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>JetBrains</strong><br>
      <img src="resources/screenshots/jetbrains-demo.gif" alt="JetBrains demo" width="100%">
    </td>
  </tr>
</table>

## Features

- **Caret HUD** — compact `中` / `英` or `ZH` / `EN` next to the primary caret
- **Status bar** — persistent eye + `输入法：中` / `英` / `?` (eye reflects caret-icon on/off live); hover to click-toggle the caret icon or open settings
- **Two render modes** — icon + text, or text only
- **Cross-platform** — Windows / macOS / Linux via a dedicated Rust native helper
- **Stable under noise** — short `unknown` bursts keep the last stable state; manual refresh can recover helper failures
- **Privacy first** — no file reads, no clipboard, no keystroke logging, no upload of input

## Support

| Area         | Status                                                  |
| ------------ | ------------------------------------------------------- |
| Editors      | VS Code `^1.107.0`, Cursor, JetBrains IDEs `2026.1+`    |
| OS           | Windows 10/11, macOS, Linux                             |
| Arch         | x64 / arm64 (Linux also armhf)                          |
| IME scope    | Primarily Chinese IMEs; reports unknown when unreliable |
| Multi-cursor | Primary caret only                                      |
| Auto-switch  | **Not supported** and never performed                   |

## Install

Download from [GitHub Releases](https://github.com/GJYNBB/cursor-ime-hud/releases):

| Client                               | Artifact                                   |
| ------------------------------------ | ------------------------------------------ |
| VS Code / Cursor                     | `cursor-ime-hud-<version>-<platform>.vsix` |
| VS Code / Cursor (universal offline) | `cursor-ime-hud-<version>.vsix`            |
| JetBrains                            | `cursor-ime-hud-jetbrains-<version>.zip`   |

Platform suffixes: `win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-armhf`.

### VS Code / Cursor

```bash
code --install-extension ./cursor-ime-hud-<version>-win32-x64.vsix
# or
cursor --install-extension ./cursor-ime-hud-<version>-win32-x64.vsix
```

You can also use **Install from VSIX…** in the Extensions view.

### JetBrains

**Settings → Plugins → gear → Install Plugin from Disk…**, then pick the ZIP.

> Released packages already include the native helper. No Rust or build tools are required to install.

## Quick start

1. Install the extension/plugin and reload the IDE
2. Open an editable file and place the caret in the editor
3. Toggle Chinese / English input mode
4. Watch the caret label and status bar

Default labels are `中 / 英`; switch to `ZH / EN` in settings if you prefer Latin labels.

## Configuration

### VS Code / Cursor

| Setting                                        | Default     | Description                           |
| ---------------------------------------------- | ----------- | ------------------------------------- |
| `cursorImeHud.overlay.enabled`                 | `true`      | Show the caret HUD                    |
| `cursorImeHud.overlay.labelPreset`             | `zh-en`     | `zh-en` → 中/英; `en-zh` → ZH/EN      |
| `cursorImeHud.overlay.mode`                    | `text+icon` | `text+icon` or `text`                 |
| `cursorImeHud.overlay.cnColor`                 | `#FF5252`   | Chinese accent color                  |
| `cursorImeHud.overlay.enColor`                 | `#1E90FF`   | English accent color                  |
| `cursorImeHud.overlay.opacity`                 | `0.78`      | Overall HUD opacity (0.15–1)          |
| `cursorImeHud.overlay.backgroundEnabled`       | `true`      | Background in text-only mode          |
| `cursorImeHud.overlay.backgroundOpacity`       | `0.72`      | Background / tile fill opacity        |
| `cursorImeHud.overlay.offsetX`                 | `6`         | Horizontal offset (−50 ~ 50)          |
| `cursorImeHud.overlay.offsetY`                 | `20`        | Vertical offset (−50 ~ 50)            |
| `cursorImeHud.overlay.hideWhenEditorUnfocused` | `true`      | Hide HUD when the window is unfocused |
| `cursorImeHud.statusBar.enabled`               | `true`      | Show the status bar item              |

### JetBrains

The plugin exposes the same core options: HUD / status bar toggles, label preset, colors, opacity, offsets, and hide-on-blur.

## Commands

| Command           | Action                                              |
| ----------------- | --------------------------------------------------- |
| Toggle Overlay    | Show / hide the caret HUD                           |
| Refresh IME State | Force a re-detect; can recover after helper failure |
| Show Diagnostics  | Detector, lifecycle, and recent logs                |

Hover the status bar item to click-toggle the caret icon or open settings.

## Privacy & security

This project only needs to know _Chinese or English_ — never _what you typed_.

- Does not read editor file contents
- Does not read the clipboard
- Does not log or upload keystrokes or typed text
- Does not change system IME state
- The helper queries public platform / IME APIs and returns structured state over stdio
- Helper binaries are verified with `.sha256` sidecars before use

Details:

- [docs/helper-protocol.md](docs/helper-protocol.md)
- [docs/helper-lifecycle.md](docs/helper-lifecycle.md)
- [SECURITY.md](SECURITY.md)

## Repository layout

```text
cursor-ime-hud/
├── src/           # VS Code / Cursor extension (TypeScript)
├── native/        # Cross-platform IME helper (Rust)
├── jetbrains/     # JetBrains plugin (Kotlin)
├── resources/     # Icons, screenshots, packaged helpers
├── docs/          # Protocol & lifecycle docs
└── scripts/       # Build & packaging scripts
```

JetBrains-specific notes: [jetbrains/README.md](jetbrains/README.md).

## Development

Requires Node.js 24+, npm 11+, Rust stable; MSVC on Windows, Xcode CLT on macOS; JDK 21 for JetBrains.

```bash
npm install
npm run compile
npm run lint
npm test

npm run build:helper
npm run package:vsix:target -- --target win32-x64 --out-dir dist/vsix

./jetbrains/gradlew -p jetbrains test
./jetbrains/gradlew -p jetbrains buildPlugin
```

Contribution guide and architecture:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## Troubleshooting

| Symptom                 | What to try                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| No HUD                  | Caret must be in editable text; HUD may be disabled; run Show Diagnostics                         |
| Status bar stuck on `?` | Window may not be a valid IME context, or helper cannot read state; try Refresh IME State         |
| Helper fails to start   | Install the official package for your arch; do not replace the helper or `.sha256` by hand        |
| Linux detection issues  | Ensure Fcitx / IBus / XKB (etc.) is available in the session; diagnostics show the active backend |

When filing an issue, include IDE version, OS/arch, IME name, diagnostics (paths redacted), and whether it reproduces reliably.

## License

[MIT](LICENSE)
