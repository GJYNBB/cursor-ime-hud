---
name: signpath-code-signing-policy
description: Cursor IME HUD 的 SignPath 代码签名政策（中英双语）
metadata:
  type: reference
---

# Code Signing Policy —— Cursor IME HUD

**Effective:** 2026-07-22  
**Service:** SignPath Foundation（开源免费版）

## 1. 签名服务
所有 Windows VSIX 包、JetBrains 插件以及原生 helper 可执行文件均通过 SignPath 平台进行签名。签名由可信的开源维护者完成（详见人员角色）。

## 2. 人员角色

- **维护者**（GJYNBB）：负责将签名后的工件上传至 GitHub Releases，并进行代码审查。
- **安全负责人**（项目层面）：审核签名证书并记录日志。
- **用户**：应使用官方 `.sha256` 或 SignPath 验证工具验证下载文件的签名。

## 3. 隐私政策
SignPath 遵守代码签名操作最小化数据收集的隐私政策。请参阅：[SignPath 隐私政策](https://signpath.io/privacy)。

在签名过程中不会收集或处理任何个人数据（输入按键、剪贴板、编辑器文件等）。

## 4. 合规要求
- 所有发布版本必须包含有效的代码签名。
- 签名验证已在 helper 协议中强制执行。
- 政策更新需要新版本发布并更新时间戳。

签名后的工件按现有 MIT 许可证分发。签名二进制文件不附加任何超出原项目许可的其他条款。

---

# Code Signing Policy — Cursor IME HUD

**Effective:** 2026-07-22  
**Service:** SignPath Foundation (free open-source tier)

## 1. Signing Service
All Windows VSIX packages, JetBrains plugins, and native helper executables are signed using the SignPath platform. Signing is performed by trusted open-source maintainers (see Roles).

## 2. Personnel Roles

- **Maintainer** (GJYNBB): Responsible for uploading signed artifacts to GitHub Releases and performing code reviews.
- **Security Officer** (project-level): Verifies signing certificates and logs.
- **Users**: Expected to validate signatures on downloaded files using the official `.sha256` or SignPath verification tools.

## 3. Privacy Policy
SignPath adheres to privacy policies that minimize data collection for code-signing operations. See: [SignPath Privacy Policy](https://signpath.io/privacy).

No personal data (input keystrokes, clipboard, editor files) is collected or processed during signing.

## 4. Compliance
- All releases must include a valid code signature.
- Signature verification is enforced in the helper protocol.
- Updates to this policy require a new release with updated timestamp.

Signed artifacts are distributed under the existing MIT license. No additional license terms apply to the signed binaries beyond the original project license.