# Cursor IME HUD for JetBrains

Windows-only JetBrains IDE plugin MVP for Cursor IME HUD（输入法状态提示）.

This module is intentionally isolated under `jetbrains/` so the existing VS Code/Cursor extension packaging remains unchanged. The repository `main` branch contains both clients: the VS Code/Cursor extension at the root and this JetBrains plugin in `jetbrains/`.

## MVP scope

- Windows native helper only.
- Reuses the existing Rust `WinImeWatcher.exe` protocol from `../docs/helper-protocol.md`.
- Status bar indicator: `IME: 中`, `IME: 英`, `IME: ZH`, `IME: EN`, or `IME: ?`.
- Caret-adjacent HUD: a small rounded chip near the active editor caret, with `中`/`英`, `ZH`/`EN`, or custom labels.
- Actions: refresh IME state, toggle caret HUD setting, show diagnostics.
- Settings: label/icon preset, custom labels, status bar enablement, caret HUD enablement, opacity, offsets, hide when editor unfocused.
- Non-Windows IDEs load safely but do not spawn the helper.

## Build

From this directory, use the committed Gradle 9.0.0 wrapper:

```bash
./gradlew test
./gradlew buildPlugin
./gradlew verifyPlugin
```

On Windows, `processResources` runs the repository `scripts/build-helper.ps1` and packages the generated `resources/bin/win-x64/WinImeWatcher.exe` plus its `.sha256` sidecar. On non-Windows hosts, packaging fails fast unless those two helper files already exist, preventing helperless Marketplace ZIPs.

Initial Marketplace publication should be manual. Later CI publishing can use `PUBLISH_TOKEN`, `CERTIFICATE_CHAIN`, `PRIVATE_KEY`, and `PRIVATE_KEY_PASSWORD` secrets.
