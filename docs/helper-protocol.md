# Helper Wire Protocol

This document specifies the line-delimited JSON protocol spoken between the VS Code extension and the bundled `WinImeWatcher.exe` helper. The TypeScript parser lives in `src/detector/helperProtocol.ts`; the Rust helper lives under `native/WinImeWatcher/`.

## Transport

- **Channel:** stdio. The extension writes commands to stdin; the helper writes state events to stdout and diagnostic logs to stderr.
- **Encoding:** UTF-8, no BOM.
- **Framing:** line-delimited JSON (JSONL). One JSON object per line. `\n` is the line terminator (`\r\n` is also accepted on read).
- **Maximum line length:** 64 KiB (65,536 bytes). Lines longer than this cause the extension to drop the buffer and restart the helper.
- **Maximum rolling read buffer:** 1 MiB (1,048,576 bytes). The reader enforces this to defend against runaway producers.
- **Stderr:** the helper writes `log` JSON records to stderr. The extension parses those records into the **Cursor IME HUD** output channel and diagnostics buffer. Unknown stderr lines are forwarded as informational logs.
- **Backpressure:** the extension does not apply explicit backpressure. The helper is expected to emit at most a few events per second under normal use.

## Protocol version

`PROTOCOL_VERSION = 1`. The first line on stdout after every helper process startup **must** be a `hello` message whose `version` field matches this value. A mismatch causes the extension to reject that helper process.

## Hello handshake

The helper writes the first stdout line:

```json
{ "type": "hello", "version": 1, "capabilities": ["state", "log"] }
```

Fields:

| Field          | Type     | Notes                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `type`         | string   | Must be `"hello"`.                                                            |
| `version`      | number   | Protocol version. Must equal `PROTOCOL_VERSION`.                              |
| `capabilities` | string[] | Capabilities emitted by the helper. Current values are `"state"` and `"log"`. |

After a valid hello, the extension may send a `refresh` command. There is no separate `ready` command in protocol v1.

## State messages (helper → extension)

Emitted at startup, when the IME state of the foreground window changes, and in response to a `refresh` command.

```json
{
  "type": "state",
  "state": "cn",
  "timestamp": "2026-06-05T08:00:00.000Z",
  "imeName": "Microsoft Pinyin",
  "isOpen": true,
  "layoutHex": "0804",
  "threadId": 1234,
  "hwnd": "0x00040A2C",
  "reason": "layout-changed",
  "confidence": 0.94,
  "rawStateAvailable": true
}
```

Fields:

| Field               | Type    | Required | Notes                                                                                                                         |
| ------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `type`              | string  | yes      | Must be `"state"`.                                                                                                            |
| `state`             | string  | yes      | One of `"cn"`, `"en"`, `"unknown"`. Records with missing or invalid states are rejected by the extension parser.              |
| `timestamp`         | string  | yes      | ISO-8601. The extension accepts the helper's value verbatim; if missing or unparseable, it stamps `new Date().toISOString()`. |
| `imeName`           | string  | no       | `ImmGetDescriptionW` of the active IME. Omitted when the helper cannot read it.                                               |
| `isOpen`            | boolean | no       | `ImmGetOpenStatus` result. Omitted when the helper cannot read it.                                                            |
| `layoutHex`         | string  | no       | Keyboard layout low-word in hex, e.g. `"0804"` for Chinese (Simplified) PRC.                                                  |
| `threadId`          | number  | no       | Thread id that owns the foreground window. Diagnostic only.                                                                   |
| `hwnd`              | string  | no       | Hex-formatted window handle. Diagnostic only.                                                                                 |
| `reason`            | string  | no       | Why the helper emitted this state, e.g. `"layout-changed"`, `"refresh"`, or `"probe"`.                                        |
| `confidence`        | number  | no       | `0.0` to `1.0`. Surfaced in diagnostics.                                                                                      |
| `rawStateAvailable` | boolean | no       | `false` indicates Windows did not expose reliable IMM32 state.                                                                |

## Log messages (helper → extension)

Diagnostic stream from the helper. These records are emitted on stderr.

```json
{
  "type": "log",
  "level": "warn",
  "message": "ImmGetDescription returned 0",
  "timestamp": "2026-06-05T08:00:00.000Z",
  "source": "native-helper",
  "details": { "hwnd": "0x00040A2C" }
}
```

Fields:

| Field       | Type   | Required | Notes                                                                   |
| ----------- | ------ | -------- | ----------------------------------------------------------------------- |
| `type`      | string | yes      | Must be `"log"`.                                                        |
| `level`     | string | yes      | `"info"`, `"warn"`, or `"error"`. Other values are coerced to `"info"`. |
| `message`   | string | yes      | Human-readable.                                                         |
| `timestamp` | string | no       | ISO-8601. Defaults to "now" on the extension side.                      |
| `source`    | string | no       | Component name within the helper; defaults to `"native-helper"`.        |
| `details`   | object | no       | Arbitrary structured detail surfaced in diagnostics.                    |

## Command messages (extension → helper)

The extension writes one JSON object per line to stdin.

### `refresh`

Forces the helper to re-probe the foreground window and emit a fresh `state` message.

```json
{ "command": "refresh" }
```

Fields:

| Field     | Type   | Required | Notes                |
| --------- | ------ | -------- | -------------------- |
| `command` | string | yes      | Must be `"refresh"`. |

### Shutdown

Protocol v1 does not define a JSON `shutdown` command. The extension requests graceful shutdown by closing stdin. The helper treats stdin EOF as a cancellation request and exits with code `0`; the extension still keeps a hard kill / `taskkill /F /T` fallback for unresponsive processes.

## Lifecycle and exit codes

| Exit code         | Meaning                                                                                        | Extension action                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `0`               | Normal shutdown or completed `--once` probe.                                                   | No restart during disposal; otherwise a clean unexpected exit can still schedule restart.  |
| `1`               | Generic helper error.                                                                          | Log details and schedule restart when appropriate.                                         |
| `2`               | Reserved for legacy startup health-check failures; current helpers keep watching on `unknown`. | Synthesize `unknown`, log the health-check failure, and schedule restart.                  |
| killed / signaled | Process was terminated by the extension or OS.                                                 | During disposal this is ignored; during normal running it triggers fallback/restart logic. |

The extension never reuses a failed helper process. A crash or stream parser failure tears down the process and starts a fresh helper subject to the restart limit.

## Versioning and compatibility

- A new optional field with a `null` or absent default is backwards-compatible.
- A new field with behavior required by either side is a minor protocol bump. The extension and helper must be updated in lockstep.
- Removing a field, changing the meaning of `state`, or changing the framing is a major protocol bump (`PROTOCOL_VERSION = 2`). Both sides must be updated together.
