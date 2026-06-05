# Helper Wire Protocol

This document specifies the line-delimited JSON protocol spoken between the VS Code extension and the bundled `WinImeWatcher.exe` helper. It is the source of truth for both sides of the IPC; the TypeScript parser lives in `src/detector/helperProtocol.ts` and the C# emitter lives under `native/WinImeWatcher/`.

## Transport

- **Channel:** stdio (stdin/stdout). The extension writes commands to stdin; the helper writes events to stdout.
- **Encoding:** UTF-8, no BOM.
- **Framing:** line-delimited JSON (JSONL). One JSON object per line. `\n` is the line terminator (`\r\n` is also accepted on read).
- **Maximum line length:** 64 KiB (65 536 bytes). Lines longer than this cause the parser to drop the buffer and emit a `log` event with `level: "error"`.
- **Maximum rolling read buffer:** 1 MiB (1 048 576 bytes). The reader enforces this to defend against runaway producers; on overflow the buffer is flushed and an error is logged.
- **Stderr:** the helper may write free-form diagnostic text to stderr. The extension forwards each stderr line as a `log` event of level `warn` and does not parse it.
- **Backpressure:** the extension does not apply explicit backpressure. The helper is expected to emit at most a few events per second under normal use.

## Protocol version

`PROTOCOL_VERSION = 1`. The first line on stdout after startup **must** be a `hello` message whose `version` field matches this value. A mismatch causes the extension to log `protocol version mismatch` and shut the helper down.

## Hello handshake

The helper writes the first line:

```json
{"type":"hello","version":1,"capabilities":["state","log"]}
```

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Must be `"hello"`. |
| `version` | number | Protocol version. Must equal `PROTOCOL_VERSION`. |
| `capabilities` | string[] | Subset of `["state","log","refresh"]`. The extension uses this to decide which messages the helper will emit. |

The extension responds with a `ready` command on stdin (see [Command messages](#command-messages)). The helper then begins emitting events.

If the helper fails to write the hello line within 2 seconds, the extension kills the process and transitions the controller to `disposed`.

## State messages (helper → extension)

Emitted when the IME state of the foreground window changes, or in response to a `refresh` command.

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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Must be `"state"`. |
| `state` | string | yes | One of `"cn"`, `"en"`, `"unknown"`. Other values are coerced to `"unknown"`. |
| `timestamp` | string | yes | ISO-8601. The extension accepts the helper's value verbatim; if missing or unparseable, the extension stamps `new Date().toISOString()`. |
| `imeName` | string | no | `ImmGetDescriptionW` of the active IME. Omitted when the helper cannot read it. |
| `isOpen` | boolean | no | `ImmGetOpenStatus` result. Omitted when the helper cannot read it. |
| `layoutHex` | string | no | Keyboard layout low-word in hex (e.g. `"0804"` for Chinese (Simplified) PRC). |
| `threadId` | number | no | Thread id that owns the foreground window. Diagnostic only. |
| `hwnd` | string | no | Hex-formatted window handle (e.g. `"0x00040A2C"`). Diagnostic only. |
| `reason` | string | no | Why the helper emitted this state (e.g. `"layout-changed"`, `"refresh"`, `"probe"`). |
| `confidence` | number | no | `0.0` to `1.0`. The extension surfaces this in the diagnostics tooltip. |
| `rawStateAvailable` | boolean | no | `false` indicates Windows did not expose IMM32 state; the extension should expect more `unknown` reports. |

## Log messages (helper → extension)

Free-form diagnostic stream from the helper. The extension routes these to the **Cursor IME HUD** output channel and to the in-memory rolling log buffer.

```json
{"type":"log","level":"warn","message":"ImmGetDescription returned 0","timestamp":"2026-06-05T08:00:00.000Z","source":"native-helper","details":{"hwnd":"0x00040A2C"}}
```

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Must be `"log"`. |
| `level` | string | yes | `"info"`, `"warn"`, or `"error"`. Other values are coerced to `"info"`. |
| `message` | string | yes | Human-readable. |
| `timestamp` | string | no | ISO-8601. Defaults to "now" on the extension side. |
| `source` | string | no | Component name within the helper (defaults to `"native-helper"`). |
| `details` | object | no | Arbitrary structured detail. Surfaced in diagnostics. |

## Command messages (extension → helper)

The extension writes one JSON object per line to stdin.

### `ready`

Sent once, immediately after a valid `hello`. The helper should treat this as a signal that the line parser on the extension side is live and ready to receive events.

```json
{"type":"ready","version":1}
```

### `refresh`

Forces the helper to re-probe the foreground window and emit a fresh `state` message. The extension sends this on the **Cursor IME HUD: Refresh IME State** command and on focus changes.

```json
{"type":"refresh","reason":"manual"}
```

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Must be `"refresh"`. |
| `reason` | string | no | One of `"manual"`, `"focus"`, `"startup"`. The helper echoes this in the next `state` message's `reason` field. |

### `shutdown`

Asks the helper to drain and exit. The helper responds by emitting any pending events and then exiting with code `0`.

```json
{"type":"shutdown"}
```

The extension falls back to `process.kill()` if the helper does not exit within 1 second of receiving `shutdown`.

## Lifecycle and exit codes

| Exit code | Meaning | Extension action |
| --- | --- | --- |
| `0` | Normal shutdown. The helper either received `shutdown` or completed a one-shot probe. | Log `helper exited cleanly` at `info`. Transition to `stopping` → `disposed`. |
| `1` | Generic error. The helper logged details on stderr or via `log` events. | Log `helper exited with code 1`. Transition to `disposed`. Surface in status bar. |
| `2` | Startup probe failed. The helper could not enumerate the foreground window or load IMM32. | Log `helper startup probe failed`. Transition directly to `disposed`. The extension surfaces this in the **Cursor IME HUD** output channel and in the status bar tooltip. |
| `>= 128` | Process killed by a signal (POSIX-style; on Windows this includes the abnormal termination code from `0xC0000000 \| sig`). | Log `helper terminated by signal`. Transition to `disposed`. |

The extension never re-uses a helper process. A crash moves the controller to `disposed`; a recovery requires `Refresh IME State`, which spawns a fresh helper.

## Versioning and compatibility

- A new field with a `null` or absent default is backwards-compatible: the extension ignores unknown fields.
- A new field with a non-trivial default is a minor protocol bump. The extension must be updated in lockstep with the helper; the `version` field in `hello`/`ready` is the gate.
- Removing a field, changing the meaning of `state`, or changing the framing is a major protocol bump (`PROTOCOL_VERSION = 2`). Both sides must be updated together.
