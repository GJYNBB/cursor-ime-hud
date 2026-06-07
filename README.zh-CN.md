# Cursor IME HUD 中文说明

[English](README.md) | 简体中文

Cursor IME HUD 是一个面向 Windows 的 VS Code 扩展。它会在主光标附近显示当前输入状态（默认 `中` / `英`），并在状态栏同步显示当前 IME 状态，帮助你在写代码、写文档、切换中英文输入时减少误输入。

这个扩展保持非常窄的功能边界：只提示输入法状态，不自动切换输入法，不读取文件内容、剪贴板或你输入的文本。

## 适用场景

- 在 VS Code / Cursor 中频繁切换中文和英文输入。
- 希望在光标旁边直接看到当前输入状态，而不是低头看系统托盘或任务栏。
- 希望输入状态提示尽量轻量、低打扰，并且状态未知时能自动降级到状态栏和诊断信息。

## 功能特性

- 在主光标附近渲染轻量 HUD。
- 默认两个稳定标签：`中` 和 `英`。
- 状态栏同步显示当前输入状态。
- `unknown` 状态下自动隐藏 HUD，并在状态栏显示 `?`。
- 500ms 短暂宽限窗口，用于降低 Windows 输入法状态切换时的闪烁。
- Windows native helper 负责探测 IME 状态。
- 提供 `Show Diagnostics` 命令，便于排查 helper、协议、状态解析等问题。

## 系统要求

### 使用扩展

- Windows 10 或 Windows 11
- VS Code `^1.107.0`

### 从源码开发或调试

- Node.js 24+
- npm 11+
- .NET 8 SDK
- PowerShell 7+ 或 Windows PowerShell

`.NET 8 SDK` 只在你从源码构建 native helper 时需要。安装已经打包好的 VSIX 不需要额外安装 .NET。

## 下载和安装

你可以先从 GitHub Release 下载 VSIX 测试包：

- [cursor-ime-hud-0.0.1.vsix](https://github.com/GJYNBB/cursor-ime-hud/releases/download/v0.0.1/cursor-ime-hud-0.0.1.vsix)

本地安装：

```powershell
code --install-extension .\cursor-ime-hud-0.0.1.vsix
```

安装后在 VS Code 中打开一个文本文件，切换 Windows 中文/英文输入状态，观察光标附近 HUD 和状态栏显示。

## 命令

扩展提供以下命令：

- `Cursor IME HUD: Toggle Overlay`：启用/关闭光标旁 HUD。
- `Cursor IME HUD: Refresh IME State`：主动刷新一次 IME 状态。
- `Cursor IME HUD: Show Diagnostics`：显示当前探测器、快照、生命周期和日志信息。

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `cursorImeHud.overlay.enabled` | `true` | 是否启用光标旁 HUD。 |
| `cursorImeHud.overlay.cnLabel` | `中` | 中文输入状态显示的标签。 |
| `cursorImeHud.overlay.enLabel` | `英` | 英文输入状态显示的标签。 |
| `cursorImeHud.overlay.opacity` | `0.78` | HUD 背景透明度，范围 `0.15` 到 `1`。 |
| `cursorImeHud.overlay.mode` | `text` | HUD 渲染模式；`text+icon` 目前预留，表现与 `text` 相同。 |
| `cursorImeHud.statusBar.enabled` | `true` | 是否在状态栏显示输入状态。 |
| `cursorImeHud.overlay.hideWhenEditorUnfocused` | `true` | VS Code 失焦时是否隐藏 HUD。 |
| `cursorImeHud.overlay.offsetX` | `6` | HUD 横向偏移。 |
| `cursorImeHud.overlay.offsetY` | `0` | HUD 纵向偏移。 |

## 已知限制

- 目前仅支持 Windows。
- 目前只打包 `win-x64` native helper。
- v1 只渲染主光标，不支持多光标分别显示。
- 空行上不会显示光标旁 HUD，但状态栏仍会显示状态。
- native helper 当前只检测中文 IME（Win32 primary language id `0x0004`）。日语、韩语和其他 CJK 输入法可能被报告为 `en` 或 `unknown`。
- `text+icon` 目前只是预留模式，还没有真正的图标渲染。

## 隐私说明

扩展不会读取：

- 文件内容
- 剪贴板
- 实际输入文本

native helper 只检查前台窗口的 IME 状态，并通过 JSONL/stdio 把状态发送给扩展。完整协议见 [docs/helper-protocol.md](docs/helper-protocol.md)。

## 故障排查

### HUD 不显示

1. 打开 VS Code Output 面板，选择 **Cursor IME HUD**。
2. 查看是否有 `hello` 握手失败、JSON 解析失败、helper 退出等日志。
3. 运行 `Cursor IME HUD: Show Diagnostics`。
4. 确认 VSIX 中存在：
   - `resources/bin/win-x64/WinImeWatcher.exe`
   - `resources/bin/win-x64/WinImeWatcher.exe.sha256`

### 状态栏一直显示 `?`

可能原因：

- 当前前台窗口不是中文输入上下文。
- 正在使用非中文 IME（如日语、韩语）。
- helper 进程崩溃或暂时无法读取 Windows 输入法状态。

可以先运行 `Cursor IME HUD: Refresh IME State` 手动刷新。

### 扩展激活失败

- 检查 VS Code 版本是否满足 `^1.107.0`。
- 查看 Output 面板和扩展页错误信息。
- 如果能稳定复现，请带上诊断日志到 GitHub Issues 反馈。

## 从源码开发

```powershell
npm install
npm run compile
npm run build:helper
npm run lint
```

`npm run build:helper` 会构建：

- `resources/bin/win-x64/WinImeWatcher.exe`
- `resources/bin/win-x64/WinImeWatcher.exe.sha256`

`.sha256` sidecar 用于运行时完整性校验，不需要手工把 hash 填回源码。

## 打包 VSIX

```powershell
npm run package:vsix
```

GitHub Actions 的 Release workflow 会在 Windows runner 上执行完整打包流程，并上传 `.vsix` 产物。

## 发布到 VS Code Marketplace

当前 Marketplace publisher id：

```text
chestnut-ch
```

手动发布：

```powershell
npx @vscode/vsce login chestnut-ch
npx @vscode/vsce publish
```

建议先通过 GitHub Release 下载 VSIX 手动测试，确认功能正常后再发布到 VS Code Marketplace。

## 项目结构

```text
.
├─ native/WinImeWatcher/      # Windows native helper
├─ resources/                 # 图标、helper 二进制和截图资源
├─ scripts/                   # 构建、打包、校验脚本
├─ src/                       # VS Code 扩展源码
├─ docs/helper-protocol.md    # helper JSONL 协议说明
├─ ARCHITECTURE.md            # 架构说明
├─ README.md                  # 英文 README
└─ README.zh-CN.md            # 中文 README
```

## 相关文档

- [English README](README.md)
- [架构说明](ARCHITECTURE.md)
- [Helper 协议](docs/helper-protocol.md)
- [更新日志](CHANGELOG.md)
