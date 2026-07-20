# 更新日志

本项目的重要变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [0.1.0] - 2026-07-19

首公开版本。

- VS Code / Cursor 扩展：在主光标旁显示中文 / 英文输入法状态，状态栏同步显示；底部常驻 `眼睛` 图标，悬停可在 tooltip 内开关光标旁图标或打开设置。
- JetBrains 插件：同等功能的 HUD 与状态栏，状态栏菜单提供刷新、诊断、设置入口。
- 跨平台 Rust helper：Windows / macOS / Linux 通过 stdio JSONL 协议回报 IME 状态，启动前校验 `.sha256`。
- Helper 生命周期：30 秒稳定窗口、5 分钟滚动失败预算、指数退避与熔断；熔断后可手动刷新恢复。
- 隐私优先：不读文件、不读剪贴板、不记录按键、不修改系统输入法状态。

[0.1.0]: https://github.com/GJYNBB/cursor-ime-hud/releases/tag/v0.1.0
