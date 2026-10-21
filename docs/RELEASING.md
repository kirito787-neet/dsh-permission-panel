# 发布说明（dsh-permission-panel）

本文件描述**本仓库实际使用**的发布流程。它来自通用模板 `npm-auto-release`，但已按本项目情况改写：本项目走 **tag 驱动**，不使用 semantic-release，也没有 `release.config.cjs`。改动发布流程前先读这里和根目录 [AGENTS.md](../AGENTS.md)。

## 一、这套流程是什么

```
本地 npm run release <patch|minor|major|x.y.z>
        └─ 校验分支/工作树/是否落后 → 改 package.json 版本 → npm test → commit + annotated tag
git push origin master --follow-tags
        └─ .github/workflows/release.yml
              job 测试 : 在 tag 指向的提交上再跑 npm test + npm pack --dry-run
              job 发布 : 校验 tag == package.json version → npm publish（Trusted Publishing / OIDC）
                         → gh release create <tag>
```

设计取舍：

- **tag 就是发布快照**，不是分支合并。事后能回答「npm 上那个 3.2.0 到底是哪份代码」；如果改成「合并到 master 就发版」，每个普通提交都会变成一个版本号，版本号随即失去意义。
- **版本号在本地决定**，CI 不猜版本、不回写版本。因此没有「CI 算的版本和源码不一致」这类问题，也不需要为了回写版本绕过分支保护。
- **只在前面失败就在前面停住**：`npm publish` 失败时不会去建 GitHub Release，所以不会出现「GitHub 上有版本、npm 上没有」的假象。反过来（npm 有、Release 没建成）重跑工作流即可补齐，`gh release view` 会跳过已存在的 Release。

## 二、首次接入 / 换环境时先核对的清单

1. **默认分支**：本仓库是 `master`，不是 `main`。workflow 的触发分支、`tools/release.cjs` 里的 `branch !== "master"` 检查、本文档都以 `master` 为准。改名或换分支必须三处同步改。
2. **包的身份**：`package.json` 的 `name` = `dsh-permission-panel`，没有 `private: true`，`repository.url` 指向 `github.com/kirito787-neet/dsh-permission-panel`，`publishConfig` 为 `{ "access": "public", "registry": "https://registry.npmjs.org/" }`。`files` 必须恰好覆盖运行时需要的文件（当前 `index.js`、`client.js`、`cordis.patch.yml`、`README.md`）。
3. **依赖与构建**：本项目**零运行时依赖、零构建步骤**，测试只用 Node 内置模块。因此 workflow **没有** `npm ci`、没有 `npm run build`，仓库里也没有 `package-lock.json`。如果将来真的引入了依赖或构建步骤，要**同时**改 workflow、`files`（如产物要进包）和本文档；不要为了「看起来标准」添加空的 `build` 脚本或锁文件。
4. **历史对齐**：`git tag --sort=-v:refname` 与 `npm view dsh-permission-panel version` 必须能对上。已知的历史状态见第六节。
5. **不要并行启用第二套发布工具**：不引入 semantic-release / release-please / changesets，也不要在分支合并时自动发布。

## 三、日常发版（唯一正确路径）

```bash
# 1) 本地：改版本号 + 跑全套测试 + 核对包内容 + 提交 + 打 tag
npm run release patch          # 3.3.0 -> 3.3.1；也接受 minor / major / 3.4.1
# 前置检查不满足会在改动任何文件之前退出：
#   - 当前分支必须是 master
#   - 工作树必须干净
#   - 不能落后 origin/master
#   - 目标 tag 不能已存在
# 预演不发版： npm run release patch --dry-run（不写任何字节、不改版本号）

# 2) 推送，触发 CI
git push origin master --follow-tags
```

推上去之后：

1. `job 测试` 在 **tag 指向的提交** 上重跑 `npm test` —— tag 指向的代码必须自己是绿的；再跑 `npm pack --dry-run` 确认包内文件清单没有意外增删（例如把 `.gitignore` 里的东西打进包、或漏掉 `client.js`）。
2. `job 发布` 先做三项前置断言：没有残留 `NODE_AUTH_TOKEN`、`ACTIONS_ID_TOKEN_REQUEST_URL` 存在（即 `id-token: write` 生效）、npm CLI ≥ 11.5.1；再校验 `tag` 与 `package.json` 的 `version` 是同一个数字（对不上直接失败，因为 npm 不允许覆盖已发布版本）。
3. 用 **Trusted Publishing (OIDC)** 执行 `npm publish --access public --loglevel verbose`。仓库里没有任何 npm 长期密钥。
4. `gh release create <tag> --verify-tag --generate-notes`。已存在则跳过。

## 四、npm 侧一次性配置：Trusted Publisher

发布凭据来自 GitHub Actions 的 OIDC：GitHub 每次签发一张短期、绑定「本仓库 + 本工作流」的一次性 token，npm 侧用**事先登记**的 trusted publisher 关系验证它。**这一步只能由账号本人在浏览器里做（带 2FA），CI 和 Agent 都改不了这个设置。**

