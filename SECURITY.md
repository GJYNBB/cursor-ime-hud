# Security Policy

Thank you for helping keep Cursor IME HUD safe for users. The extension bundles a Windows native helper, so security reports are handled separately from normal bug reports.

## Supported versions

Security fixes are considered for the latest Marketplace version, the latest stable GitHub Release / VSIX, and the current `main` branch. Older historical packages, including classic/.NET-helper releases, generally do not receive backported fixes unless the issue also affects the current Rust-based implementation or release infrastructure.

## Reporting a vulnerability

Please do **not** publish exploit details, proof-of-concept payloads, or sensitive logs in a public issue.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting / Security Advisory flow for this repository if it is enabled.
2. If private reporting is not available, open a public issue with only a short, non-exploit summary and ask the maintainer to establish a private reporting channel.

Include as much of the following as you can safely share:

- Cursor IME HUD version and install source (Marketplace, GitHub Release VSIX, or source build)
- VS Code or Cursor version
- Windows version and architecture
- Whether the official bundled helper was used or replaced locally
- Relevant `Cursor IME HUD` Output channel logs, with usernames, local paths, window titles, and other private details redacted
- Steps to reproduce, kept private when they include exploit details

## Security boundaries

Cursor IME HUD is intentionally narrow in scope:

- It does not read editor file contents.
- It does not read the clipboard.
- It does not read, record, or transmit typed text.
- It does not automatically switch IMEs or keyboard layouts.
- The Windows helper only inspects foreground-window IME state and related Win32 metadata needed to report `cn`, `en`, or `unknown`.

Diagnostics and logs may include environment details such as extension version, detector state, IME name, keyboard layout hex value, helper lifecycle events, and window handles. Please redact anything you consider sensitive before sharing logs publicly.

## Native helper integrity

The packaged extension includes:

```text
resources/bin/win-x64/WinImeWatcher.exe
resources/bin/win-x64/WinImeWatcher.exe.sha256
```

Current releases bundle the official Rust-built `WinImeWatcher.exe`. At runtime, the extension verifies the helper against the adjacent `.sha256` sidecar. This is an operational integrity check for packaging or local replacement mistakes, not a substitute for OS code signing or endpoint protection. If the hash is missing or mismatched, the native helper is disabled and the extension falls back to the sample detector.

Security-sensitive examples include, but are not limited to:

- Bypassing helper integrity checks unexpectedly
- Causing the extension to execute an unintended binary
- Reading or exposing file contents, clipboard contents, or typed text
- Unexpected network communication or telemetry
- Dependency or release packaging issues that could affect users
