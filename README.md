# dsh-permission-panel

DSH（DeepSeek Harness）的**工作区权限面板**：把每个会话的权限预设、新会话默认权限和归档状态收进一个可以搜索、可以分组、可以批量修改的列表。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

插件本身**不存储任何权限状态**：会话权限读自宿主投影、写经宿主原生的 `/permission <preset>` 命令；新会话默认权限写在宿主的 `permission` 设置命名空间里。

> 本项目的代码、测试、文档与提交信息等产物均由 AI 生成，作者只提供想法与方向。详见文末 [AI 生成声明](#ai-生成声明) 与 [免责声明](#免责声明)。

## 功能

### 两个入口

- **会话头部「权限」按钮**：挂在 `conversation.session.header.utilities` 槽位上，**独立注册**（list 槽位新增一格，不替换任何官方控件），点开即在当前窗口弹出同一份面板。省掉「设置 → 插件 → 工作区权限」三步。
- **设置 → 插件 → 工作区权限**：完整页面。

两处共享同一个组件与同一份模块级状态，看到的会话数据不可能不一致。

### 权限列表

- **每个会话一行**：彩色首字头像、会话标题、工作目录；运行中的会话带绿点。子代理会话不列入。
- **按工作区分组，默认折叠**：归属关系取自 `workspace.sessionIds`（Workspace 注册表声明的成员关系），**不是按 `cwd` 猜**——`cwd` 只是这个会话跑过的路径。组头显示工作区名、路径、成员数与已选数量，可单独折叠；不属于任何工作区的会话落入末尾「未分组」桶；没有可管理会话的空工作区不显示，另在底部注明隐藏数量。工具栏有「展开全部 / 折叠全部」。
- **搜索**：按子串匹配会话标题、工作目录、工作区名与路径，大小写不敏感；实时显示「匹配 N / 总数」。**有搜索词时所有分组强制展开**——折叠状态下藏起匹配项会被读成「没有结果」。
- **按权限等级筛选**：工具栏一排 chip，按实际存在的权限等级收窄列表——固定的「全部」，加上真实出现过的「仅可查看 / 工作区内修改 / 完全权限 / 自动」，以及收纳 `null`、`custom` 与部署自定义值的「未知/自定义」。每个 chip 带命中数（取搜索后的结果）。chip 集合由**实际数据**推导，只发三档预设的部署不会长出「自动」这一格。与搜索是「与」关系。
- **定位当前会话**：会话头入口里多一个按钮。点击后自动清掉会遮住它的搜索词与权限筛选、展开它所在的工作区分组，然后把它那一行滚动到视口中央并短暂高亮 1.6 秒。归属判断走**未过滤**的完整列表，所以「搜索/筛选把它挡住了」绝不会被误报成「会话不在了」。
- **两级全选**：全局「全选」与每个工作区组头的「全选」各管一层，部分选中呈现半选态（`indeterminate` + `aria-checked="mixed"`）。全局全选只作用于**当前展开且可见**的可管理行。
- **过滤即收窄选择**：被搜索隐藏的行会从已选中集合中移除——「选择范围永远等于可见范围」。
- **折叠不等于过滤**：折叠只收起视线，**不会**清空该组已勾好的选择，组头会显示「已选 N」。
- **右侧预设下拉**：仅可查看 / 工作区内修改 / 完全权限，带彩色预设标记与选中勾。切换通过宿主原生命令**按会话 id** 下发，立即生效。
- **新会话默认权限**：候选项取自 `catalog.defaultOptions`，当前值取自 `permission` 命名空间的 `defaultPreset`；写入走一次 settings mutation 并携带 revision 做乐观并发校验。**只影响之后新建的会话**。
- **完全权限确认**：切到 `danger-full-access` 前弹出居中模态（Portal 到 `<body>`），必须勾选风险确认才能继续；支持 `Esc` 与点击遮罩取消。批量切换**整批只确认一次**。
- **批量修改**：勾选后出现批量条（已选数量 + 预设选择器 + 应用到所选 / 清除选择）。逐条顺序下发而非并发，部分成功按部分成功汇报，失败原因点名到会话（最多列 5 条）。
- **只有能真正改动的行才有勾选框**：给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择。
- **归档会话不出现**，并在卡片底部注明跳过了几个——归档意味着会话已结束，宿主自身的归档闸门会拒绝为它执行模型步骤。
- **手动刷新**：重新读取 `remote.session.list`，并把没有投影提示的行重新排入冷读队列。
- **补读投影**：列表只带宿主已推过来的投影，从没打开过的会话通常没有 `permissions` 键。面板对该会话做一次冷读（`remote.session.projections`，宿主由 `observeSession` 应答，**不激活 Agent**）。刻意**不用 `retain()`**：那会实体化客户端 scope 并打开历史。
- **读取状态分档**：每行带一个状态（待读 / 读取中 / 已读 / 空 / 失败），下拉在占位时分别显示对应说明。冷读结果**权威覆盖**旧值——这是别处改过权限后唯一能同步到面板的路径。

### 当前会话实际生效策略

面板顶部的一张卡片，显示当前会话标题、**宿主冷读回来的**预设值，以及宿主 catalog 里该预设的原文说明。`custom` 派生态显示为「自定义」。每次打开面板强制冷读一次，切换成功后再读一次确认，另有「重新读取」按钮。

两个刻意的约束：**卡片只出现在会话头部入口**（设置页没有会话上下文，DSH 0.2.1 也没有受支持的客户端接口能回答「主视图里是哪个会话」，所以设置页不猜）；**策略说明只引用宿主原话**（`permissions` 投影的 wire 形状只有 `{ currentValue }`，沙箱模式没有 wire、审批策略没有投影，任何「从预设名反推」的实现都只是在编）。

### 快捷键

只贡献**一个**命令，注册进官方快捷键服务，直接出现在 **设置 → 快捷键** 里，与官方命令共用同一套录制、改绑、恢复默认与冲突检测。

| 命令 | 默认键位 | 载体 |
| --- | --- | --- |
| 重启 DSH（权限面板） | `Ctrl+Shift+R`（macOS `Cmd+Shift+R`） | 仅 Desktop |

- 命令 id 为 `permissionPanel.restart`。官方注册器**不校验** id 语法，但持久化层校验：语法错误的 id 会先注册成功，再在用户第一次编辑时让整份快捷键文档被判为 `invalid`，把设置界面变成只读——所以加载期用官方 `commandPattern` 自校验。
- 键位只声明 Desktop 档位（`desktop:macos|windows|linux`）：浏览器载体没有应用可重启。Web 下 `resolve` 返回 `blocked`，也不会向不存在的 `/api/desktop/*` 端点发请求。
- 执行路径：优先 Electron preload 桥 `window.dshDesktopActions.invoke("restart")`，否则回退 `POST /api/desktop/restart`。
- 注册包在 `try/catch` 里：注册失败只退化为「没有快捷键」，不会让插件激活失败。
- 快捷键的持久化**不在插件里**：宿主偏好文档是唯一真相（Web `dsh.keybindings.v1`，Desktop `userData/keybindings.json`）。

**快捷键开关**（设置 → 插件 → 权限面板）拦的是**动作**，不是绑定：停用后命令仍留在官方快捷键列表中，键位、冲突检测、录制结果都不受影响，只是按下时不执行；停用返回 `pass` 而不是 `blocked`，避免一个被停用的快捷键吞掉用户真正想按的组合。

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
dsh plugin --profile <profile> add dsh-permission-panel@3.3.0
```

- `--profile` 是必填项，没有默认 profile。
- `--profile desktop` **只被 DSH Desktop 自带的 `dsh` 接受**：普通 `@deepseek-ai/dsh` 会报 `profile "desktop" is managed exclusively by the Electron application`。
- 卸载：`dsh plugin --profile <profile> remove dsh-permission-panel`，会同时从 `dsh.profile.bundles` 摘掉。
- 装完重启对应的 DSH（Desktop 重启应用；Web 重启 `dsh web`），即可在 **设置 → 插件** 看到「权限面板」与「工作区权限」两页，在 **设置 → 快捷键** 看到「重启 DSH（权限面板）」一行。

### 可安装性说明

- `dsh.client.platform` 固定为 `"web"`：这是唯一合法值（Desktop 自身也声明 `"web"`），描述浏览器半体的运行环境，与 Web/Desktop 载体无关。
- `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**；真实依赖由插件顶层 `inject` 与 `ctx.inject()` 决定。
- `peerDependencies`（`react` / `react-dom`）是可选提示；profile 默认 `autoInstallPeers: false`，宿主已自带 React 18。
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

三个容易踩空的地方：

- **嵌套命名空间逐个门控**：`ctx.remote` 是一个服务，`remote.session` / `remote.settings` / `remote.permissionPresets` / `remote.workspace` / `remote.commands` 各自独立注册。只声明 `remote` **不覆盖**子命名空间，读取会抛 `cannot get property "remote.workspace" without inject`。因此每个用到的 `remote.<ns>` 都在 `inject` 数组里单独列一条；`test/host-api.cjs` 会静态扫描活跃代码逐条校验。
- **硬门控 vs 软门控**：`inject` 数组里的名字是硬要求，服务缺失会让插件永远停在 PENDING；嵌套的 `ctx.inject([...], …)` 是软要求，只有依赖它的功能降级。因此 `shortcuts` 这类可选服务一律走软门控；归档集合读不到时失败开放为**空集合**，工作区流断开时面板退化为平铺列表，行不会消失。
- **`catalog.options` 与 `catalog.defaultOptions` 是两个字段**：前者是当前全部可选预设（含仅当前会话可用的 `auto`），后者才是可作为新会话默认的子集。默认权限那一行读后者。

## 开发与测试

```bash
npm test   # 无外部依赖，纯 Node 内置模块
```

| 测试 | 覆盖 |
| --- | --- |
| `test/binding-audit.cjs` | 键位审计。复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，断言所有「命令 × 档位」组合合法且与官方核心默认值零冲突，并带反向对照（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须判非法） |
| `test/dictionaries.cjs` | 词典完整性。`zh` / `en` 键集完全一致、每个字面量 `t("key")` 都存在（宿主本地化不跨命名空间回退，缺键会把原始键名显示给用户） |
| `test/host-api.cjs` | 宿主 API 兼容。剥掉注释后只查活跃代码：不出现已移除的面、每个 `remote.<ns>` 都在 `inject` 声明过、`workspaces` / `shortcuts` / `sessions` **不在**硬门控数组里、`commands.execute` 首参是裸 Session id |
| `test/legacy-model-search.cjs` | 迁移兼容。真实加载 `client.js`、渲染设置页、按行调用 `onChange`，断言偏好文档里的 `modelSearch` 字段在每次整份重写后都完好保留 |
| `test/smoke.cjs` | 面板渲染与交互。夹具覆盖正常/归档工作区；断言行内下拉、按会话 id 下发 `/permission`、默认权限写入携带 revision、批量只作用于勾选行、归档会话不出现且跳过数被报告，以及折叠、分组、搜索、当前会话卡片 |
| `test/platform.cjs` | 双载体回归。以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，断言不装全局 `keydown`、Desktop-only 命令在 Web 下 `resolve` 返回 `blocked`，并在完全没有 `workspaces` 时仍能激活 |
| `test/locate.cjs` | 定位按钮。断言按钮只在有当前会话时出现、只展开所属分组、`scrollIntoView({block:"center",behavior:"smooth"})` 恰好指向该行；搜索/筛选遮住该行时先清掉再定位；确实不在列表时才出提示 |
| `test/filter.cjs` | 权限等级筛选。断言 chip 由实际等级推导、命中数正确、选「完全权限」只剩该等级行、搜索与筛选叠加为空时显示筛选空态 |

测试里的关键断言都做过**变异回退验证**：把实现改坏，用例必须真的失败。没被变异测试验证过的断言，就只是一句注释。

## 工具

```bash
node tools/verify-profile.cjs <profile>       # 插件确实作为一行进了组合树
node tools/verify-coexistence.cjs <profile>   # 与滑块插件共存、模型席位只有一个主人
node tools/probe-inject.cjs                   # 用真实 cordis 复现嵌套命名空间门控语义
node tools/mutate.cjs client.js .mut.js '<原文>' '<替换文本>'   # 变异测试
```

工具通过 `tools/dsh-install.cjs` 定位 DSH 安装目录：默认取各平台标准安装路径，可用 `DSH_INSTALL_DIR` 覆盖。注意 DSH 自己也用 `DSH_HOME`，但那指的是用户 profile 目录，不是安装目录。

## 发布

> 这一节是给**维护者**看的。只是想用插件的话，`dsh plugin --profile <profile> add dsh-permission-panel` 就够了。

发版以 **git tag 为准**，不从分支自动发：tag 是不可变的快照，事后能回答「npm 上那个版本到底是哪份代码」。发布用 **Trusted Publishing (OIDC)**，仓库里没有任何 npm 长期密钥。

```bash
npm run release patch        # 改版本号 → 跑测试 → 核对包内容 → 提交 → 打 tag
git push origin master --follow-tags
```

CI 会重跑 `npm test` 与 `npm pack --dry-run`、校验 tag 与 `package.json` 版本一致、用 OIDC 发布、回读 npm 核验 `version` 与 `dist.tarball`，最后建 GitHub Release；任一步失败后续不执行，所以不会出现「GitHub 上有版本、npm 上没有」的假象。

- **完整流程、trusted publisher 的一次性登记（含三个坑）、发布后验收、失败恢复**：见 [docs/RELEASING.md](docs/RELEASING.md)
- **改动前必读的规则**（分支、提交规范、检查命令、不许手动 `npm publish`）：见 [AGENTS.md](AGENTS.md)

## 设计取舍与边界

- **按工作区分组，而不是按目录**：`workspace.sessionIds` 是注册表声明的归属关系，`cwd` 只是会话跑过的路径；按目录分组会把「在 A 目录启动、归档到 B 工作区」的会话放到错误的标题下，而那个位置上的批量操作会打错人。
- **默认折叠，但搜索时强制展开**：工作区多时一屏几十行反而看不见结构。折叠是默认视图，不是数据过滤——搜索命中必须可见，折叠组的已选数量必须可见。
- **选择范围永远等于可见范围**：搜索、归档、投影失败都会让行消失，批量条上的数字必须随之收缩；折叠是例外，它只收起视线、不丢数据，但全局全选也只覆盖展开中的行。
- **「实际生效」只能来自宿主**：面板切换成功后写回的行值只是面板自己的记录，不能证明宿主在按什么策略执行，所以当前会话卡片走强制冷读并在切换后再读一次。
- **读投影不等于开会话**：`retain()` 会实体化 scope 并打开历史；列表型功能必须用 `projections` 冷读。
- **按 id 下发命令，不要先拿 binding**：`sessions.binding(id)` 只返回已存在的 scope、从不创建；`remote.commands.execute(sessionId, …)` 走宿主按需恢复，未打开的会话是合法目标。
- **载体识别每次调用即时探测**，不在激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- **Desktop 专有命令在 Web 下是「不声明默认键位 + `resolve` 拒绝」**，而不是渲染成灰色行：这里缺的是宿主能力，不是用户权限。
- **迁移待办会话（`migration-required`）**：宿主此时可能只给缓存里的部分投影键，面板把这类行保留为不可用（fail-open），不会因为读不到就把会话藏掉。
- **探测失败不静默**：面板侧的服务探测失败会打 `console.error` 并写入全局诊断槽，把「面板莫名空白」变成一行可读答案。

## 迁移与兼容契约

- **从 `dsh-hotkey-toolkit` 改名而来**：包名、Loader 行 id、客户端模块 id、字典命名空间、`settings.section` 行 id、快捷键命令 id 全部改为 `dsh-permission-panel` / `permissionPanel.*`。profile 里若还留着旧包，先 `dsh plugin --profile <profile> remove dsh-hotkey-toolkit` 再装新包，避免两行同时挂载、两个设置页同时出现。
- **`modelSearch` 只写不读地透传**：可搜索的模型菜单已迁到 [dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider)——两个插件注册的都是 `conversation.input.model` 这一格位，槽位对遮蔽型席位是单选语义，同时注册只会互相遮蔽。本插件的偏好文档仍保留 `modelSearch` 字段但不再读取：`update()` 每次都用整份快照重写文档，顺手丢掉该字段会抹掉用户旧选择。`test/legacy-model-search.cjs` 守着这条契约。
- **旧版载荷容忍**：更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段；`shortcuts` 逐键合并，缺失的键取默认（开）；非布尔的脏值不会被带进后续写入。

## 版本

当前 **3.3.0**。3.x 主要节点：3.0.x 修掉归档流锁死刷新、嵌套命名空间注入缺失、冷读失败静默丢弃、`agentId` wire 形状、切换后不回写等一批缺陷；3.1.0 增加搜索、两级全选、按工作区分组与当前会话策略卡片；3.2.0 把工作区分组改为**默认折叠**并补上展开/折叠全部与折叠组已选计数；3.3.0 增加**按权限等级筛选**与**定位当前会话**按钮。

更早的记录可在 git 提交里查到。

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
