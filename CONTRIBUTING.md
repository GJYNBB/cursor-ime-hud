# 参与贡献

感谢你关注 `cursor-ime-hud`。本文说明如何搭建本地开发环境、运行测试并提交改动。

## 项目范围

项目有意保持清晰、克制的边界：在主光标附近显示输入法状态，并在状态栏同步提示。我们不会加入自动切换输入法、根据输入内容猜测语言或拦截实际输入等功能。请确保新增功能符合这一范围。

## 环境要求

- **Node.js 24+**（与 `package.json` 中的 `engines.node` 一致）
- **npm 11+**（Node.js 24 随附）
- **Rust stable 工具链**（`cargo`），用于从源码构建随包提供的 native helper
- 当前平台对应的原生工具链：Windows 使用 MSVC Build Tools / Visual Studio C++ 工具链，macOS 使用 Xcode Command Line Tools，Linux 使用系统 C/C++ 构建工具链；交叉编译 ARM 目标还需要对应的交叉工具链
- 开发 JetBrains 插件时需要 **JDK 21**；仓库已提供 Gradle wrapper
- Linux 无界面环境运行 VS Code Extension Host 测试时需要 **Xvfb**

helper 是单文件 Rust 可执行程序。安装正式 VSIX 或 JetBrains ZIP 的用户不需要安装 Rust 或上述构建工具。

## 开发环境

VS Code / Cursor 扩展：

```powershell
npm install
npm run compile
npm run build:helper
npm test
```

`npm run build:helper` 会构建当前主机对应的 helper，并生成相邻的 `.sha256` 校验文件，无需手动复制哈希值。仓库包含 `.vscode/launch.json` 和 `.vscode/tasks.json`，因此在 VS Code 中按 `F5` 即可启动扩展开发宿主，并自动执行已配置的 helper 构建任务。

JetBrains 插件：

```bash
./jetbrains/gradlew -p jetbrains test
./jetbrains/gradlew -p jetbrains buildPlugin
```

## Pull request 流程

- 目标分支使用 `main`。
- 所有 CI 检查必须通过。主 CI 会运行 lint、格式检查、VS Code 扩展测试，并在各平台验证 native helper；JetBrains 工作流负责插件测试和打包检查。
- 行为或打包方式发生变化时，请在 `CHANGELOG.md` 的 `## [Unreleased]` 下记录变更。
- 修改包元数据、README 链接或 VSIX 文件白名单后，请运行 `npx @vscode/vsce ls --no-dependencies`，确认包内文件符合预期。
- 需要一名审阅者批准。
- PR 使用 squash merge。可以在本地使用聚焦的小提交；PR 正文应说明改动内容、原因及关联 issue。

## 代码风格

- **TypeScript：** `tsconfig.json` 已启用严格模式。优先使用明确类型，不要使用 `any` 扩大类型范围。
- **Kotlin：** 遵循现有 JetBrains 模块结构和 IntelliJ Platform API 用法，并为行为变更补充相应测试。
- **Lint 与格式化：** 使用 ESLint 和 Prettier。运行 `npm run lint` 检查，运行 `npm run format` 应用格式化。
- **模块分层：** 遵循 `model/`、`detector/`、`controller/`、`renderer/`、`presenters/`、`services/` 的现有边界。完整规则见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
- **TSDoc：** `src/**` 中的公开导出都需要 TSDoc。未导出的内部辅助函数不强制要求，但魔法数字和不直观的分支应有行内注释。

## 运行单项测试

TypeScript 测试使用 Mocha。可用 `--grep` 聚焦单个 `describe` / `it` 名称：

```powershell
# 运行标准的 VS Code Extension Host 测试入口
npm run test:extension

# 按标题筛选 VS Code 扩展测试
npm run test:extension -- --grep "SettingsService"
```

helper 的 `--once` 冒烟测试位于 `scripts/assert-helper-once.js`。构建当前平台 helper 后可直接运行：

```powershell
npm run build:helper
node scripts/assert-helper-once.js
```

JetBrains 可按 Gradle 测试名筛选：

```bash
./jetbrains/gradlew -p jetbrains test --tests "*TestName*"
```

## 新增探测器

完整数据流见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 中的 data flow 和 helper IPC 章节。简要流程如下：

1. 实现 `src/detector/ImeDetector.ts` 中的 `ImeDetector`，返回 `ImeSnapshot`；探测器中不要调用 VS Code UI API。
2. 如果探测器封装子进程，请在 `src/detector/helperProtocol.ts`（或同级文件）定义协议，并在 [`docs/helper-protocol.md`](docs/helper-protocol.md) 记录线格式。
3. 将探测器接入 `SampleOrNativeDetector`。
4. 为解析、错误和超时路径添加单元测试。
5. 同步更新 [`docs/helper-protocol.md`](docs/helper-protocol.md) 和 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 报告问题

请使用 `.github/ISSUE_TEMPLATE/` 下的模板，并提供：

- IDE 名称和版本
- Cursor IME HUD 版本（可运行 `Cursor IME HUD：显示诊断信息（Show Diagnostics）` 查看）
- **Cursor IME HUD** 输出通道或日志中的相关内容
- 操作系统、架构和输入法 / 输入源信息
- 可复现步骤

## 行为准则

请尊重他人并以善意沟通。项目行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
