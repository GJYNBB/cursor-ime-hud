# Contributing

Thanks for your interest in `cursor-ime-hud`. This document explains how to set up a local development environment, run the test suite, and submit a change.

## Scope

The project is intentionally narrow: show a small IME state label near the primary caret and mirror the state in the status bar. We do not add automatic IME switching, language heuristics, or input interception. Please keep new contributions within that scope.

## Prerequisites

- **Node.js 24+** (matches `package.json` `engines.node`)
- **npm 11+** (ships with Node.js 24)
- **Rust stable toolchain** (`cargo`) - required to build the bundled `WinImeWatcher.exe` from source
- **Windows MSVC Build Tools / Visual Studio C++ toolchain** - required by the Rust `x86_64-pc-windows-msvc` target linker
- **PowerShell 7+** - used by `npm run build:helper` and the helper smoke tests
- **Windows 10 or Windows 11** - required to exercise the native helper end-to-end. macOS and Linux fall back to `SampleImeDetector`, which is sufficient for unit tests but not for manual verification.

The helper is a Rust single-file executable and does not require users of the packaged VSIX to install Rust.

## Development setup

```powershell
npm install
npm run compile
npm run build:helper
npm test
```

`npm run build:helper` publishes `resources/bin/win-x64/WinImeWatcher.exe` and its adjacent `WinImeWatcher.exe.sha256` sidecar, so you do not need to hand-copy any hash into source files.

The repository ships with `.vscode/launch.json` and `.vscode/tasks.json`, so pressing `F5` in VS Code launches the Extension Development Host with the helper build wired in.

## Pull request process

- Target the `main` branch.
- CI must pass. The pipeline (`.github/workflows/ci.yml`) runs `npm run lint`, `npm test`, and a helper smoke test on `windows-latest`.
- Update `CHANGELOG.md` under the `## [Unreleased]` heading when behavior changes.
- When package metadata, README links, or the VSIX allowlist changes, run `npx @vscode/vsce ls --no-dependencies` and confirm the package contents are intentional.
- One reviewer approval is required.
- Commits are squash-merged. Use focused commits locally; the PR body should describe the change and reference any tracking issues.

## Code style

- **TypeScript:** strict mode is enabled in `tsconfig.json`. Prefer explicit types over `any`; introduce narrow types rather than widening.
- **Linting and formatting:** ESLint + Prettier. Run `npm run lint` to check, `npm run format` to apply Prettier.
- **Module layering:** respect the existing layer boundaries - `model/`, `detector/`, `controller/`, `renderer/`, `presenters/`, `services/`. See `ARCHITECTURE.md` for the full rules.
- **TSDoc:** every public export in `src/**` must carry a TSDoc block. Internal helpers that are not exported do not need TSDoc, but magic numbers and non-obvious branches should have inline comments.

## How to run a single test

The test runner is Mocha. Use `--grep` to focus on a single `describe`/`it` pattern. The helper smoke tests only run on Windows.

```powershell
# Run the canonical Extension Host test entrypoint
npm run test:extension

# Focus the VS Code extension test suite by title
npm run test:extension -- --grep "SettingsService"
```

The helper `--once` smoke test ships as `scripts/assert-helper-once.js` and can be invoked directly on Windows after building the helper:

```powershell
npm run build:helper
node scripts/assert-helper-once.js
```

## Adding a new detector

See `ARCHITECTURE.md#data-flow` and `ARCHITECTURE.md#helper-ipc` for the full picture. The short version:

1. Implement `ImeDetector` from `src/detector/ImeDetector.ts`. Return `ImeSnapshot` values; never call VS Code UI APIs from a detector.
2. If the detector wraps a child process, define its protocol in `src/detector/helperProtocol.ts` (or a sibling file) and document the wire format in `docs/helper-protocol.md`.
3. Wire the detector into `SampleOrNativeDetector` so users can opt in via a setting.
4. Add unit tests for parse, error, and timeout paths.
5. Update `docs/helper-protocol.md` and `ARCHITECTURE.md` accordingly.

## Reporting issues

Use the issue templates under `.github/ISSUE_TEMPLATE/` and include:

- VS Code version (`Code > About Visual Studio Code`)
- Extension version (`Cursor IME HUD: Show Diagnostics`)
- The full contents of the **Cursor IME HUD** output channel
- Steps to reproduce

## Code of conduct

Be respectful and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the project conduct policy.
