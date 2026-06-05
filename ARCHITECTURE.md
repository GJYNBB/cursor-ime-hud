# Architecture

This document describes the internal layering, data flow, helper IPC, and lifecycle of `cursor-ime-hud`. It is intended for contributors who need to extend the extension or debug a non-trivial issue. End-user documentation lives in `README.md`; the wire protocol is specified in `docs/helper-protocol.md`.

## Layering

The TypeScript source is split into six top-level layers under `src/`. The dependency direction is strictly downward: lower layers do not import from higher layers.

| Layer | Path | Responsibility |
| --- | --- | --- |
| `model/` | `src/model/` | Pure data types (`ImeSnapshot`, `DetectorLogEntry`, `ImeState`, `ImeDetectorDebugInfo`). No VS Code or Node imports. |
| `detector/` | `src/detector/` | Produces `ImeSnapshot` values. Wraps the native helper, the sample detector, and the `SampleOrNativeDetector` selection chain. Owns the wire protocol parser. |
| `controller/` | `src/controller/` | Turns snapshots into a presentable `HudState` (grace period, reason string, lifecycle). Holds `HudController` and the `EditorHost` abstraction. |
| `renderer/` | `src/renderer/` | Renders a `HudState` as a `TextEditorDecorationType` near the primary caret. Pure: takes inputs, calls VS Code APIs, returns nothing. |
| `presenters/` | `src/presenters/` | Renders the same `HudState` to other surfaces (status bar, diagnostics output). |
| `services/` | `src/services/` | Cross-cutting concerns: `LoggerService`, `SettingsService`, configuration debouncing, output channel. |

The `commands/` directory is a thin facade: each command resolves a service from `Composition.ts` and invokes a single method. `extension.ts` wires the composition root and disposes everything in `context.subscriptions`.

### Dependency rules

- `model/` imports nothing from the project.
- `detector/` may import from `model/` and standard library only.
- `controller/` may import from `model/`, `detector/`, and `services/`.
- `renderer/` and `presenters/` may import from `model/`, `controller/`, and `services/` - never from `detector/`.
- `commands/` may import from anywhere except `extension.ts` directly.
- `extension.ts` is the only file that constructs the full object graph.

Violations are flagged by ESLint `no-restricted-imports` and reviewed in PRs.

## Data flow

The hot path is a single push-based pipeline:

```
native helper (WinImeWatcher.exe)
        │ line-delimited JSON over stdio
        ▼
NativeHelperImeDetector (src/detector/NativeHelperImeDetector.ts)
        │ ImeSnapshot
        ▼
SampleOrNativeDetector (src/detector/SampleOrNativeDetector.ts)
        │ ImeSnapshot (or a synthetic one from SampleImeDetector)
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
- **Bounded buffers.** The detector keeps a rolling 200-entry log buffer. The line parser caps each line at 64KB and the read buffer at 1MB (`src/detector/helperProtocol.ts` and the stream reader in `NativeHelperImeDetector.ts`).

## Helper IPC

The extension communicates with `WinImeWatcher.exe` over stdio using a line-delimited JSON protocol. The full specification - including the `hello` handshake, state, log, and command messages, line and buffer limits, and exit codes - is documented in [`docs/helper-protocol.md`](docs/helper-protocol.md).

The TypeScript side parses each line via the functions in `src/detector/helperProtocol.ts`:

- `parseHelloLine` validates the first message the helper emits.
- `parseSnapshotLine` converts a `state` line into an `ImeSnapshot`.
- `parseLogLine` converts a `log` line into a `DetectorLogEntry`.

`NativeHelperImeDetector` is responsible for spawning the helper, performing the handshake, sending `refresh` commands, and surfacing unexpected exits through the lifecycle (see `Lifecycle` below).

## Lifecycle

`HudController` exposes a finite state machine via the `HelperLifecycleState` string union (idle / starting / running / stopping / disposed). The state is observable through `Show Diagnostics` and the status bar tooltip.

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

- Transitions are unidirectional. There is no `running → starting`; a crash moves to `stopping` first, and the controller can be re-started only via `Refresh IME State`.
- `dispose()` is **idempotent**. Calling it from `running`, `stopping`, or `disposed` produces the same final state and never throws. All resource handles (child process, line reader, decoration types) are released in `HudController.dispose()`. The native helper's child process is shut down via the stdin-close / SIGTERM / wait sequence in `NativeHelperImeDetector.dispose()` (with `taskkill /F /T` fallback on Windows).
- A failure during `starting` (handshake timeout, protocol mismatch, integrity check failure) is reported as a log entry of level `error` and transitions directly to `disposed`. The extension surfaces this in the status bar tooltip and in the **Cursor IME HUD** output channel.

## Extension points

- **New detector.** Implement `ImeDetector` in `src/detector/` and add it to the `SampleOrNativeDetector` selection chain. See `CONTRIBUTING.md#adding-a-new-detector`.
- **New surface.** Add a presenter under `src/presenters/` that subscribes to `HudState` updates. Do not call into the renderer from the controller.
- **New setting.** Extend `SettingsService` and add the schema entry to `package.json#contributes.configuration`. Settings flow into the controller via debounced subscriptions.

## Testing strategy

- **Unit tests** live under `src/test/` and target the `model/`, `detector/`, `controller/`, and `services/` layers. They run cross-platform on Node.js 24.
- **Helper smoke tests** exercise the protocol against a real `WinImeWatcher.exe --once` invocation. They are gated behind a Windows-only `mocha` glob.
- **Manual verification** is described in `README.md#debugging`.

See `CONTRIBUTING.md#how-to-run-a-single-test` for running individual files or `describe` blocks.
