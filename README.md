# Cursor IME HUD

在 Windows 上为 VS Code 提供一个“常驻在光标后方的半透明中/英输入态显示”扩展。它使用标准 VS Code Extension API，在活动编辑器里用 `TextEditorDecorationType` 渲染轻量 HUD，并用状态栏作为兜底显示。

## 功能概览

- 主光标附近常驻显示半透明标签，默认文案为 `中` / `英`
- 输入法状态变化时自动刷新
- 光标移动、切换编辑器、滚动可见区域时自动重绘
- 活动编辑器不可用或空行场景下优雅降级
- 状态栏显示当前输入态
- 诊断命令可输出当前识别状态、helper 来源和最近日志
- Windows 优先，内置 `WinImeWatcher.exe` 本地 helper

## 截图

- TODO: 补充实际运行截图
- 当前仓库已包含占位图标 `resources/icon.png`

## 当前实现

- 扩展宿主：TypeScript
- HUD 渲染：`TextEditorDecorationType` + `setDecorations`
- 状态检测：`child_process.spawn()` 拉起本地 `WinImeWatcher.exe`
- helper 协议：`stdout` / `stderr` 一行一个 JSON
- 状态栏：VS Code Status Bar API

## 项目结构

```text
.
├─ .vscode/
├─ native/WinImeWatcher/
├─ resources/
│  ├─ bin/win-x64/
│  └─ icon.png
├─ scripts/
├─ src/
│  ├─ commands/
│  ├─ controller/
│  ├─ detector/
│  ├─ model/
│  ├─ presenters/
│  ├─ renderer/
│  ├─ services/
│  └─ test/
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ LICENSE
├─ package.json
└─ tsconfig.json
```

## 环境要求

- Windows 10/11 x64
- VS Code `^1.107.0`
- Node.js 24+
- npm 11+
- .NET 8 SDK

## 安装依赖与本地运行

```powershell
npm install
npm run compile
npm run build:helper
```

## 调试方式

1. 在当前目录打开 VS Code。
2. 运行 `npm install`、`npm run compile`、`npm run build:helper`。
3. 按 `F5` 启动 `Run Cursor IME HUD`。
4. 在 Extension Development Host 中打开任意文本文件。
5. 切换输入法中/英状态，观察光标附近 HUD 与状态栏。

`.vscode/tasks.json` 已配置 `prepare-debug`，首次 F5 会自动编译 TypeScript 并构建 helper。

## 命令

- `Cursor IME HUD: Toggle Overlay`
- `Cursor IME HUD: Refresh IME State`
- `Cursor IME HUD: Show Diagnostics`

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `cursorImeHud.overlay.enabled` | `true` | 是否启用编辑器内 HUD |
| `cursorImeHud.overlay.cnLabel` | `中` | 中文输入态标签 |
| `cursorImeHud.overlay.enLabel` | `英` | 英文输入态标签 |
| `cursorImeHud.overlay.opacity` | `0.78` | HUD 背景透明度 |
| `cursorImeHud.overlay.mode` | `text` | `text+icon` 当前回退为文本模式 |
| `cursorImeHud.statusBar.enabled` | `true` | 是否显示状态栏兜底状态 |
| `cursorImeHud.overlay.hideWhenEditorUnfocused` | `true` | VS Code 失焦时是否隐藏 HUD |
| `cursorImeHud.overlay.offsetX` | `6` | HUD 横向偏移 |
| `cursorImeHud.overlay.offsetY` | `0` | HUD 纵向偏移 |

## 手工验证步骤

1. `npm install`
2. `npm run compile`
3. `npm run build:helper`
4. `npm test`
5. 按 `F5` 启动开发宿主
6. 在开发宿主中打开文本编辑器并切换输入法
7. 验证以下行为：
   - 光标附近出现半透明 `中` / `英`
   - 切换输入法时 HUD 和状态栏同步变化
   - 行首、行尾定位合理
   - 真空行隐藏 HUD，但状态栏保留
   - `Show Diagnostics` 输出当前状态和最近日志

## 自动化测试

```powershell
npm test
```

测试包含：

- 扩展 smoke test：激活扩展并验证命令注册
- `PositionStrategy` 单元测试
- native helper `--once` 输出检查

## 已知限制

- 当前仅支持 Windows `win-x64`
- 多光标场景只显示主光标状态
- 真空行不会显示 HUD，会退化为状态栏
- 当前优先依赖 Windows IMM 兼容层，个别第三方 IME 可能只能拿到部分名称字段
- `text+icon` 配置项已预留，v1 仍按文本模式渲染
- 不做自动切换输入法，也不做语义判断

## 打包 VSIX

```powershell
npm run package:vsix
```

等价命令：

```powershell
npx @vscode/vsce package
```

产物会生成在当前工作区根目录，例如：

```text
cursor-ime-hud-0.0.1.vsix
```

## 本地安装 VSIX 验证

```powershell
code --install-extension .\cursor-ime-hud-0.0.1.vsix
```

安装后重启 VS Code，并重复“手工验证步骤”中的行为检查。

## 发布到 VS Code Marketplace

1. 在 `package.json` 中把 `publisher` 从占位值改成你的真实 publisher。
2. 安装发布工具：

```powershell
npm install
```

3. 登录 publisher：

```powershell
npx @vscode/vsce login <your-publisher-name>
```

4. 按提示输入 Azure DevOps PAT。
5. 发布：

```powershell
npx @vscode/vsce publish
```

也可以指定版本策略：

```powershell
npx @vscode/vsce publish patch
npx @vscode/vsce publish minor
npx @vscode/vsce publish major
```

版本建议：

- `patch`: 修复 bug、微调兼容性
- `minor`: 增加配置项或诊断能力
- `major`: 破坏性修改、协议或行为变更

## Publisher 与 PAT 配置位置

- publisher：`package.json > publisher`
- PAT：首次 `vsce login` 时写入本机凭据存储
- 可通过环境或本机登录态管理，不建议写入仓库

## 诊断输出说明

执行 `Cursor IME HUD: Show Diagnostics` 后，会在 Output Channel 中看到：

- 当前 detector 识别状态
- 实际显示状态
- 当前 IME 名称
- 最近更新时间
- detector 来源与 fallback 状态
- 最近日志和 helper 原始字段

## 发布前检查清单

- `npm run compile`
- `npm run build:helper`
- `npm test`
- `npx @vscode/vsce package`
- 替换占位 `publisher`
- 视需要替换占位图标和截图
