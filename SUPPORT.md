# 支持与故障排查

本文说明如何获取帮助，以及报告 Cursor IME HUD 问题时需要提供哪些信息。

## 支持环境

Cursor IME HUD 当前支持：

- Windows 10 / 11、macOS 和 Linux
- VS Code `^1.107.0`
- 通过 VS Code 扩展安装方式尽力兼容 Cursor
- JetBrains IDE 2026.1+
- 随包提供以下平台的 Rust native helper：`win-x64`、`win-arm64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64` 和 `linux-armhf`
- 识别中文输入法 / 输入源；后端无法可靠判断时使用 `unknown`

macOS 通过公开的输入源 API 进行检测。Linux 检测依赖桌面环境中可用的 Fcitx / Fcitx5、IBus 或键盘布局回退机制。当前版本不能准确识别日语、韩语及其他非中文输入法。

以上支持范围适用于当前随包提供的 Rust native helper。早期 classic / .NET helper 软件包仅作为历史版本保留，不属于当前支持的实现。

## 获取帮助

- 遇到缺陷，请使用 GitHub 缺陷报告模板。
- 提出功能建议，请使用 GitHub 功能建议模板。
- 报告安全问题，请遵循 [SECURITY.md](SECURITY.md)，不要在公开 issue 中发布漏洞利用细节。

提交 issue 前，请先查看 [README.md](README.md) 或 [README.en.md](README.en.md) 中的故障排查章节。

## 需要提供的信息

请尽量提供：

- Cursor IME HUD 扩展 / 插件版本
- 安装来源：Marketplace、GitHub Release VSIX / JetBrains ZIP，或本地源码构建
- IDE 名称和版本
- 操作系统和架构
- 当前输入法、输入源或后端名称
- 问题发生在 VS Code、Cursor、JetBrains，还是多个客户端
- 可复现步骤
- 预期行为和实际行为
- `Cursor IME HUD：显示诊断信息（Show Diagnostics）` 命令的输出
- **Cursor IME HUD** 输出通道或日志中的相关内容

如果是显示问题，请尽量附上截图或简短 GIF。请避免包含私人文件路径、用户名、窗口标题或文档内容。

## Native helper 检查

从源码测试或使用本地重新构建的软件包时，请在受支持的主机上运行 `npm run build:helper`，并确认当前平台对应的 helper 和校验文件已经生成。正式发布包可能包含以下资源：

```text
resources/bin/win32-x64/ImeWatcher.exe
resources/bin/win32-x64/ImeWatcher.exe.sha256
resources/bin/win32-arm64/ImeWatcher.exe
resources/bin/win32-arm64/ImeWatcher.exe.sha256
resources/bin/darwin-x64/ImeWatcher
resources/bin/darwin-x64/ImeWatcher.sha256
resources/bin/darwin-arm64/ImeWatcher
resources/bin/darwin-arm64/ImeWatcher.sha256
resources/bin/linux-x64/ImeWatcher
resources/bin/linux-x64/ImeWatcher.sha256
resources/bin/linux-arm64/ImeWatcher
resources/bin/linux-arm64/ImeWatcher.sha256
resources/bin/linux-armhf/ImeWatcher
resources/bin/linux-armhf/ImeWatcher.sha256
```

`npm run build:helper` 只构建当前主机对应的 helper；发布工作流会在各平台的原生 runner 上构建全部受支持的 helper，再汇总为发布产物。

如果 `.sha256` 校验文件缺失或哈希不匹配，客户端会禁用 native helper，并以 `unknown` 状态提供诊断信息。

## 项目边界

Cursor IME HUD 只负责显示当前输入法状态。项目不会加入读取实际输入文本、读取剪贴板、分析文件内容或自动切换用户输入法的功能。
