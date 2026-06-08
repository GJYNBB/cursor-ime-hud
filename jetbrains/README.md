# Cursor IME HUD for JetBrains

Windows-only JetBrains IDE plugin MVP for Cursor IME HUD（输入法状态提示）.

This module is intentionally isolated under `jetbrains/` so the existing VS Code/Cursor extension packaging remains unchanged.

## MVP scope

- Windows native helper only.
- Reuses the existing Rust `WinImeWatcher.exe` protocol from `../docs/helper-protocol.md`.
- Status bar indicator: `IME: 中`, `IME: 英`, or `IME: ?`.
- Actions: refresh IME state, toggle caret HUD setting, show diagnostics.
- Settings: labels, status bar enablement, caret HUD enablement, opacity, offsets, hide when editor unfocused.
- Non-Windows IDEs load safely but do not spawn the helper.

## Build

From this directory, use Gradle 9.x or a Gradle wrapper generated for this module:

```bash
gradle test
gradle buildPlugin
gradle verifyPlugin
```

This scaffold does not commit a wrapper yet because this environment does not have Gradle installed to generate one. Before Marketplace release automation, generate and commit a wrapper from a machine with Gradle available:

```bash
gradle wrapper --gradle-version 9.0.0 --distribution-type bin
```

On Windows, `processResources` runs the repository `scripts/build-helper.ps1` and packages the generated `resources/bin/win-x64/WinImeWatcher.exe` plus its `.sha256` sidecar. On non-Windows hosts, packaging fails fast unless those two helper files already exist, preventing helperless Marketplace ZIPs.

Initial Marketplace publication should be manual. Later CI publishing can use `PUBLISH_TOKEN`, `CERTIFICATE_CHAIN`, `PRIVATE_KEY`, and `PRIVATE_KEY_PASSWORD` secrets.
