# Architecture

This document describes the internal layering, data flow, helper IPC, and lifecycle of `cursor-ime-hud`. It is intended for contributors who need to extend the extension or debug a non-trivial issue. End-user documentation lives in `README.md`; the wire protocol is specified in `docs/helper-protocol.md`.

## Layering

The TypeScript source is split into seven top-level layers under `src/`. The dependency direction is strictly downward: lower layers do not import from higher layers.

| Layer         | Path              | Responsibility                                                                                                                                                                |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/`      | `src/model/`      | Pure data types (`ImeSnapshot`, `DetectorLogEntry`, `ImeState`, `ImeDetectorDebugInfo`). No VS Code or Node imports.                                                          |
| `contracts/`  | `src/contracts/`  | Pure cross-layer interfaces (`OverlayRenderer`, `OverlayPlacement`, `StatusBarPresenterContract`, …). No implementation code.                                                 |
| `detector/`   | `src/detector/`   | Produces `ImeSnapshot` values. Wraps the native helper, the sample detector, and the `SampleOrNativeDetector` selection chain. Owns the wire protocol parser.                 |
| `controller/` | `src/controller/` | Turns snapshots into a presentable `HudState` (grace period, reason string, render dedup). Holds `HudController`, the `EditorHost` abstraction, and the QuickPick menu model. |
| `renderer/`   | `src/renderer/`   | Renders a `HudState` as a `TextEditorDecorationType` near the primary caret. Pure: takes inputs, calls VS Code APIs, returns nothing.                                         |
| `presenters/` | `src/presenters/` | Renders the same `HudState` to other surfaces (status bar, diagnostics output).                                                                                               |
| `services/`   | `src/services/`   | Cross-cutting concerns: `LoggerService`, `SettingsService`, configuration debouncing, output channel.                                                                         |

The `commands/` directory is a thin facade: each command resolves a service from `Composition.ts` and invokes a single method. `extension.ts` calls the composition root and disposes everything in `context.subscriptions`.

### Dependency rules

- `model/` imports nothing from the project.
- `contracts/` may import from `model/` only - never from an implementation layer.
- `detector/` may import from `model/` and standard library only.
- `services/` may import from `model/` and the port interfaces in `controller/ports.ts`.
- `controller/` may import from `model/`, `detector/`, `services/`, and `contracts/` - never from `renderer/` or `presenters/` implementations; it reaches those surfaces only through the interfaces in `contracts/`.
- `renderer/` and `presenters/` may import from `model/` and `contracts/` - never from `detector/` or `controller/`.
- `commands/` may import from anywhere except `extension.ts` directly.
- `Composition.ts` is the only file that constructs the full object graph.

These rules are enforced by the per-directory `no-restricted-imports` blocks in `eslint.config.js`; `npm run lint` fails on any violation. Test code under `src/test/` is exempt and may import from any layer.

## Data flow

The hot path is a single push-based pipeline:

```
platform native helper
        │ line-delimited JSON over stdio
        ▼
NativeHelperImeDetector (src/detector/NativeHelperImeDetector.ts)
        │ ImeSnapshot
        ▼
SampleOrNativeDetector (src/detector/SampleOrNativeDetector.ts)
        │ ImeSnapshot (or an unknown fallback snapshot from SampleImeDetector)
        ▼
HudController (src/controller/HudController.ts)
        │ applies 500ms grace period, computes reason, updates lifecycle
        ▼
HudState (src/controller/HudState.ts)
        │ immutable per-tick value object
        ├─► CursorOverlayRenderer  (caret-adjacent TextEditorDecorationType)
        └─► StatusBarPresenter      (status bar text + tooltip)
