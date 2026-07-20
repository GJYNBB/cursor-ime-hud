# Helper Wire Protocol

本文档说明 IDE 客户端与随附 native IME helper 之间使用的按行 JSON 协议。TypeScript 解析器位于 `src/detector/helperProtocol.ts`，Kotlin 解析器位于 `jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/protocol/HelperProtocol.kt`，Rust helper 位于 `native/ime-watcher/`。

生命周期、重启退避与熔断约定见 [`helper-lifecycle.md`](helper-lifecycle.md)；两端共享的解析测试向量见 [`helper-protocol-vectors.json`](helper-protocol-vectors.json)。协议字段变更必须同时更新这三份文档和 TS/Kotlin 测试。

## Transport

- **通道：** stdio。扩展向 stdin 写入命令；helper 向 stdout 写入状态事件，向 stderr 写入诊断日志。
- **编码：** UTF-8，不带 BOM。
- **分帧：** 按行 JSON（JSONL），每行一个 JSON 对象。`\n` 是行结束符，读取时也接受 `\r\n`。
- **单行上限：** 64 KiB（65,536 字节）。超长行会被丢弃，并触发 helper 重启。
- **滚动读取缓冲区上限：** 1 MiB（1,048,576 字节），用于防止异常生产者耗尽内存。
- **stderr：** helper 向 stderr 写入 `log` JSON 记录；扩展会把它们写入 **Cursor IME HUD** 输出通道和诊断缓冲区。未知格式的 stderr 行会作为信息日志转发。
- **背压：** 扩展不实施显式背压；正常情况下 helper 每秒只应产生少量事件。

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

| Field               | Type    | Required | Notes                                                                                                                                                              |
| ------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`              | string  | yes      | Must be `"state"`.                                                                                                                                                 |
| `state`             | string  | yes      | One of `"cn"`, `"en"`, `"unknown"`. Records with missing or invalid states are rejected by the extension parser.                                                   |
| `timestamp`         | string  | yes      | ISO-8601. The extension accepts the helper's value verbatim; if missing or unparseable, it stamps `new Date().toISOString()`.                                      |
| `imeName`           | string  | no       | Active IME/input-source/backend name. On Windows this comes from `ImmGetDescriptionW`; on macOS/Linux it may be an input source, engine, or layout name.           |
| `isOpen`            | boolean | no       | Platform raw open/active result when available. On Windows this is `ImmGetOpenStatus`; on Linux it may reflect Fcitx active state; on macOS it is usually omitted. |
| `layoutHex`         | string  | no       | Windows keyboard layout low-word in hex, e.g. `"0804"` for Chinese (Simplified) PRC. Omitted on macOS/Linux.                                                       |
| `threadId`          | number  | no       | Windows thread id that owns the foreground window. Diagnostic only.                                                                                                |
| `hwnd`              | string  | no       | Windows hex-formatted window handle. Diagnostic only.                                                                                                              |
| `reason`            | string  | no       | Why the helper emitted this state, e.g. `"layout-changed"`, `"refresh"`, or `"probe"`.                                                                             |
| `confidence`        | number  | no       | `0.0` to `1.0`. Surfaced in diagnostics.                                                                                                                           |
| `rawStateAvailable` | boolean | no       | `true` indicates the backend exposed a raw open/closed or active/inactive state; `false` indicates only an inferred input-source/layout signal was available.      |

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

- Protocol v1 is shared by the Windows, macOS, and Linux helpers. Platform-specific diagnostics should be represented through existing optional fields (`imeName`, `reason`, `confidence`, `rawStateAvailable`) unless a new field is required.
- A new optional field with a `null` or absent default is backwards-compatible.
- A new field with behavior required by either side is a minor protocol bump. The extension and helper must be updated in lockstep.
- Removing a field, changing the meaning of `state`, or changing the framing is a major protocol bump (`PROTOCOL_VERSION = 2`). Both sides must be updated together.
