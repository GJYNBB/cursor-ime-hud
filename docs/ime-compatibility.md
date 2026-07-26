# 输入法兼容性矩阵

本文档说明 native helper 在各平台上「能检测什么、检测不了什么、以多高的置信度上报」，并列出尚待真机验证的输入法组合。协议字段含义见 [`helper-protocol.md`](helper-protocol.md)；置信度数值直接对应 `native/ime-watcher/` 源码中的常量，两者必须同步修改。

## 各平台检测机制

### Windows

helper 通过 IMM32 读取前台窗口的两个信号：

- **open status**（`ImmGetOpenStatus` / `IMC_GETOPENSTATUS`）：IME 是否开启。
- **conversion mode**（`ImmGetConversionStatus` / `IMC_GETCONVERSIONMODE`）：`IME_CMODE_NATIVE` 位（`0x0001`）表示当前处于中文转换模式。搜狗/微信/QQ 的内部 Shift 中英切换只翻转这个位，open status 保持不变，所以仅凭 open status 会误报。

判定语义（中文键盘布局下）：

| open  | NATIVE 位 | 上报状态 | 置信度（直连 / 默认 IME 窗口回退）                        |
| ----- | --------- | -------- | --------------------------------------------------------- |
| true  | 有（=1）  | `cn`     | 1.0 / 0.85                                                |
| true  | 无（=0）  | `en`     | 1.0 / 0.85                                                |
| true  | 读取失败  | `cn`     | 0.6（诚实降级，reason 带 `-conversion-unavailable` 后缀） |
| false | 任意      | `en`     | 1.0 / 0.85                                                |

非中文布局：open=false 上报 `en`（1.0 / 0.85）；open=true 视为冲突上报 `unknown`（0.25）。

**检测不了的：** 不走 IMM32 的输入法（例如仅走 TSF 的第三方输入法）可能读不到 conversion mode，此时按上表降级为 0.6 的 `cn`。

### macOS

helper 通过 TIS（Text Input Sources）读取当前输入源标识/名称/语言，做关键字推断：

- 中文输入源 → `cn`（0.7，推断）；纯拉丁布局 → `en`（0.85）；无法识别 → `unknown`（0.25）。
- **固有限制：** 输入法内部的 ASCII 切换（如搜狗 mac 版按 Shift 切英文）不改变系统输入源，TIS 完全不可见，helper 仍会上报 `cn`。macOS 没有公开 API 暴露该内部状态，`rawStateAvailable` 恒为 `false`。

### Linux

按优先级探测多个后端，能力差异很大：

| 后端               | 能检测什么                                                                  | 置信度 |
| ------------------ | --------------------------------------------------------------------------- | ------ |
| Fcitx5 / Fcitx4    | 真实激活状态（`fcitx-remote` 的 active/inactive），可反映输入法内部中英切换 | 0.85   |
| IBus               | 仅静态引擎名（`ibus engine`），引擎内部中英切换不可见                       | 0.75   |
| XKB（`setxkbmap`） | 纯键盘布局回退，只能推断布局语言                                            | 0.45   |
| `localectl`        | 纯布局回退，粒度更粗                                                        | 0.35   |

无可用后端时上报 `unknown`（0.0）。

## 输入法 × 平台矩阵

| 输入法                  | Windows                                                  | macOS                                                         | Linux                                           |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| 微软拼音                | open+conversion 双信号，Shift 切换应可检测（待真机验证） | 不适用                                                        | 不适用                                          |
| 搜狗拼音                | 内部 Shift 切换体现在 NATIVE 位上（待真机验证）          | 内部 ASCII 切换不可见，固有限制                               | Fcitx 版可检测激活状态；IBus 版仅见引擎名       |
| 微信输入法              | 同搜狗，依赖 NATIVE 位（待真机验证）                     | 内部 ASCII 切换不可见，固有限制                               | 未验证                                          |
| QQ 输入法               | 同搜狗，依赖 NATIVE 位（待真机验证）                     | 内部 ASCII 切换不可见，固有限制                               | 未验证                                          |
| 鼠须管（Rime/Squirrel） | 不适用（小狼毫走 IMM32/TSF，待真机验证）                 | 输入源可见（关键字 `rime`/`squirrel`），内部 ASCII 切换不可见 | Fcitx-Rime 可检测激活状态；IBus-Rime 仅见引擎名 |

## 待真机实测清单

以下组合需要在真实设备上逐项验证「HUD 状态与实际输入状态一致」，每项覆盖两种切换方式：

| #   | 输入法     | 平台    | Shift 内部切换 | Ctrl+Space 开关 IME |
| --- | ---------- | ------- | -------------- | ------------------- |
| 1   | 微软拼音   | Windows | 待验证         | 待验证              |
| 2   | 搜狗拼音   | Windows | 待验证         | 待验证              |
| 3   | 微信输入法 | Windows | 待验证         | 待验证              |
| 4   | QQ 输入法  | Windows | 待验证         | 待验证              |

验证时请运行「显示诊断信息」并记录 `reason`、`confidence`、`isOpen`、`conversionNative` 四个字段；若发现 conversion mode 读取失败（reason 带 `-conversion-unavailable`），请在 issue 中附上输入法版本。
