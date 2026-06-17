# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2026-06-17

### Added

- Added smoother Ctrl+mouse-wheel zoom tracking for the JetBrains caret HUD so it follows editor zoom more continuously.
- Included the JetBrains plugin artifact alongside the VS Code extension in the formal release process.

### Changed

- Improved JetBrains caret HUD scheduling to render against live editor geometry during zoom bursts and settle cleanly after input stops.
- Kept the existing scroll-follow behavior and normal render paths unchanged.

## [1.0.1] - 2026-06-08

### Added

- Added the Marketplace/README screenshot showing the caret-adjacent `ZH` HUD in a real editor.
- Updated Marketplace-facing overview copy to highlight the screenshot and caret-adjacent IME state display.

## [1.0.0] - 2026-06-08

### Added

- Added a Chinese-searchable Marketplace display name and Chinese keywords for input method, IME state, and caret HUD discovery.

### Changed

- Promoted the Rust-based implementation to the first stable `1.0.0` release.
- Tightened helper protocol parsing, lifecycle shutdown behavior, and cross-platform integration-test handling for the stable release.

## [0.0.3] - 2026-06-08

### Changed

- Replaced the Windows native helper implementation with a Rust `WinImeWatcher.exe` while keeping the existing JSONL protocol, `.sha256` integrity sidecar, and user-facing IME detection behavior unchanged.
- Updated helper build and release automation to use the Rust stable toolchain instead of the .NET SDK.
- Promoted the Rust helper as the only current bundled implementation; earlier classic/.NET helper packages remain available only as historical releases.

## [0.0.2] - 2026-06-07

### Added

- GitHub Actions CI workflow running lint and tests on Ubuntu and Windows
- GitHub Actions release workflow that packages the extension on tag push
- Dependabot configuration for `npm` and `github-actions` updates
- ESLint (flat config for v9) and Prettier tooling with `lint` / `format` scripts
- Coverage tooling (`c8`) and a `coverage` script surfaced in CI
- `galleryBanner` metadata in `package.json` for the VS Code Marketplace
- `engines.node` requirement and explicit `engines.vscode` range
- `prepublishOnly` guard that fails when the publisher is still the placeholder
- `cursorImeHud.overlay.labelPreset` setting for built-in `中` / `英` and `ZH` / `EN` label styles
- English and Simplified Chinese manifest localization for VS Code Settings UI and command titles
- Security, support, and code of conduct documents for public project governance
- GitHub issue templates and a pull request template for structured reports and reviews
- Workspace Trust and virtual workspace capability metadata in the extension manifest

### Changed

- `npm test` now splits into `test:unit` (cross-platform) and
  `test:integration` (Windows-only) so contributors on Linux/macOS can run
  the unit suite without a Windows toolchain
- `package.json` declares a `resources/screenshots/**/*` slot ready for
  future Marketplace imagery
- Packaged VSIX contents now include README-linked architecture, protocol,
  contribution, support, security, and conduct documents
- Cleaned stale publisher placeholder metadata and replaced the screenshot TODO
  with guidance to add only real Marketplace screenshots

### Fixed

- VSIX packaging now includes the composition root and top-level compiled output required for command registration
- Extension tests now run through `@vscode/test-electron`, include the service suite, and pass under Xvfb
- Native helper restarts now tear down broken child processes and validate the `hello` handshake per process
- Native helper no longer treats persistent `unknown` snapshots as a startup failure and now probes the default IME window when `ImmGetContext` is unavailable in Electron-based editors
- Helper integrity checks now fail closed when the `.sha256` sidecar is missing or mismatched
- Helper `--once` smoke test now skips the `hello` handshake and validates the first state record
- `WinImeWatcher` now exits when stdin closes during graceful shutdown
- Diagnostics now report whether the overlay is visible and the concrete hide reason
- Overlay placement now supports empty lines by anchoring the HUD to a zero-width caret range
- `scripts/assert-helper-once.js` no longer fails on non-Windows platforms
  (skips with a clear message)
- Header comment on `src/test/runTest.ts` clarifies it is an alternative
  runner, with `scripts/run-extension-tests.js` as the canonical entry

## [0.0.1] - 2026-04-22

### Added

- Initial release scaffold for Cursor IME HUD
- Caret-adjacent overlay rendering with `TextEditorDecorationType`
- Windows native `WinImeWatcher` helper with JSONL protocol
- Status bar fallback, diagnostics command, settings service, and logger service
- Extension smoke tests, position strategy tests, and helper smoke test
- Marketplace packaging scripts and documentation

[Unreleased]: https://github.com/GJYNBB/cursor-ime-hud/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/GJYNBB/cursor-ime-hud/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/GJYNBB/cursor-ime-hud/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/GJYNBB/cursor-ime-hud/compare/v0.0.3...v1.0.0
[0.0.3]: https://github.com/GJYNBB/cursor-ime-hud/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/GJYNBB/cursor-ime-hud/releases/tag/v0.0.2
[0.0.1]: https://github.com/GJYNBB/cursor-ime-hud/releases/tag/v0.0.1