```

Key properties:

- **One-way data flow.** `HudController` never queries the renderer or the status bar. It pushes; the surfaces subscribe via callbacks wired up in `Composition.ts`.
- **Immutable snapshots.** Every `ImeSnapshot` is a fresh object. The controller, renderer, and presenters never mutate shared state.
- **Bounded buffers.** The detector keeps a rolling log buffer. The stream reader caps each line at 64KB and the read buffer at 1MB; overflow tears down the offending helper process and schedules a fresh one.

## Helper IPC

The extension communicates with the Rust-built platform helper over stdio using a line-delimited JSON protocol. Windows packages use `ImeWatcher.exe`; macOS and Linux packages use `ImeWatcher`. The full specification - including the `hello` handshake, state, log, and command messages, line and buffer limits, and exit codes - is documented in [`docs/helper-protocol.md`](docs/helper-protocol.md).

The TypeScript side parses each line via the functions in `src/detector/helperProtocol.ts`:

- `parseHelloLine` validates the first message the helper emits.
- `parseSnapshotLine` converts a `state` line into an `ImeSnapshot`.
- `parseLogLine` converts a `log` line into a `DetectorLogEntry`.

`NativeHelperImeDetector` is responsible for spawning the helper, performing a fresh handshake for every helper process, sending `{ "command": "refresh" }` commands, enforcing the `.sha256` sidecar, and surfacing unexpected exits through the lifecycle (see `Lifecycle` below).

## Lifecycle

`NativeHelperImeDetector` exposes a finite state machine via the `HelperLifecycleState` string union (idle / starting / running / stopping / disposed). The state is observable through `Show Diagnostics` and the status bar tooltip.

```
   ┌──────────┐
   │  idle    │ (extension not yet activated)
   └────┬─────┘
        │ activate()
        ▼
   ┌──────────┐
   │ starting │ (helper spawn + handshake)
   └────┬─────┘
        │ hello received
        ▼
   ┌──────────┐
   │ running  │ (snapshots flowing)
   └────┬─────┘
        │ deactivate() or fatal error
        ▼
   ┌──────────┐
   │ stopping │ (helper graceful shutdown)
   └────┬─────┘
        │ helper exited
        ▼
   ┌──────────┐
   │ disposed │ (terminal)
   └──────────┘
```

Rules:

- `dispose()` is **idempotent**. Calling it from `running`, `stopping`, or `disposed` produces the same final state and never throws. Each resource handle (child process, line reader, decoration types) is released by its owner's `dispose()`, all of which are wired into `context.subscriptions` by `Composition.ts`. The native helper's child process is shut down by `NativeHelperImeDetector` via stdin-close / kill / wait, with `taskkill /F /T` fallback on Windows.
- A failure during `starting` (handshake timeout, protocol mismatch, integrity check failure) is reported as a log entry of level `error`; `SampleOrNativeDetector` falls back to an `unknown` sample snapshot so diagnostics remain available.
- A failure after `running` (unexpected exit, oversized stdout/stderr, or stream parser failure) tears down the exact helper process that failed, synthesizes an `unknown` snapshot, and schedules a bounded restart. Each restarted helper must send a fresh protocol `hello`.

## Extension points

- **New detector.** Implement `ImeDetector` in `src/detector/` and add it to the `SampleOrNativeDetector` selection chain. See `CONTRIBUTING.md#adding-a-new-detector`.
- **New surface.** Define its interface in `src/contracts/`, implement it under `src/presenters/`, and inject it through `Composition.ts` so the controller depends only on the contract.
- **New setting.** Extend `SettingsService` and add the schema entry to `package.json#contributes.configuration`. Settings flow into the controller via debounced subscriptions.

## Testing strategy

- **Unit tests** live under `src/test/` and target the `model/`, `detector/`, `controller/`, and `services/` layers. They run cross-platform on Node.js 24. The suite runner (`src/test/suite/index.ts`) discovers every compiled `*.test.js` file automatically, so new test files need no registration.
- **Helper smoke tests** exercise the protocol against helpers that can run on the current runner with `--once`. Cross-compiled targets such as Linux ARM helpers built on an x64 runner are built and packaged, while execution smoke tests are skipped by `scripts/assert-helper-once.js` because the binary cannot run on the host CPU.
- **Manual verification** is described in `README.md#从源码开发`.

See `CONTRIBUTING.md#how-to-run-a-single-test` for running individual files or `describe` blocks.
