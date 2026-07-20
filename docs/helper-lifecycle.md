# Helper 生命周期约定

VS Code / Cursor 与 JetBrains 客户端都使用同一套原生 Helper 协议。两端可以采用不同语言实现，但必须遵守下表中的状态与恢复语义。

## 状态机

| 当前状态       | 事件                            | 下一状态                | 必须执行的行为                                                         |
| -------------- | ------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `idle`         | 自动启动或用户刷新              | `starting`              | 校验 Helper 路径与完整性，然后启动新进程。                             |
| `starting`     | 收到合法 `hello` 和首个 `state` | `running`               | 启动 30 秒稳定运行计时；不能在首个快照后立即清零失败预算。             |
| `starting`     | 超时、协议错误、进程退出        | `idle` / `circuit-open` | 记录一次失败；未熔断时按指数退避重试。                                 |
| `running`      | 持续稳定运行 30 秒              | `running`               | 清零滚动失败预算。                                                     |
| `running`      | 进程、stdout、stderr 或协议失败 | `idle` / `circuit-open` | 发布 `unknown`，销毁旧进程，并记录一次失败。                           |
| `idle`         | 5 分钟窗口内失败少于 10 次      | `starting`              | 按指数退避重启，延迟上限为 30 秒，并加入少量抖动。                     |
| `idle`         | 5 分钟窗口内达到 10 次失败      | `circuit-open`          | 停止自动重启，在诊断信息中暴露熔断状态，要求用户手动刷新。             |
| `circuit-open` | 用户执行“刷新输入法状态”        | `starting`              | 清零失败预算并立即进行一次人工恢复尝试。                               |
| 任意非终态     | IDE / 插件关闭                  | `disposed`              | 取消全部重启与稳定计时器，关闭 stdin，等待后再强制终止仍未退出的进程。 |

## 跨语言契约测试

[`helper-protocol-vectors.json`](helper-protocol-vectors.json) 是 TS 与 Kotlin 共同使用的协议测试向量。两端测试必须同时验证：

- `hello` 版本与能力解析；
- `state` 必填字段、可选诊断字段和非法状态拒绝；
- `log` 级别归一化与必填消息字段；
- 未知或新增可选字段不会破坏旧客户端。

协议字段或生命周期常量发生变化时，应在同一个提交中同步更新测试向量、两端测试和本状态表。

VS Code / Cursor 在**首次启动**失败时会切换到无副作用的回退检测器，但会区分两类错误：

- **永久错误**（Helper 文件缺失、`.sha256` 缺失/无效、SHA-256 不匹配、当前平台无可用
  Helper）：固定进入回退，用户刷新不会重新创建 Native Detector，需要修复安装或
  Reload Window。
- **临时错误**（spawn 失败、启动超时、协议握手异常、进程提前退出等）：进入可恢复
  回退；诊断中 `fallbackRecoverable=true`，用户执行“刷新输入法状态”时会重新创建
  Native Detector 并再试一次启动。不会在后台自动连拉进程。

JetBrains 服务会保留同一 helper 实例并按本表的退避/熔断策略重试。两端在 helper
已经成功启动后的退出、协议错误和流故障上使用相同的 30 秒稳定窗口、5 分钟失败窗口、
指数退避和手动刷新熔断语义。

## 资源命名

跨平台 native helper 使用统一的发布资源名：Windows 包为 `resources/bin/win32-*/ImeWatcher.exe`（及 `.sha256`），macOS / Linux 包为 `resources/bin/<plat>/ImeWatcher`（及 `.sha256`）。`backendName` 字段在 `helper-manifest.json` 中统一为 `ime-watcher`。Rust 工程位于 `native/ime-watcher/`（`Cargo.toml` 的 `[[bin]] name` 为 `ime-watcher`）。JetBrains 端的管理类为 `ImeHelperProcess`。这些命名都表示同一个跨平台 IME 检测能力，不暗示只支持 Windows。
