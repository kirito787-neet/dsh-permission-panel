# 项目开发与 npm 发布规则

本文件适用于本仓库（`dsh-permission-panel`）。所有 Agent 在修改代码前先阅读本文件与 [docs/RELEASING.md](docs/RELEASING.md)。若工具不会自动读取 `AGENTS.md`，由用户在任务中明确要求读取；不要假定所有工具都支持相同的规则文件约定。

## 发布模型（与通用模板的差异，先读这一节）

本项目的发布**以 git tag 为准，不从分支自动发版**，因此**没有使用 semantic-release**，也不要引入它：

- 每次发布是一个不可变快照：tag `vX.Y.Z` 必须指向真正被发布的那个提交。
- 版本号由 `tools/release.cjs` 在**本地**决定并写进 `package.json`，随 tag 一起推上去；CI 不回写版本、不猜版本。
- `.github/workflows/release.yml` 只做三件事：跑测试 → 用 Trusted Publishing (OIDC) 发布 → 建 GitHub Release。
- 这是本项目**唯一**的发布流水线。不要并行搭建第二套（semantic-release、release-please、changesets 等），也不要在分支合并时自动发布。

## 首次接入 / 换环境

先按 [docs/RELEASING.md](docs/RELEASING.md) 核对 `package.json`、工作流、Git 标签历史与 npm 上的实际版本。本项目是**根目录单包、npm、默认分支 `master`、零运行时依赖、零构建步骤**——不要添加 `npm ci`、`npm run build`、锁文件或 devDependencies，除非项目确实新增了依赖或构建步骤（届时 workflow 与文档要同步更新）。

**当前已知的历史不一致（先读 [docs/RELEASING.md](docs/RELEASING.md) 第六节）**：npm 上 `latest` 仍是 `3.2.0`，而 GitHub 上已有 `v3.3.0` 的 tag 与 Release。原因是 `3.2.0` 之后工作流改用 OIDC，但 npm 侧 trusted publisher 从未登记成功（`404 package not found`）。在这条修好、`npm view dsh-permission-panel version` 能看到 `3.3.0` 之前，**不要用 3.3.0 之后的版本号继续发版**。

## 日常更新

1. 在独立分支工作，遵循项目现有开发规范。
2. 运行项目要求的真实检查：`npm test`（纯 Node 内置模块，8 个 `test/*.cjs` 串行跑）、`npm pack --dry-run`（核对包内文件清单）。没有对应脚本时先确定真实检查命令，**不要**为了通过流水线添加空脚本、静默跳过检查或删除检查。
3. 检查 npm 包内文件、入口与运行时资源（`files` 字段当前为 `index.js`、`client.js`、`cordis.patch.yml`、`README.md`）；不得包含密钥、本地配置或无关文件。
4. 提交使用 Conventional Commits：`fix:` 修复，`feat:` 新功能，`perf:` 性能改进，`docs:` 文档，`chore:` 维护，`test:` / `ci:` / `style:` / `refactor:` 也照常用。不兼容变更用 `feat!:` 等带 `!` 的类型，并在正文写 `BREAKING CHANGE:` 与迁移方法。
5. 使用 squash 合并时，最终合并标题也必须符合上述规范——它决定了变更在发布说明里怎么归类。
6. 用户授权后再推送、创建 PR 或合并。**未获合并授权时停留在可审阅分支或 PR，不得自行合并**。
7. 日常更新不要手动 `npm version`、`npm publish`、手工打发布标签或回写版本。版本与发布统一走 `npm run release` + 推 tag 的正规路径（见下）。
8. 合并/tag 推送后，若可访问远端，检查 Actions 结果、GitHub Release 与 `npm view dsh-permission-panel version` 的实际版本；未能核验时明确说明，**不把代码推送等同于发布成功**。
9. 发布失败先读日志与远端版本、标签状态；**不得删除已发布标签、覆盖版本、跳过检查或盲目重复发布**。修复后按 [docs/RELEASING.md](docs/RELEASING.md) 的恢复章节处理。
10. 不将 npm token、密码或认证文件写入源码、日志和提交。不得为实现发版而移除分支保护。

## 发版预期

- `fix`、`perf` → patch；`feat` → minor；`BREAKING CHANGE` 或带 `!` → major。实际版本仍由 `npm run release <patch|minor|major|x.y.z>` 显式指定，提交类型只决定**该不该发**、发说明怎么写。
- `docs`、`chore`、`test`、`ci`、`style`、普通 `refactor` 默认**不单独发版**；它们随下一次功能性发布一起进 Release notes。若重构确实修复了问题或带来功能，按真实影响选择 `fix` 或 `feat`，不能伪造提交类型强行发版。
- 发布前的历史对齐：`git tag --sort=-v:refname` 与 `npm view dsh-permission-panel version` 必须能对上；对不上就先查清原因，不要在状态不一致时继续发版。
- 当前方案不把 CI 算出的版本提交回 `master`；以 npm 实际版本、Git 标签与 GitHub Release 三者一致为准。

## 本地发版入口（唯一正确路径）

```bash
npm run release patch        # 3.3.0 -> 3.3.1；也接受 minor / major / 3.4.1
git push origin master --follow-tags
```

`tools/release.cjs` 的前置检查（必须在 `master`、工作树干净、不落后 `origin/master`、目标 tag 不存在）不满足时，会在改动任何文件之前退出。`--dry-run` 不写任何字节。

## 官方参考

- npm Trusted Publishing：<https://docs.npmjs.com/trusted-publishers/>
- GitHub Actions 与 OIDC 权限：<https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>
