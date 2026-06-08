# Support

This document explains where to get help and what information to include when reporting Cursor IME HUD problems.

## Supported environment

Cursor IME HUD currently targets:

- Windows 10 or Windows 11 x64 with the bundled Rust `WinImeWatcher.exe` helper
- VS Code `^1.107.0`
- Cursor on a best-effort basis
- Chinese IME detection using the Windows primary language id `0x0004`

Support status:

| Platform          | Status                   | Notes                                                                                                                                      |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 10/11 x64 | Stable                   | Current production path with bundled Rust helper.                                                                                          |
| macOS             | Experimental development | Native-helper path resolution exists behind an experimental switch; helper binaries and exact input-source behavior still need validation. |
| Linux x64/arm64   | Experimental development | Native-helper path resolution exists behind an experimental switch; Fcitx5 / IBus validation is planned first.                             |
| Other platforms   | Fallback                 | The extension can load for development and fallback testing, but reports `unknown`.                                                        |

Japanese, Korean, and other non-Chinese IMEs are not accurately detected in the current stable Windows path. Older classic/.NET-helper packages are historical releases and are not the current supported implementation.

## Where to ask for help

- For bugs, use the GitHub bug report template.
- For feature ideas, use the GitHub feature request template.
- For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead of filing public exploit details.

Before opening an issue, please check the troubleshooting sections in [README.md](README.md) or [README.en.md](README.en.md).

## Information to include

Please include:

- Cursor IME HUD extension version
- Install source: Marketplace, GitHub Release VSIX, or local source build
- VS Code or Cursor version
- Operating system version and architecture
- On Linux: desktop environment, X11/Wayland session, and active input framework if known (Fcitx5, IBus, etc.)
- Active IME name/language
- Whether the problem happens in VS Code, Cursor, or both
- Steps to reproduce
- Expected behavior and actual behavior
- Output from the `Cursor IME HUD: Show Diagnostics` command
- Relevant lines from the **Cursor IME HUD** Output channel

If the issue is visual, attach a screenshot or short GIF when possible. Please avoid including private file paths, usernames, window titles, or document contents.

## Native helper checks

When testing from source or from a locally rebuilt package, confirm these files exist after running `npm run build:helper` on Windows:

```text
resources/bin/win-x64/WinImeWatcher.exe
resources/bin/win-x64/WinImeWatcher.exe.sha256
```

If the sidecar hash is missing or mismatched, the extension disables the native helper and falls back to the sample detector. In that state, diagnostics may show `unknown` and the status bar may show `?`.

## Project scope

Cursor IME HUD is designed to show the current IME state only. The project does not plan to add features that require reading typed text, reading the clipboard, analyzing file contents, or automatically switching the user's IME.
