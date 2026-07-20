## 变更摘要

<!-- 描述改了什么、为什么改；如有关联 issue，请附上链接。 -->

## 面向用户的变更

- [ ] 没有改变用户可见行为
- [ ] 修改了命令、设置、README 或诊断信息
- [ ] 修改了 HUD / 状态栏行为
- [ ] 修改了 native helper 行为
- [ ] 修改了 VSIX 文件或 Marketplace 元数据

## 检查清单

- [ ] 行为或打包方式发生变化时，我已在 `[Unreleased]` 下更新 `CHANGELOG.md`。
- [ ] 命令、设置、支持范围或故障排查方式变化时，我已更新 README / 文档。
- [ ] `package.json` 中的用户可见字符串变化时，我已同步更新 manifest 本地化文件。
- [ ] 涉及 Marketplace / HUD 的视觉变化时，我使用了真实截图或 GIF，或说明了不需要截图的原因。
- [ ] 我已考虑隐私和安全影响：文件内容、剪贴板内容、实际输入文本、遥测、helper 执行及完整性校验。

## 验证

请列出运行过的命令：

- [ ] `npm run compile`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:unit`
- [ ] 仅 Windows / helper 相关改动：`npm test`
- [ ] 仅打包相关改动：`npx @vscode/vsce ls --no-dependencies`
- [ ] JetBrains 相关改动：`./jetbrains/gradlew -p jetbrains test`

```text
粘贴相关输出，或说明跳过了哪些检查及原因。
```
