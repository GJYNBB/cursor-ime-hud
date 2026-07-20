# 安全策略

感谢你帮助保护 Cursor IME HUD 用户的安全。VS Code / Cursor 扩展和 JetBrains 插件都随包提供 native helper，因此安全问题需要与普通缺陷分开处理。

## 支持的版本

安全修复面向最新 Marketplace 版本、最新稳定 GitHub Release / VSIX / JetBrains ZIP，以及当前 `main` 分支。早期历史软件包（包括 classic / .NET helper 版本）通常不会获得回溯修复，除非问题同样影响当前基于 Rust 的实现或发布基础设施。

## 报告漏洞

请**不要**在公开 issue 中发布漏洞利用细节、概念验证载荷或敏感日志。

建议的报告方式：

1. 如果本仓库启用了 GitHub 私密漏洞报告或 Security Advisory，请优先使用该渠道。
2. 如果无法私密报告，请只创建一个不含利用细节的简短公开 issue，并请维护者建立私密沟通渠道。

在确保安全的前提下，请尽量提供：

- Cursor IME HUD 版本及安装来源（Marketplace、GitHub Release VSIX / JetBrains ZIP，或源码构建）
- IDE 名称和版本
- 操作系统和架构
- 使用的是官方随包 helper，还是本地替换的 helper
- 相关诊断信息或输出日志；请遮盖用户名、本地路径、窗口标题及其他私人信息
- 可复现步骤；如含漏洞利用细节，请仅通过私密渠道提供

## 安全边界

Cursor IME HUD 有意保持狭窄的功能边界：

- 不读取编辑器文件内容。
- 不读取剪贴板。
- 不读取、记录或传输实际输入文本。
- 不自动切换输入法或键盘布局。
- native helper 只检查报告 `cn`、`en` 或 `unknown` 所必需的公开输入法、输入源或布局状态。
- 项目不会为输入法状态执行遥测或网络通信。

诊断信息和日志可能包含扩展 / 插件版本、探测器状态、输入法或输入源名称、后端原因、helper 生命周期事件，以及 Windows 专用的句柄或布局 ID 等环境信息。公开分享日志前，请遮盖你认为敏感的内容。

## 发布链路与产物验证

GitHub Actions 中使用的第三方 Action 都固定到经过上游仓库核对的完整提交 SHA，版本注释仅用于说明对应的 major 版本。tag 发布会同时生成并上传：

- VSIX 与 JetBrains ZIP 的 CycloneDX SBOM；SBOM 中记录最终发布文件的 SHA-256。
- VSIX、JetBrains ZIP 及其 SBOM 的 GitHub Artifact Attestation（build provenance）。

下载 GitHub Release 后，可以使用 GitHub CLI 验证 provenance，例如：

```bash
VERSION=0.1.0
gh attestation verify "cursor-ime-hud-${VERSION}.vsix" --repo GJYNBB/cursor-ime-hud
gh attestation verify "cursor-ime-hud-jetbrains-${VERSION}.zip" --repo GJYNBB/cursor-ime-hud
```

JetBrains Gradle 配置支持官方插件签名。仅 tag 构建会读取 `CERTIFICATE_CHAIN`、`PRIVATE_KEY` 和 `PRIVATE_KEY_PASSWORD` 三个仓库 Secret；证书链与私钥齐全时执行 `signPlugin`（私钥口令在加密 PEM 时需要，未加密可为空），全部未配置时明确生成未签名 ZIP，只配置一部分时发布会失败。PR 和普通分支构建不会接触这些 Secret。维护者生成本地密钥与写入 Secret 的步骤见 `jetbrains/README.md`。

两个 tag 打包工作流也支持可选的 native helper 签名：

- Windows 使用 `WINDOWS_SIGNING_CERTIFICATE_BASE64`（PFX 的 base64）和可选的 `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`；可用 `WINDOWS_SIGNING_TIMESTAMP_URL` 覆盖默认时间戳服务。
- macOS 使用 `MACOS_SIGNING_CERTIFICATE_BASE64`（P12 的 base64）、`MACOS_SIGNING_CERTIFICATE_PASSWORD` 和 `MACOS_SIGNING_IDENTITY`（通常是 Developer ID Application 身份）。

相关 Secret 全部为空时，工作流会明确记录未签名并继续发布；只配置了一部分时会失败，避免同一版本出现不一致的签名状态。签名验证成功后才会重写相邻 `.sha256` sidecar。当前仓库尚未配置这些证书 Secret，因此现阶段发布的 native helper 仍可能是未签名二进制；Linux helper 没有等价的操作系统代码签名步骤。SBOM、GitHub provenance 和相邻 `.sha256` 校验都能提高可追溯性，但不能代替 Windows / macOS 操作系统代码签名。

## Native helper 完整性

发布产物可能包含以下 native helper 资源：

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

运行时，每个客户端都会依据相邻的 `.sha256` 文件校验所选 helper，校验通过后才会执行。该机制用于发现打包或本地替换错误，并不能代替操作系统代码签名或终端安全防护。如果哈希缺失或不匹配，客户端会禁用 native helper，并回退为 `unknown` 状态的诊断信息。

需要按安全问题处理的情况包括但不限于：

- 意外绕过 helper 完整性校验
- 导致扩展或插件执行非预期二进制文件
- 读取或暴露文件内容、剪贴板内容或实际输入文本
- 非预期网络通信或遥测
- 可能影响用户的依赖项或发布打包问题
