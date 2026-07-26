# 更新日志

本项目的重要变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [0.1.2] - 2026-07-26

- Windows helper 新增 conversion mode 检测：第三方输入法（如微信输入法）内部中英切换现在可以被正确识别并显示。
- JetBrains 插件线程模型重构：状态改为原子快照读写，服务提升为 APP 级并提供公开 API，项目启动改用 `ProjectActivity`，helper 校验哈希增加缓存。
- 交付 0.1.1 未能发布的 IntelliJ EDT threading violation 修复。
- 发布流程接入 release-please：版本号与 CHANGELOG 由 Release PR 统一维护。
- CI 新增 JetBrains `verifyPlugin` 门禁，ARM 构建改在 ARM runner 上真机冒烟验证。
- 移除 `linux-armhf` 构建目标。
- 测试改为 glob 自动发现，ESLint 规则调整为分层门禁。

## [0.1.1] - 2026-07-23

- 尝试修复 IntelliJ 插件的 EDT threading violation（以 `runWriteAction` 包裹写操作）。
- 注意：该版本的 tag 因版本号未 bump 被发布流水线拦截，对应 GitHub Release 未附带任何构建产物。上述修复实际由 0.1.2 交付。
- 该无产物的 Release 与 tag 已于 2026-07-26 删除，此条目仅作历史记录保留。

## [0.1.0] - 2026-07-19

首公开版本。

- VS Code / Cursor 扩展：在主光标旁显示中文 / 英文输入法状态，状态栏同步显示；底部常驻 `眼睛` 图标，悬停可在 tooltip 内开关光标旁图标或打开设置。
- JetBrains 插件：同等功能的 HUD 与状态栏，状态栏菜单提供刷新、诊断、设置入口。
- 跨平台 Rust helper：Windows / macOS / Linux 通过 stdio JSONL 协议回报 IME 状态，启动前校验 `.sha256`。
- Helper 生命周期：30 秒稳定窗口、5 分钟滚动失败预算、指数退避与熔断；熔断后可手动刷新恢复。
- 隐私优先：不读文件、不读剪贴板、不记录按键、不修改系统输入法状态。

[0.1.2]: https://github.com/GJYNBB/cursor-ime-hud/compare/v0.1.0...v0.1.2
[0.1.1]: https://github.com/GJYNBB/cursor-ime-hud/blob/main/CHANGELOG.md
[0.1.0]: https://github.com/GJYNBB/cursor-ime-hud/releases/tag/v0.1.0
