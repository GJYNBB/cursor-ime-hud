# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- `npm test` now splits into `test:unit` (cross-platform) and
  `test:integration` (Windows-only) so contributors on Linux/macOS can run
  the unit suite without a Windows toolchain
- `package.json` declares a `resources/screenshots/**/*` slot ready for
  future Marketplace imagery

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

[Unreleased]: https://github.com/GJYNBB/cursor-ime-hud/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/GJYNBB/cursor-ime-hud/releases/tag/v0.0.1