1. 打开 <https://www.npmjs.com/package/dsh-permission-panel/access>
2. **Trusted Publisher** → **Select your publisher** → **GitHub Actions**
3. 填三项，必须与下面完全一致：
   - **Organization or user**：`kirito787-neet`
   - **Repository**：`dsh-permission-panel`
   - **Workflow filename**：`release.yml`（只填文件名，不要带 `.github/workflows/` 前缀）
4. **Allowed actions** 勾上 **npm publish**（不勾的话 OIDC 身份只能做 stage publish，正式发布会 403）
5. **Environment name 留空**（本工作流没有使用 GitHub Environments，填了会让 OIDC 的 `sub` 声明对不上）
6. 保存

三个容易踩的坑：

- **新建的配置有 48 小时有效期**：登记后必须在 48 小时内成功发布一次，配置才会被标记为「已验证」并免于过期；超时会过期作废（仍显示在设置页里，但不计数、也不能授权发布），只能删掉重建。改仓库或项目身份会重新开始一个 48 小时窗口；普通编辑不会重置。见 [GitHub Changelog 2026-10-02](https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire/)。
- **`setup-node` 的 `registry-url` 会毒化 OIDC**：只要给 `actions/setup-node` 传了 `registry-url`，它就会写一行 `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` 到 `.npmrc`，并把该变量导出成占位值。npm 见到「有凭据」就**根本不做 OIDC 交换**，报 `npm error code ENEEDAUTH`。所以 workflow **刻意不传** `registry-url`，并额外 `unset NODE_AUTH_TOKEN` 兜底。
- **provenance 不一定真的自动生成**：npm 文档说 trusted publishing 会自动附带 provenance，但实测有多例必须显式加 `--provenance` 才发得出去（[philna.sh 复盘](https://philna.sh/blog/2026/01/28/trusted-publishing-npm)、[npm/cli#8730](https://github.com/npm/cli/issues/8730)）。本仓库的 publish 命令因此显式带 `--provenance`，并在发布后回读 `dist.attestations` 确认；缺了只告警不阻断。
- **判断失败原因的唯一线索是 `--loglevel verbose`**：它会打印 `Failed token exchange request with body message: ...`。出现 `404 / package not found` 就是 npm 侧没有匹配的 trusted publisher 登记；出现 `Skipped because incorrect permissions for id-token` 则是 job 缺 `id-token: write`。

> 想更严格：npm 包的 **Settings → Publishing access** 可以选「Require two-factor authentication and disallow tokens」，这会禁掉所有传统 token 的发布权限，而 OIDC trusted publisher 不受影响。本仓库没有 token，这一项只是加一道保险。

## 五、发布后核验（缺一不可）

```bash
npm view dsh-permission-panel version                     # 期望：刚发布的版本
npm view dsh-permission-panel@<版本> dist.tarball          # 期望：返回 tarball URL
npm view dsh-permission-panel@<版本> dist.attestations     # 期望：有 provenance 记录
```

还要在网页上确认：

- Actions 该次 run 的两个 job 都是 success；
- GitHub 上 tag 指向的提交与 `package.json` 版本一致，GitHub Release 已创建（且 notes 不是空的）；
- 在临时目录真实装一次验证入口可用：

```bash
mkdir -p /tmp/verify && cd /tmp/verify
npm init -y >/dev/null
npm i dsh-permission-panel@<版本>
node -e "console.log(Object.keys(require('dsh-permission-panel/package.json').exports))"
```

**包能安装、入口能解析、功能验证通过，才算完整发布验收。** 只看 Actions 绿灯不算。

## 六、已知的历史状态（截至 3.3.0 事件）

| 项 | 值 |
| --- | --- |
| 默认分支 | `master` |
| 已有 tag | `dsh`、`dsh-plugin`、`v2.0.0`、`v2.1.0`、`v3.0.0`、`v3.0.1`、`v3.0.2`、`v3.2.0`、`v3.3.0` |
| npm `dist-tags.latest` | `3.2.0`（`3.3.0` **从未发布到 npm**） |
| GitHub Release | `v3.3.0`（手工创建）、`v3.2.0`（Actions 创建） |

**不一致点**：GitHub 上已有 `v3.3.0` 的 tag 和 Release，但 npm 上 latest 仍是 `3.2.0`。

**根因（已用日志与历史 workflow 逐条核对，不要再猜）**：

1. **3.2.0 是用长期 token 发布的，不是 OIDC。** 发布 3.2.0 的那次 Actions（run `39593230999`，2026-10-21 11:36）用的是提交 `bd090793eb4f64b5bd803691c45a6ab7b6d0c83a`（`chore: 建立 npm 发布流水线`）里的 workflow，那版「发布到 npm」步骤是 `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` + `npm publish --access public --provenance`。
2. **因此「3.2.0 有 provenance」不能证明 trusted publisher 登记过。** `--provenance` 需要 `id-token: write`，GitHub 会为**签名**签发一张 OIDC 令牌并产出 SLSA 证明书（所以证明书的 SAN 里确实写着 `release.yml@refs/heads/master`），但 npm 侧**认证**走的是 `NPM_TOKEN`。
3. 2026-10-21 11:52 的提交 `ae482ed`（`ci(release): 切到 npm Trusted Publishing (OIDC)，移除 NPM_TOKEN 依赖`）才把 workflow 改成纯 OIDC。此后 v3.3.0 的两次发布都失败：
   - run `39599726880`（`push` tag `v3.3.0`，12:27）；
   - run `39601437727`（`workflow_dispatch`，12:40，`head_sha` `05b12156`）。
   
   两次都卡在 `npm publish` 的 OIDC 交换：
   ```
   npm http fetch POST 404 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/dsh-permission-panel
   npm verbose oidc Failed token exchange request with body message: OIDC token exchange error - package not found
   npm error code ENEEDAUTH
   ```
   同一次 run 里前面的断言全部通过（`NODE_AUTH_TOKEN is <unset>`、`OIDC request endpoint present`、`npm 11.19.1`、`version ok: 3.3.0`），测试也全绿——**所以这不是 workflow 代码的问题**。`oidc/token/exchange/package/<name>` 返回 `404 package not found`，是 npm 对「该包没有任何 matching trusted publisher 登记」的标准（且刻意含糊的）应答。
4. **结论：trusted publisher 从未登记成功过。** 3.3.0 因此从未上 npm；GitHub 上那个 `v3.3.0` Release 是作者本人（`kirito787-neet`，不是 `github-actions[bot]`）在 12:27 手工补建的。

顺带清理：仓库 **Settings → Secrets and variables → Actions** 里如果还留着 `NPM_TOKEN`，请删掉——本流程已不使用它，留着只会在别处被误用。

处理方式见第七节；**在 npm 上真的能看到 `3.3.0` 之前，不要用 3.3.0 之后的版本号继续发版**——否则 `v3.3.0` 这个 tag 永远对不上一个 npm 版本，历史会更难对齐。

## 七、失败恢复

按失败阶段分别处理，**不要删已发布的标签、不要覆盖版本、不要跳过检查、不要盲目重跑**：

- **测试 / `npm pack --dry-run` 失败**：修复后重新走 `npm run release`（先删掉本地那个没推的 tag：`git tag -d vX.Y.Z`，再改代码、重新发版）。绝不跳过检查。
- **`Failed token exchange request` + `404 package not found`**：npm 侧没有 matching 的 trusted publisher 登记（或登记的 workflow filename / repository / environment 与本次运行不符，或那条配置已过期作废）。去第四节核对并重新登记：

  ```bash
  # 登记后立刻补发（tag 已存在，不会重复建 Release）
  gh workflow run release -f tag=v3.3.0
  ```

  `workflow_dispatch` 只重跑流水线，**不会**创建新版本、也不会改版本号。

  > **不要用「3.2.0 有 provenance」来判断登记过**：`npm publish --provenance` 在只有 `NPM_TOKEN` 的旧流程里也会产出证明书（签名用 OIDC，认证用 token）。判断依据只有一个——当前这次运行的日志里有没有 `404 package not found`。
- **`Skipped because incorrect permissions for id-token` / 或前置步骤报 `ACTIONS_ID_TOKEN_REQUEST_URL 缺失`**：job 的 `id-token: write` 没生效，通常是组织策略覆盖了 `permissions`，或被 caller workflow 限制。
- **`npm error code ENEEDAUTH` 且日志里没有 OIDC 交换**：有残留的 `NODE_AUTH_TOKEN` / `.npmrc` 认证行（典型是 `setup-node` 传了 `registry-url`），npm 因此放弃了 OIDC。检查 workflow 与组织级变量。
- **版本已存在（`E403` / `cannot publish over`）**：npm 上该版本已有，说明本地 `package.json` 与远端已发布版本错位。先查 `npm view` 与 tag 历史，确认哪一步完成过，再决定是补 Release（`gh release create`）还是发下一个版本；**绝不覆盖已发布版本**。
- **半截状态（npm 有、Release 没有）**：直接重跑 worklow（`gh workflow run release -f tag=vX.Y.Z`），`gh release view` 会跳过已存在的 Release，不会重复创建。

## 八、给任何 Agent 的开场指令

> 开始前阅读仓库根目录 `AGENTS.md` 和 `docs/RELEASING.md`，遵守已有项目规范。改完跑真实检查（`npm test`、`npm pack --dry-run`），用 Conventional Commits 提交。发布由 `npm run release` + 推 tag 触发，由 GitHub Actions 完成；不要手动 `npm publish`、不要手工打标签、不要改 workflow 为分支驱动。发布后核验 Actions、GitHub Release 与 `npm view` 的实际版本。

## 官方参考

- npm Trusted Publishing：<https://docs.npmjs.com/trusted-publishers/>
- npm provenance / attestations：<https://docs.npmjs.com/generating-provenance-statements>
- GitHub OIDC 与 `id-token` 权限：<https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>
