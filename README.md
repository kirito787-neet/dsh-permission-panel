# dsh-permission-panel

DSH（DeepSeek Harness）的**工作区权限面板**：把每个会话的权限预设、新会话默认权限和归档状态收进一个可以搜索、可以分组、可以批量修改的列表里。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

插件本身**不存储任何权限状态**：会话权限读自宿主投影、写经宿主原生的 `/permission <preset>` 命令；新会话默认权限写在宿主的 `permission` 设置命名空间里。

> 本项目的代码、测试、文档与提交信息等产物均由 AI 生成，作者只提供想法与方向。详见文末 [AI 生成声明](#ai-生成声明) 与 [免责声明](#免责声明)。

## 功能

### 两个入口

- **会话头部「权限」按钮**：每次为看一眼权限都要走「设置 → 插件 → 工作区权限」三步，入口离使用场景太远。这个按钮挂在 `conversation.session.header.utilities` 槽位上，是**独立注册**（list 槽位新增一格，不替换任何官方控件），点开即在当前窗口弹出同一份面板。
- **设置 → 插件 → 工作区权限**：完整页面。

两处共享同一个组件与同一份模块级状态，看到的会话数据不可能不一致。

### 权限列表

- **每个会话一行**：彩色首字头像、会话标题、工作目录；运行中的会话带绿点。子代理会话不列入。
- **按工作区分组，默认折叠**：归属关系取自 `workspace.sessionIds`（Workspace 注册表声明的成员关系），**不是按 `cwd` 猜**——`cwd` 只是这个会话跑过的路径，两者经常不一致。组头显示工作区名、路径、成员数与**该组已选数量**，可单独折叠；不属于任何工作区的会话落入末尾的「未分组」桶；没有可管理会话的空工作区不显示，另在底部注明隐藏了几个。工具栏有「展开全部 / 折叠全部」一键切换。
- **搜索**：按子串匹配会话标题、工作目录、工作区名与工作区路径，大小写不敏感；标题处实时显示「匹配 N / 总数」；无匹配时有明确空态。**有搜索词时所有分组强制展开**——折叠状态下藏起匹配项会被读成「没有结果」。
- **按权限等级筛选**：工具栏一排 chip，按实际存在的权限等级收窄列表——固定的「全部」，加上列表里真实出现过的「仅可查看 / 工作区内修改 / 完全权限 / 自动」，以及收纳 `null`、`custom` 与部署自定义值的「未知/自定义」。每个 chip 带命中数（取搜索后的结果，所以数字是对当前搜索的承诺）；chip 集合由**实际数据**推导，只发三档预设的部署不会长出「自动」这一格。与搜索是「与」关系：两者可叠加，改筛选不会自动展开分组；无结果时空态区分「筛没了」与「搜没了」。
- **定位当前会话**：会话头入口里工具栏多一个「定位当前会话」按钮。点击后自动清掉会遮住它的搜索词与权限筛选、展开它所在的工作区分组，然后把它那一行滚动到视口中央并短暂高亮 1.6 秒。归属判断走**未过滤**的完整列表，所以「搜索/筛选把它挡住了」绝不会被误报成「会话不在了」；真正不在列表里（例如已归档）时才在面板底部提示。
- **两级全选**：全局「全选」与每个工作区组头的「全选」各管一层，部分选中呈现半选态（`indeterminate` + `aria-checked="mixed"`），此时点击会全选而非取消。全局全选只作用于**当前展开且可见**的可管理行。
- **过滤即收窄选择**：被搜索隐藏的行会从已选中集合中移除。对看不见的会话做批量写入是用户无法预期的行为，所以「选择范围永远等于可见范围」。
- **折叠不等于过滤**：折叠只是收起视线，**不会**清空该组里已经勾好的选择——组头会显示「已选 N」，批量条也照常计数。把行收起来就悄悄丢掉勾选，会让批量条上的数字变得无法解释。
- **右侧预设下拉**：仅可查看 / 工作区内修改 / 完全权限，带彩色预设标记与选中勾。切换通过宿主原生命令**按会话 id** 下发，立即生效。
- **新会话默认权限**：候选项取自 `catalog.defaultOptions`（可作为默认的预设子集），当前值取自 `permission` 命名空间的 `defaultPreset`；写入走一次 settings mutation 并携带 revision 做乐观并发校验。**只影响之后新建的会话**，已有会话不受影响。
- **完全权限确认**：切到 `danger-full-access` 前弹出居中模态（Portal 到 `<body>`，不随面板滚动），必须勾选风险确认才能继续；支持 `Esc` 与点击遮罩取消。批量切换**整批只确认一次**——同一个确认问十遍只会训练用户无脑点过。
- **批量修改**：勾选后出现批量条（已选数量 + 预设选择器 + 应用到所选 / 清除选择）。逐条顺序下发而非并发：每个会话是一条独立命令，并发推进不了什么，却让「到底哪条失败」无法归因；部分成功按部分成功汇报，失败原因点名到会话，最多列 5 条，其余折叠计数。
- **只有能真正改动的行才有勾选框**：给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择，数量与结果会对不上。
- **归档会话不出现**，并在卡片底部注明跳过了几个：归档意味着会话已经结束，宿主自身的归档闸门会拒绝为它执行模型步骤，给它一个权限开关等于给一个不会起作用的控件。跳过数量明确写出来，因为行突然消失看起来像 bug。
- **手动刷新**：重新读取 `remote.session.list`，并把没有投影提示的行重新排入冷读队列。
- **补读投影**：会话列表只带宿主已经推过来的投影，从没打开过的会话通常没有 `permissions` 键。此时面板对该会话做一次冷读（`remote.session.projections`，宿主由 `observeSession` 应答，**不激活 Agent**）。刻意**不用 `retain()`**：那会实体化客户端 scope 并打开历史，为每一行这么做等于把侧栏里所有会话全部打开。
- **「不可用」不是三种处境的同一个答案**：每行带一个读取状态（待读 / 读取中 / 已读 / 空 / 失败），下拉在占位时分别显示对应说明。冷读结果**权威覆盖**旧值——这是别处改过权限后唯一能同步到面板的路径。

### 当前会话实际生效策略

面板顶部的一张卡片，显示当前会话的标题、**宿主冷读回来的**预设值，以及宿主 catalog 里该预设的原文说明。`custom` 派生态显示为「自定义」。每次打开面板强制冷读一次，切换成功后再读一次确认，旁边还有「重新读取」按钮。

两个刻意的约束：

1. **卡片只出现在会话头部入口**。那里由槽位直接给出 `sessionId`，出处明确。设置页没有会话上下文，DSH 0.2.1 也没有任何受支持的客户端接口能回答「主视图里是哪个会话」（`sessions` 快照 store 已被移除），所以设置页不猜——它直接说明该卡片需要从会话头部进入。
2. **策略说明只引用宿主的原话**。`permissions` 投影的 wire 形状只有 `{ currentValue }`；沙箱模式投影没有 wire、审批策略根本没有投影。任何「从预设名反推沙箱与审批」的实现都只是在编，而没有根据的确定性正是这一版要消灭的东西。

### 快捷键

只贡献**一个**命令，注册进官方快捷键服务，因此直接出现在 **设置 → 快捷键** 里，与官方命令共用同一套录制、改绑、恢复默认与冲突检测。

| 命令 | 默认键位 | 载体 |
| --- | --- | --- |
| 重启 DSH（权限面板） | `Ctrl+Shift+R`（macOS `Cmd+Shift+R`） | 仅 Desktop |

- 命令 id 是 `permissionPanel.restart`，加载期用官方 `commandPattern` 自校验。官方注册器**不校验** id 语法，但持久化层校验：语法错误的 id 会先注册成功，再在用户第一次编辑时让整份快捷键文档被判为 `invalid`，把整个设置界面变成只读。
- 键位只声明 Desktop 档位（`desktop:macos|windows|linux`）：浏览器载体没有应用可重启，声明 Web 默认值只会给出一个永远触发不了的键位。Web 下 `resolve` 返回 `blocked`，也不会向不存在的 `/api/desktop/*` 端点发请求。
- 执行路径：优先 Electron preload 桥 `window.dshDesktopActions.invoke("restart")`，否则回退 `POST /api/desktop/restart`。
- 注册包在 `try/catch` 里：注册失败只退化为「没有快捷键」，不会让插件激活失败。
- 快捷键的持久化**不在插件里**：宿主偏好文档是唯一真相（Web `dsh.keybindings.v1`，Desktop `userData/keybindings.json`）。

**快捷键开关**（设置 → 插件 → 权限面板）拦的是**动作**，不是绑定：停用后命令仍留在官方快捷键列表中，键位、冲突检测、录制结果都不受影响，只是按下时不执行；停用返回 `pass` 而不是 `blocked`，避免一个被停用的插件快捷键吞掉用户真正想按的组合。

## 安装

`dsh plugin add` 只接受一个精确的包目标（本地路径、tarball、npm 包名走同一条命令）；装完会自动把包写进该 profile 的 `dsh.profile.bundles`。

```bash
# 1) 从本地源码目录安装（开发用，改完重启即生效）
dsh plugin --profile <profile> add "link:<本仓库绝对路径>"

# 2) 从 tarball 安装（不带源码，最干净）
npm pack
dsh plugin --profile <profile> add "file:<绝对路径>/dsh-permission-panel-<version>.tgz"

# 3) 从 npm 安装（推荐）
dsh plugin --profile <profile> add dsh-permission-panel

# 需要固定某一版时
dsh plugin --profile <profile> add dsh-permission-panel@3.2.0
```

- `--profile` 是必填项，没有默认 profile。
- `--profile desktop` **只被 DSH Desktop 自带的 `dsh` 接受**：普通 `@deepseek-ai/dsh` 会直接报 `profile "desktop" is managed exclusively by the Electron application`。
- 卸载：`dsh plugin --profile <profile> remove dsh-permission-panel`，会同时从 `dsh.profile.bundles` 摘掉。
- 装完重启对应的 DSH（Desktop 直接重启应用；Web 重新启动 `dsh web`），即可在 **设置 → 插件** 看到「权限面板」与「工作区权限」两页，在 **设置 → 快捷键** 看到「重启 DSH（权限面板）」一行。

### 可安装性说明

- `dsh.client.platform` 固定为 `"web"`：这是唯一合法值（Desktop 自身也声明 `"web"`）。它描述的是浏览器半体的运行环境，与 Web/Desktop 载体无关——双载体支持由运行时识别完成。
- `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**；真实依赖由插件顶层 `inject` 与 `ctx.inject()` 决定。
- `peerDependencies`（`react` / `react-dom`）是可选提示；profile 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），未启用 `engine-strict`，只作提示。

## DSH 0.2.x 兼容面

0.2.1 移除了本插件早期依赖的若干客户端面（`sessions.list` / `workspaces.list` 两个客户端快照、`configForms` / `settingsSchema` 两个设置服务）。当前实现只使用真实存在的面：

| 用途 | 使用的面 |
| --- | --- |
| 枚举会话 | `remote.session.list({})` → `{ items: SessionSummary[] }`（每行自带投影提示） |
| 冷读单会话投影 | `remote.session.projections({ sessionId })` → `{ ok, value }`；value 是 sequenced baseline、migration-required 提示，或 `null` |
| 归档集合与工作区归属 | `remote.workspace.follow(signal)` 流：`baseline` / `replace` 帧同时给出 Workspaces、`archivedSessionIds`、`pinnedSessionIds`；`upsert` / `remove` / `order` 维护工作区列表；`archived` 只更新归档集合 |
| 读写设置 | `remote.settings.describe()`、`remote.settings.mutate(ns, ops, revision)` |
| 预设目录 | `remote.permissionPresets.catalog()` → `{ options, defaultOptions, defaultPreset }` |
| 下发权限命令 | `remote.commands.execute(sessionId, "/permission <preset>", [], signal)` —— **首参是裸 Session id 字符串**，不是 `{ id }` 对象 |

实现上有三个容易踩空的地方，值得使用同类 API 的人注意：

- **嵌套命名空间逐个门控**：`ctx.remote` 是一个服务，`remote.session` / `remote.settings` / `remote.permissionPresets` / `remote.workspace` / `remote.commands` 各自是独立注册的服务。只声明 `remote` **不覆盖**子命名空间，读取会抛 `cannot get property "remote.workspace" without inject`。因此每个用到的 `remote.<ns>` 都在 `inject` 数组里单独列一条；`test/host-api.cjs` 会静态扫描活跃代码并逐条校验。
- **硬门控 vs 软门控**：`inject` 数组里的名字是硬要求，服务缺失会让插件永远停在 PENDING；嵌套的 `ctx.inject([...], …)` 是软要求，回调不执行，只有依赖它的功能降级。因此 `shortcuts` 这类可选服务一律走软门控；归档集合读不到时失败开放为**空集合**（多显示一行归档会话无害，少显示一行正常会话才是 bug），工作区流断开时 `sessionCatalog.workspaces` 保持空数组、面板退化为平铺列表，行不会消失。
- **`catalog.options` 与 `catalog.defaultOptions` 是两个字段**：前者是当前全部可选预设（含仅当前会话可用的 `auto`），后者才是可作为新会话默认的子集。默认权限那一行读后者；两者混淆会让下拉里出现不能当默认的值。

## 开发与测试

```bash
npm test   # 无外部依赖：键位审计 / 词典 / 宿主 API / 迁移兼容 / 面板渲染 / 双载体 / 定位 / 筛选
```

- **`test/binding-audit.cjs`** — 键位审计。官方 `shortcuts.register()` 会一次性校验**全部** `runtime:platform` 档位，任一档位触发保留键、Web 不合法组合或与其它命令默认值重叠都会抛错，而该异常会穿过 `ctx.effect` 直接让插件激活失败。本套件复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，断言所有「命令 × 档位」组合合法且与官方核心默认值零冲突，并带**反向对照**（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须被判非法），确保审计本身不是空转。
- **`test/dictionaries.cjs`** — 词典完整性。`zh` / `en` 键集完全一致、代码里每个字面量 `t("key")` 都存在。宿主本地化**不跨命名空间回退**，缺键会把原始键名直接显示给用户。
- **`test/host-api.cjs`** — 宿主 API 兼容。剥掉注释后只查活跃代码：断言不再出现已移除的 `settingsScope`、客户端 `sessions.list` 与 `workspaces.list` 快照，也不再从 `permissions` 投影读 `options`；断言每个 `remote.<ns>` 读取都在 `inject` 声明过；断言 `workspaces` / `shortcuts` / `sessions` **不在**硬门控数组里；断言面板确实使用 `remote.session.list`、`remote.session.projections`、`remote.workspace.follow`，并断言 `commands.execute` 的首参是裸 Session id。
- **`test/legacy-model-search.cjs`** — 迁移兼容。真实加载 `client.js`、渲染设置页、按行定位开关并调用其 `onChange`，断言偏好文档里的 `modelSearch` 字段在每次整份重写后都完好保留。
- **`test/smoke.cjs`** — 面板渲染与交互。夹具是 `remote.session.list` 返回的行与 `remote.workspace.follow` 的 baseline（两个正常工作的工作区 + 一个只有归档成员、故不显示组头的工作区）；断言行内下拉没有被禁用、点击后按会话 id 下发 `/permission`、默认权限写入携带 revision、批量只作用于勾选行、归档会话不出现且跳过数被报告；并覆盖默认折叠与展开/折叠全部、分组、搜索、搜索下全选只覆盖可见行、折叠组保留已选并显示计数、当前会话卡片（强制冷读宿主投影、显示 catalog 原文说明）。`remote.session.projections` 的桩按会话 id 应答并由 `commands.execute` 同步更新，因此「读回宿主真值」与「回显自己刚写的记录」是两件可区分的事。
- **`test/platform.cjs`** — 双载体回归。以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，断言插件不安装自己的全局 `keydown` 监听、命令已贡献给官方服务、Desktop-only 命令不含任何 Web 档位默认值且在 Web 下 `resolve` 返回 `blocked`；并在**完全不提供 `workspaces`** 的载体上再加载一次，验证软门控缺失时插件仍能激活。
- **`test/locate.cjs`** — 定位按钮。渲染会话头入口，断言按钮只在有当前会话时出现；点击后只展开当前会话所属的那个工作区分组（无关分组保持折叠）、`scrollIntoView({block:"center",behavior:"smooth"})` 恰好指向该行并短暂加高亮 class；搜索词遮住该行时不误报「会话不在」而是清空搜索词后找到它；权限筛选遮住该行时同样先清筛选再定位；会话确实不在列表（归档）时才出 `problem` 提示且不滚动。
- **`test/filter.cjs`** — 权限等级筛选。断言 chip 由实际出现的等级推导（只有三档的部署不长出「自动」格）、每个 chip 带正确命中数、选「完全权限」只剩该等级行并显示「匹配 N / 总数」、选「全部」恢复、搜索与筛选叠加为空时显示筛选空态（纯搜索为空显示搜索空态）。

测试里的关键断言都做过**变异回退验证**：把实现改坏，用例必须真的失败。没被变异测试验证过的断言，就只是一句注释。

## 工具

```bash
node tools/verify-profile.cjs <profile>       # 插件确实作为一行进了组合树
node tools/verify-coexistence.cjs <profile>   # 与滑块插件共存、模型席位只有一个主人
node tools/probe-inject.cjs                   # 用真实 cordis 复现嵌套命名空间门控语义
node tools/mutate.cjs client.js .mut.js '<原文>' '<替换文本>'   # 变异测试
```

- `verify-profile.cjs` 用真实 `dsh --profile <name> --dump-config` 组合出完整 loader 树（不启动应用），断言包确实被 profile 挂载、`exports["./client"]` 可解析。
- `probe-inject.cjs` 把网关的注册方式如实复刻：它打印 10 个场景的实测结果，其中「父层只声明 `remote.settings`、嵌套作用域读 `remote.permissionPresets`」一例会抛 `cannot get property "remote.permissionPresets" without inject`——这正是面板早期「半个功能坏掉」的成因。
- `mutate.cjs` 按字面量替换生成变异副本（不做替换就报错退出），用来验证某条断言真的能抓到它声称防住的缺陷。
- `release.cjs` 见下节。

工具通过 `tools/dsh-install.cjs` 定位 DSH 安装目录：默认取各平台的标准安装路径，可用环境变量 `DSH_INSTALL_DIR` 覆盖。注意 DSH 自己也用 `DSH_HOME` 这个名字，但指的是用户 profile 目录，不是安装目录。

## 发布

发版以 **git tag 为准**，不从分支自动发：tag 是不可变的快照，事后能回答「npm 上那个 3.2.0 到底是哪份代码」。落在分支上的自动发布会让每个普通提交都变成一个版本号。

```bash
# 1) 本地：改版本号 + 跑全套测试 + 提交 + 打 tag
npm run release patch        # 3.2.0 -> 3.2.1；也接受 minor / major / 3.4.1
#    工作树必须干净、当前必须在 master、且不能落后 origin/master，
#    否则脚本会在改动任何文件之前停下。

# 2) 推送，触发 CI
git push origin master --follow-tags
```

推上去之后 `.github/workflows/release.yml` 会：

1. 再跑一遍 `npm test`（tag 指向的代码必须自己是绿的）；
2. 确认 CI 里的 npm CLI ≥ 11.5.1（Trusted Publishing 的下限，旧版会静默退回 token 认证然后失败）；
3. 校验 tag 与 `package.json` 的 `version` 是同一个数字——对不上就失败，因为 npm 不允许覆盖已发布版本；
4. 用 **Trusted Publishing (OIDC)** 执行 `npm publish --access public`，provenance 证明自动附带；
5. `gh release create <tag> --generate-notes`。

任一步失败，后面的步骤不会执行，所以不会出现「npm 有了但 GitHub 没有」这种半截状态。

### 发布凭据：Trusted Publishing，没有长期密钥

发布**不使用任何 npm token**。仓库里没有 `NPM_TOKEN`，CI 里也没有 `NODE_AUTH_TOKEN`；凭据来自 GitHub Actions 的 OIDC：每次发布会由 GitHub 签发一张短期、绑定「本仓库 + 本工作流 + `release.yml`」的一次性 token，npm 侧用事先登记的 trusted publisher 关系验证它。

代价是需要在 npm 网站手工登记一次（这一步必须由账号本人在浏览器里做，带 2FA，任何 API token 都改不了这个设置）：

1. 打开 <https://www.npmjs.com/package/dsh-permission-panel/access>
2. 找到 **Trusted Publisher** → **Select your publisher** → **GitHub Actions**
3. 填三项：
   - **Organization or user**：`kirito787-neet`
   - **Repository**：`dsh-permission-panel`
   - **Workflow filename**：`release.yml`（只填文件名，不要带 `.github/workflows/` 前缀）
4. **Allowed actions** 勾上 **npm publish**（这一项不勾，OIDC 身份只能做 stage publish，正式发布会 403）
5. 保存

两个容易踩的坑：

- **配置有 2 天有效期**：新建的 trusted publisher 必须在 2 天内成功发布一次，才算验证通过并绑定到仓库的不可变身份；超时会过期作废，只能删掉重建。
- **`Environment name` 留空**：本工作流没有用 GitHub Environments，填了会导致 OIDC 声明的 `sub` 对不上。

登记完成后，本项目的发版就变成纯 OIDC：

```bash
npm run release patch          # 本地改版本 + 跑测试 + 提交 + 打 tag
git push origin master --follow-tags   # CI 用 OIDC 发布
```

如果 `npm publish` 报 `404` / `401` / `EOTP`，九成是上面那一步没登记或登记错了（工作流会把该填的三项直接打印到日志里）。手动补发某个已存在的 tag：`gh workflow run release -f tag=v3.2.0`。

**仓库写权限**：创建 Release 用的是自动注入的 `GITHUB_TOKEN`，工作流已声明 `permissions: contents: write`，不需要额外配置。

> 想更严格，可以在 npm 包的 **Settings → Publishing access** 里选「Require two-factor authentication and disallow tokens」：这会禁掉所有传统 token 的发布权限，而 OIDC trusted publisher 不受影响。本仓库已经没有 token 了，所以这一项只是加一道保险。
>
> Trusted Publishing 要求 npm CLI ≥ 11.5.1、Node ≥ 22.14.0；本仓库的 `engines` 是 `^22.19.0 || >=24.0.0`，CI 用 Node 24，都满足。

### 为什么发版脚本不直接 `npm publish`

发布凭据只该存在一个地方——CI 由 OIDC 现签发，本地不留任何东西。本机装插件用 `dsh plugin add` 或 `npm pack` 都行，不需要发布权限。

## 设计取舍与边界

- **按工作区分组，而不是按目录**：`workspace.sessionIds` 是注册表声明的归属关系，`cwd` 只是会话跑过的路径；按目录分组会把「在 A 目录启动、但归档到 B 工作区」的会话放到错误的标题下，而那个位置上的批量操作会打错人。
- **默认折叠，但搜索时强制展开**：工作区多的时候，一屏几十行反而看不见结构。折叠是默认视图，不是数据过滤——搜索命中必须可见，折叠组的已选数量必须可见，展开/折叠全部必须一键可达。
- **选择范围永远等于可见范围**：搜索、归档、投影失败都会让行消失，批量条上的数字必须随之收缩。折叠是例外，它只收起视线、不丢数据，但全局全选也只覆盖展开中的行。
- **「实际生效」只能来自宿主，不能来自插件自己**：面板切换成功后写回的行值只是面板**自己的记录**，不能拿它证明宿主在按什么策略执行。所以当前会话卡片走强制冷读，并且切换之后再读一次。
- **读投影不等于开会话**：`retain()` 会实体化 scope 并打开历史；列表型功能必须用 `projections` 冷读，否则「看一眼所有会话的权限」会变成「把所有会话都打开一遍」。
- **按 id 下发命令，不要先拿 binding**：`sessions.binding(id)` 只返回已存在的 scope、从不创建；`remote.commands.execute(sessionId, …)` 走宿主按需恢复，未打开的会话是完全合法的目标。
- **载体识别每次调用即时探测**，不在激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- **Desktop 专有命令在 Web 下是「不声明默认键位 + `resolve` 拒绝」**，而不是渲染成灰色行：置灰会暗示别的含义，而这里缺的是宿主能力，不是用户权限。
- **迁移待办会话（`migration-required`）**：宿主此时可能只给缓存里的部分投影键，其中也许没有 `permissions`。面板把这类行保留为不可用（fail-open），不会因为读不到就把会话从列表里藏掉。
- **探测失败不静默**：面板侧的服务探测失败会打 `console.error` 并写入全局诊断槽，把「面板莫名空白」变成一行可读答案。

## 迁移与兼容契约

- **从 `dsh-hotkey-toolkit` 改名而来**：包名、Loader 行 id、客户端模块 id、字典命名空间、`settings.section` 行 id、快捷键命令 id 全部改为 `dsh-permission-panel` / `permissionPanel.*`。profile 里若还留着旧包，先 `dsh plugin --profile <profile> remove dsh-hotkey-toolkit` 再装新包，避免两行同时挂载、两个设置页同时出现。
- **`modelSearch` 只写不读地透传**：可搜索的模型菜单已迁到 [dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider)——两个插件注册的都是 `conversation.input.model` 这一格位，而槽位对遮蔽型席位是「单选」语义，同时注册只会互相遮蔽，胜负取决于加载顺序。本插件的偏好文档仍保留 `modelSearch` 字段但不再读取。之所以必须保留：`update()` 每次都用整份快照重写文档，若顺手丢掉该字段，用户下一次拨动任意快捷键开关就会把旧选择抹掉，而滑块插件那时未必已经读过它。`test/legacy-model-search.cjs` 守着这条契约。
- **旧版载荷容忍**：更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段；`shortcuts` 逐键合并，缺失的键取默认（开）；非布尔的脏值不会被带进后续写入。

## 版本

当前 **3.3.0**。3.x 的主要节点：3.0.x 修掉了归档流锁死刷新、嵌套命名空间注入缺失、冷读失败静默丢弃、`agentId` wire 形状、切换后不回写等一批真实缺陷；3.1.0 增加了搜索、两级全选、按工作区分组与当前会话策略卡片；3.2.0 把工作区分组改为**默认折叠**并补上展开/折叠全部、折叠组已选计数；3.3.0 增加了**按权限等级筛选**（四档预设 + 全部 / 未知，带命中数）与**定位当前会话**按钮（展开所属工作区分组、滚动居中并短暂高亮）。

更早的历史记录可以在 git 提交里查到——本 README 不再逐版本罗列缺陷清单。

## AI 生成声明

本项目的代码、测试、文档、提交信息等全部产物均由 AI 生成，作者只提供想法、方向与验收标准。AI 生成的内容可能包含错误、遗漏或不适用于你的环境的假设；请把它当作**需要你自己复核的草稿**，而不是权威实现。

## 免责声明

**本项目仅供个人学习和研究使用。**

- 本项目与 DeepSeek 官方无关，不是官方产品，也不受官方支持。
- 软件按「现状」提供，不附带任何明示或暗示的担保，包括但不限于适销性、特定用途适用性与非侵权担保。
- 使用本软件造成的任何直接或间接后果（包括但不限于权限配置错误、数据丢失、系统损坏）由使用者自行承担。
- 请勿将本项目用于任何违反当地法律法规或服务条款的用途。

## License

[MIT](./LICENSE)
