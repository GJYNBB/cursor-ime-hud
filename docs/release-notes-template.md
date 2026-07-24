# Cursor IME HUD {{VERSION}}

在光标旁显示中文 / 英文输入法状态，并同步状态栏。本发行包包含 VS Code / Cursor 扩展与 JetBrains 插件。

## 下载哪个文件？

### VS Code / Cursor

在扩展面板选择「从 VSIX 安装…」，按你的系统选择：

| 系统                                     | 文件                                           |
| ---------------------------------------- | ---------------------------------------------- |
| Windows（x64，大多数电脑）               | `cursor-ime-hud-{{VERSION}}-win32-x64.vsix`    |
| Windows（ARM64，如 Surface 等）          | `cursor-ime-hud-{{VERSION}}-win32-arm64.vsix`  |
| macOS（Intel 芯片）                      | `cursor-ime-hud-{{VERSION}}-darwin-x64.vsix`   |
| macOS（Apple Silicon，M 系列）           | `cursor-ime-hud-{{VERSION}}-darwin-arm64.vsix` |
| Linux（x64）                             | `cursor-ime-hud-{{VERSION}}-linux-x64.vsix`    |
| Linux（ARM64，如树莓派 4/5、部分笔记本） | `cursor-ime-hud-{{VERSION}}-linux-arm64.vsix`  |
| Linux（ARM 32 位，如树莓派 2/3）         | `cursor-ime-hud-{{VERSION}}-linux-armhf.vsix`  |

不确定系统架构时，可直接使用通用离线包 `cursor-ime-hud-{{VERSION}}.vsix`（体积较大，但适用于上述所有平台）。

### JetBrains（IntelliJ IDEA / PyCharm / WebStorm 等）

设置 → 插件 → 齿轮 → 从磁盘安装插件…，选择：

`cursor-ime-hud-jetbrains-{{VERSION}}.zip`

## 安装后

1. 重载 IDE，打开任意可编辑文件并把光标放在编辑区。
2. 切换中文 / 英文输入状态，观察光标旁标签与底部状态栏。

## 隐私

不读取文件、不读取剪贴板、不记录按键、不修改系统输入法状态。

构建物料清单（SBOM）随附：`cursor-ime-hud-{{VERSION}}-vsix.cdx.json` 与 `cursor-ime-hud-jetbrains-{{VERSION}}.cdx.json`。
