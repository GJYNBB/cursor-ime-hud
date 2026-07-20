# Cursor IME HUD JetBrains 插件

Cursor IME HUD（输入法状态提示）的跨平台 JetBrains IDE 插件。

本模块单独放在 `jetbrains/` 目录中，以免影响现有 VS Code/Cursor 扩展的打包流程。仓库的 `main` 分支同时包含两个客户端：根目录中的 VS Code/Cursor 扩展，以及 `jetbrains/` 目录中的 JetBrains 插件。

## 功能范围

- 本机助手支持 Windows x64/ARM64、macOS x64/ARM64，以及 Linux x64/ARM64/ARMHF。
- 复用 `../docs/helper-protocol.md` 中定义的 Rust JSONL 助手协议。
- 状态栏提示：`输入法：中`、`输入法：英`、`输入法：ZH`、`输入法：EN` 或 `输入法：?`；点击打开菜单（开启/关闭光标旁图标 / 刷新 / 诊断 / 设置）。
- 光标旁提示：在当前编辑器光标附近显示紧凑的状态图标，可选择 `中` / `英` 或 `ZH` / `EN` 标签方案。
- 操作命令：刷新输入法状态、开关光标旁提示、显示诊断信息。
- 设置项：提示文字与状态栏标签方案、中文/英文状态颜色、状态栏开关、光标旁提示开关、透明度、位置偏移，以及编辑器失焦时是否隐藏提示。
- 对不受支持的操作系统或架构组合安全降级：不启动本机助手，并将状态报告为 `unknown`。

## 构建

在本目录中使用仓库自带的 Gradle 9.0.0 Wrapper：

```bash
./gradlew test
./gradlew buildPlugin
./gradlew verifyPlugin
```

打包时，`processResources` 可以运行仓库中的 `scripts/build-helper.js`，为当前主机构建本机助手，并从 `resources/bin/**` 打包助手资源。发布工作流会先在原生或交叉编译环境中构建 Windows、macOS 和 Linux 助手，再组装插件 ZIP。

JetBrains ZIP 保持为通用安装包，并包含所有受支持平台的助手。JetBrains Marketplace 目前没有稳定的生产级方案，可以把同一插件版本发布成多个操作系统或架构变体；若移除其他平台助手，将导致自动安装不可用，或要求插件首次运行时联网下载。以当前安装包体积来看，保留离线安装能力和确定性的助手校验更合适。

首次发布到 Marketplace 建议手动完成。后续可在 CI 中通过 `PUBLISH_TOKEN`、`CERTIFICATE_CHAIN`、`PRIVATE_KEY` 和 `PRIVATE_KEY_PASSWORD` 等 Secret 自动发布。

## 插件签名（Marketplace ZIP）

这是 **JetBrains 插件 ZIP 签名**，与 Windows/macOS native helper 的 OS 代码签名无关，也**不需要付费证书**。

### 仓库已接线

- `build.gradle.kts` 的 `intellijPlatform.signing` 读取环境变量：
  - `CERTIFICATE_CHAIN`（PEM 证书链）
  - `PRIVATE_KEY`（PEM 私钥）
  - `PRIVATE_KEY_PASSWORD`（私钥口令；未加密私钥可为空）
- tag 触发的 `.github/workflows/jetbrains-package.yml` 在三项可用时执行 `signPlugin`，并优先发布 `*-signed.zip`。

### 本地生成密钥（维护者）

```bash
# Git Bash / Linux / macOS。Windows 下若 subj 路径被改写，先：export MSYS_NO_PATHCONV=1
mkdir -p .secrets/jetbrains-signing
openssl genrsa -aes256 -out .secrets/jetbrains-signing/private_encrypted.pem 4096
openssl req -new -x509 \
  -key .secrets/jetbrains-signing/private_encrypted.pem \
  -out .secrets/jetbrains-signing/chain.crt \
  -days 3650 \
  -subj "/CN=Cursor IME HUD Plugin Signing/O=chestnut-ch/C=CN"
```

`.secrets/` 已在根目录 `.gitignore` 中忽略，**切勿提交**私钥或口令。

### 写入 GitHub Actions Secrets

在仓库 `Settings → Secrets and variables → Actions`，或用 CLI：

```bash
gh secret set CERTIFICATE_CHAIN -R GJYNBB/cursor-ime-hud < .secrets/jetbrains-signing/chain.crt
gh secret set PRIVATE_KEY -R GJYNBB/cursor-ime-hud < .secrets/jetbrains-signing/private_encrypted.pem
# 加密私钥时再设置口令（明文一行即可）
gh secret set PRIVATE_KEY_PASSWORD -R GJYNBB/cursor-ime-hud < .secrets/jetbrains-signing/PRIVATE_KEY_PASSWORD.txt
```

规则：

- `CERTIFICATE_CHAIN` 与 `PRIVATE_KEY` 必须成对；
- `PRIVATE_KEY_PASSWORD` 在私钥有口令时必填，无口令可省略/留空；
- 只配了一部分会让 tag 构建失败，避免误发半配置状态。

### 本地试签

先能 `buildPlugin` 后：

```bash
export CERTIFICATE_CHAIN="$(cat .secrets/jetbrains-signing/chain.crt)"
export PRIVATE_KEY="$(cat .secrets/jetbrains-signing/private_encrypted.pem)"
export PRIVATE_KEY_PASSWORD="$(cat .secrets/jetbrains-signing/PRIVATE_KEY_PASSWORD.txt)"
./gradlew --no-daemon signPlugin -PverifyAllNativeHelpers=true
# 产物：build/distributions/*-signed.zip
```

### 备份

私钥丢失后无法用同一身份继续签后续版本。请把 `.secrets/jetbrains-signing/` **离线备份**到密码管理器或加密盘，不要只放在本机工作区。
