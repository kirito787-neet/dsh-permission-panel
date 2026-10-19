# dsh-permission-panel

DSH 的**工作区权限面板**，外加唯一一个官方快捷键：**重启 DSH**。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

插件不存储任何权限状态：会话权限读自宿主投影、写经宿主的 `/permission` 命令；新会话默认权限写在宿主的 `permission` 设置命名空间里。

## 工作区权限面板

入口有二：

- **会话头部「权限」按钮**（每次一个会话都可见）：点击后直接在当前窗口弹出面板，不必绕道设置。这是 `conversation.session.header.utilities` 槽位上的一个**独立注册**（自己的 id，list 槽位新增一格，不替换任何官方控件），与设置页共享同一个组件与同一份状态——两处看到的数据不可能不一致。
- **设置 → 插件 → 工作区权限**（原来的完整页面）。

- **每个会话一行**：彩色首字头像、会话标题、工作目录；运行中的会话带绿点，「当前」会话带标记；子代理会话不列入。
- **右侧预设下拉**：仅可查看 / 工作区内修改 / 完全权限，带彩色预设标记与选中勾。切换通过宿主原生 `/permission <preset>` 命令**按会话 id** 下发，立即生效。
- **新会话默认权限**：卡片顶部一行，候选项取自 `catalog.defaultOptions`（可作默认的预设子集），当前值取自 `permission` 命名空间的 `defaultPreset`；写入走一次 settings mutation 并携带 revision 做乐观并发校验。**只影响之后新建的会话**，已有会话不受影响。
- **完全权限确认**：切到 `danger-full-access` 前弹出居中模态（Portal 到 `<body>`，不随面板滚动），必须勾选风险确认才能继续；支持 `Esc` 与点击遮罩取消。批量切换**整批只确认一次**——同一个确认问十遍只会训练用户无脑点过。
- **批量修改**：每行左侧勾选框，标题旁的「全选」可一次勾选全部可管理会话；勾选后出现批量条（已选数量 + 预设选择器 + 应用到所选 / 清除选择）。Apply 在未选择预设前保持禁用。逐条下发而非并发（每个会话是一条独立命令，并发推进不了什么，却让「到底哪条失败」无法归因）；部分成功按部分成功汇报，失败原因点名到会话，最多列 5 条，其余折叠计数。
- **只有能真正改动的行才有勾选框**：给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择，数量与结果会对不上。
- **归档会话不出现在列表里**，并在卡片底部注明跳过了几个：归档意味着这个会话已经结束，宿主自身的归档闸门会拒绝为它执行模型步骤，因此在这里给它一个权限开关等于给一个不会起作用的控件；跳过数量明确写出来，因为行突然消失看起来像 bug。
- **手动刷新**：重新读取 `remote.session.list`，并把没有投影提示的行重新排入冷读队列。
- **补读投影**：会话列表只带宿主已经推过来的投影，用户从没打开过的会话通常没有 `permissions` 键。此时面板对该会话做一次冷读（`remote.session.projections`，宿主由 `observeSession` 应答，**不激活 Agent**），读到后行内即显示真实预设。刻意**不用 `retain()`**：那会实体化客户端 scope 并打开历史，为每一行这么做等于把侧栏里所有会话全部打开。补读按 **id 列表 + 各行读取状态**触发——快照标识会因 running 标志、引用计数等无关字段变化，而刷新不会改变 id 集合却会把未读行重置为待读，只看 id 列表会让刷新按钮变成空操作。
- **"不可用"不再是三种处境的同一个答案**：每行带一个读取状态（待读 / 读取中 / 已读 / 空 / 失败），于是下拉在占位时分别显示「读取中…」「该会话无权限投影」「投影读取失败」。把「还没读」「这次部署没装权限服务」「读的时候抛了」压成同一个词，会让人去找一个其实不存在的 bug。冷读结果**权威覆盖**旧值——这是别处改过权限后唯一能同步到面板的路径。

## 快捷键

只贡献**一个**命令，注册进官方快捷键服务，因此直接出现在 **设置 → 快捷键** 里，与官方命令共用同一套录制、改绑、恢复默认与冲突检测。

| 命令 | 默认键位 | 载体 |
| --- | --- | --- |
| 重启 DSH（权限面板） | `Ctrl+Shift+R`（macOS `Cmd+Shift+R`） | 仅 Desktop |

- 命令 id 是 `permissionPanel.restart`，加载期用官方 `commandPattern`（`/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u`）自校验。官方注册器**不校验** id 语法，但持久化层校验：一个语法错误的 id 会先注册成功，再在用户第一次编辑时让整份快捷键文档被判为 `invalid`，把整个设置界面变成只读。这里选择加载时直接报错。
- 键位只声明 Desktop 档位（`desktop:macos|windows|linux`）：浏览器载体没有应用可重启，声明 Web 默认值只会给出一个永远触发不了的键位。Web 下 `resolve` 返回 `blocked`，也不会向不存在的 `/api/desktop/*` 端点发请求。
- 执行路径：优先 Electron preload 桥 `window.dshDesktopActions.invoke("restart")`，否则回退 `POST /api/desktop/restart`。
- 注册包在 `try/catch` 里：注册失败只退化为「没有快捷键」，不会让插件激活失败。
- 快捷键的持久化**不在插件里**：宿主偏好文档是唯一真相（Web `dsh.keybindings.v1`，Desktop `userData/keybindings.json`）。

### 快捷键开关

**设置 → 插件 → 权限面板 → 快捷键开关**，一项开关对应上面那个命令，默认开启。

- 开关拦的是**动作**，不是绑定：停用后命令仍留在官方快捷键列表中，键位、冲突检测、录制结果都不受影响，只是按下时**不执行**。
- 停用返回 `pass` 而**不是** `blocked`：`blocked` 会吞掉按键，那样一个被停用的插件快捷键会挡住用户真正想按的组合。
- 之所以不做「注销命令」：每次注册/注销都会让官方界面里正在编辑的草稿失效，用户录制的组合键也会在停用期间从运行目录里消失。
- 逐键合并存储：某个开关在旧载荷里不存在时取默认值（开），不会因为 `undefined` 而被当成关闭。

### 为什么只剩一个命令

「刷新界面」与官方 `page.refresh` 重复（`Ctrl+R` 已被它占用，Web 变体占用 `Ctrl+Alt+R`），声明同一个键会让官方注册直接抛冲突；三个窗口模式切换属于 Desktop shell 自己的设置页，不该占用一个键盘快捷键。留一个真正只有本插件能做的动作就够了。

## DSH 0.2.x 兼容面

0.2.1 移除了本插件早期依赖的若干客户端面：`sessions.list`、`workspaces.list` 两个客户端快照，以及 `configForms`、`settingsSchema` 两个设置服务。当前实现只使用真实存在的面：

| 用途 | 使用的面 |
| --- | --- |
| 枚举会话 | `remote.session.list({})` → `{ items: SessionSummary[] }`（每行自带投影提示） |
| 冷读单会话投影 | `remote.session.projections({ sessionId })` → `{ ok, value }`；value 是 sequenced baseline、migration-required 提示，或 `null`（会话不存在） |
| 归档集合 | `remote.workspace.follow(signal)` 流，消费 `baseline` / `replace` / `archived` 帧里的 `archivedSessionIds` |
| 读写设置 | `remote.settings.describe()`、`remote.settings.mutate(ns, ops, revision)` |
| 预设目录 | `remote.permissionPresets.catalog()` → `{ options, defaultOptions, defaultPreset }` |
| 下发权限命令 | `remote.commands.execute(sessionId, "/permission <preset>", [], signal)` —— **首参是裸 Session id 字符串**，不是 `{ id }` 对象 |

**嵌套命名空间逐个门控**：`ctx.remote` 是一个服务，而 `remote.session`、`remote.settings`、`remote.permissionPresets`、`remote.workspace`、`remote.commands` 各自是独立注册的服务。只声明 `remote` **不覆盖**子命名空间——读取会抛 `cannot get property "remote.workspace" without inject`。因此每个用到的 `remote.<ns>` 都在 `inject` 数组里单独列一条；`test/host-api.cjs` 静态扫描活跃代码里所有 `remote.<ns>` 读取并逐条校验，漏一个就失败。

**硬门控 vs 软门控**：`inject` 数组里的名字是**硬要求**——服务缺失会让插件永远停在 PENDING；嵌套的 `ctx.inject([...], …)` 是**软要求**——回调不执行，只有依赖它的那个功能降级。因此 `shortcuts`、`sessions` 这类可选服务一律走软门控；归档集合读不到时 `useArchivedIds()` 失败开放为**空集合**（多显示一行归档会话无害，少显示一行正常会话才是 bug）。

**投影只有 `currentValue`**：`permissions` 投影的 wire 形状是 `{ currentValue: string }`，没有 `options` 字段。预设候选项必须来自进程级目录 `catalog`；从投影里读 `permissions.options` 只会得到 `undefined`，于是每行都被判为 `capable: false`。

**`catalog.options` 与 `catalog.defaultOptions` 是两个字段**：前者是当前全部可选预设（含仅当前会话可用的 `auto`），后者才是**可作为新会话默认**的子集。默认权限那一行读后者；两者混淆会让下拉里出现不能当默认的值。

## 3.0.0 修掉的三个缺陷

面板曾经整片显示"不可用"，原因不是一个而是三个，且互相掩盖：

1. **归档流把刷新按钮锁死了**。`loadSessionCatalog()` 里 `await followArchiveSet()` 等待的是一个**永不结束**的 `for await` 流，于是 `finally` 永不执行、`catalogLoading` 永久为 `true`，此后每次点「刷新列表」都被 `if (catalogLoading) return;` 直接短路。改为不 `await`（`followArchiveSet().catch(() => {})`），归档流继续在后台跑。
2. **`inject` 少声明了 `remote.workspace`**。`remote` 是一个服务，`remote.workspace` 是另一个；只写 `remote` 不覆盖子命名空间，读取抛 `cannot get property "remote.workspace" without inject`，而它恰好被 `catch` 静默吞掉——归档集合因此恒为空，已归档会话也会被列出来。现在 `inject` 里逐个列出用到的 `remote.<ns>`。
3. **冷读失败被静默丢弃**。旧实现只在 `preset` 或 `title` **有变化**时才通知订阅者，可是读失败时 `null === null`，行就永远停在 `null`，也就是永远"不可用"，刷新也不会重试。现在每行有独立读取状态，失败与空值都会通知并可在刷新后重试。

顺带修正了默认权限那行的提示：`status === "unavailable"` 时它算出了文案却没渲染（hint 只在 `error` 分支用），现在如实说明「此部署未提供权限设置」。

## 3.0.1 修掉的缺陷：未设置的默认值不等于坏掉的部署

`defaultPreset` 的 schema 是 `z.string().volatile()`——既没有 `.required()` 也没有 `.default()`。而 volatile 设置表单**只投影有值的字段**：用户从没写过默认值时，`settings.describe()` 里那个命名空间是 `{ value: {} }`。

3.0.0 把这种「缺席」当成了「损坏」：`typeof value !== "string"` 直接判失败，于是新会话默认权限那行在**完全健康的部署**上显示「默认权限加载失败：permission settings has no defaultPreset value」。用户看到的正是这句。

修法照官方那行写：`view.value.defaultPreset ?? catalog.defaultPreset`。宿主始终知道**有效默认值**（composition 里的 `presets` 折算出 `defaultPreset` 并随 catalog 发布），它才是这种情形的权威来源。现在只有「命名空间里没写 **且** catalog 也没给出有效值」才算失败，且失败文案会同时点明两处都缺。

## 3.0.2 修掉的缺陷：`agentId` 在 wire 上是字符串

点行内下拉切换会话权限时报 `typert gateway: commands/execute: wire field "agentId" failed boundary validation`。

`commands.execute` 在 TypeScript 里的签名是 `execute(agent: Agent, line, attachments, signal)`，`Agent = { id: SessionId }`——看起来该传对象。但 typert 描述符把这个参数声明为：

```js
scope: { context: "agent", wire: "agentId" },
parameters[0]: {
  name: "agent", wire: "agentId",
  source: "lookup", lookup: "agent",
  codec: { mode: "strict", typeSymbol: "…#SessionId", jsonSchema: { type: "string" } },
}
```

`source: "lookup"` 表示**网关自己按 wire 值解析出 Agent**，调用方只负责送一个 `SessionId` 字符串。送 `{ id }` 会在 handler 之前就被边界校验拒掉。

旧实现写了个「两种形状都试」的循环（`for (const target of [{ id }, id])`）。它不但没用，还把错误变坏：对象形状在任何载体上都不会成功，而 `catch` 里的 `continue` 让第一次失败只留下一条被吞掉的日志，最终报出来的是更晚、更难追的第二条。现在只有一个调用 `execute(id, line, [], signal)`——官方四处调用（`remote.commands.execute(this.sessionId, line, [])` 等）全是裸 id。

顺带修了三处测试桩：它们原先**接受任意形状**，于是看到一次被记录的调用就判定通过，正是这个「宽松的假宿主」让 bug 通过了测试。现在桩会像网关一样拒绝非字符串首参，`test/host-api.cjs` 还会静态断言源码里不出现 `.execute(` 后紧跟 `{`。

## 3.0.3 修掉的三个缺陷：切换算数、错误可读、只读不写

这三个都在「命令已经发出去」之后才暴露，所以此前的测试全绿也发现不了。

1. **切换权限后行上还显示旧预设**。`ensureProjections` 只读 `idle` 行，`adoptSessionItems` 又把带投影提示的行留在 `ready`——于是**没有任何路径**会重看用户刚切换过的会话。命令下发成功、toast 也提示成功，行上却停在旧值，直到刷新页面。现在下发成功后由 `recordSessionPreset()` 把宿主接受的值回写进会话目录（标 `ready` 而非 `idle`：接受值是权威的，每次渲染都重读只会白打宿主）。单行与**批量**两条下发循环各有自己的分支，都要回写——只修单行会让批量报告成功而每行都停在旧值。

2. **RPC 拒绝被拍平成 `[object Object]`**。宿主对失败的应答是 `{ ok: false, error: { code, message, details } }`，不是 `Error` 实例。`describe()` 原来只认 `Error`，其余一律 `String(...)`；目录读取失败、`permissionPanel.fail()` 以及 `wpDefaultFailed` 两条路径都把裸对象交给它，用户于是看到无意义的占位符而不是宿主自己的说明。代码里另有两处早已正确的写法（`new Error(response.error.message)`），现在 `describe()` 与它们一致：带字符串 `message` 的普通对象取出该字段。

3. **`select()` 缺 `!writable` 守卫**。官方那行有 `if (view === undefined || !state.writable || this.saving) return;`。下拉在只读文档上本就禁用，但风险确认闸门是**直接调用** `select()` 的（不能回头再进 `switchSession`，那会把刚确认的闸门重新打开），于是一份锁定的文档会被判成一次注定 `settings/rejected` 的写入，把「没被允许尝试」报成「写入失败」。

测试侧补了 case 13/14/15 与批量回写断言，并对每处修复做了变异回退验证。其中 case 15 抓不住守卫变异（禁用的触发器本身就点不到那个分支），用例注释里如实写明它能证明什么、不能证明什么。另外两处原有测试的缺陷一并修掉：case 9 原先靠「切换后行不更新」这个 bug 才通过（case 8 已把 Session A 切到 Full access），改用 Session B；汇总行原本读的是被后续用例清空过的 recorder，已改为在断言点做快照。

## 会话头部的快捷入口

每次为看一眼权限都要走「设置 → 插件 → 工作区权限」，三步；入口离使用场景太远，是当初设计时没意识到的代价。

修法：在 `conversation.session.header.utilities` 槽位注册一个**独立 id** 的按钮（list 槽位新增一格，不替换 open-in-app / 定时任务任何官方控件），点击后在当前窗口弹出**同一份面板**。弹出层复用 `PermissionsSection` 组件与模块级状态，因此头部弹层与设置页永远一致；再次打开即等于刷新。

两个刻意不做：

1. **不做 `Esc` 关闭**。`test/platform.cjs` 硬断言加载后没有全局 `keydown` 监听，而本插件的卸载路径不保证清理执行——一个关掉面板后仍然活着的监听器正是那条断言要拦的形状。关闭走点击遮罩与关闭按钮，语义同样完整。
2. **不读 `sidebar.settings` 的内部 store 去跳设置分区**。DSH 没有公开的 `openSection` 服务，能「一键跳到设置里那一页」的唯一途径是读别的插件的 store——那是跨包的私有耦合，上游一改就静默失效。自持弹层没有这个依赖。

## 3.0.4 修掉的缺陷：下拉菜单被入口弹窗遮罩盖住

头部快捷弹窗里点开预设下拉，菜单被压在遮罩后面不可见。层级预算在引入入口弹窗时没有同步更新：`.dshk-wpMenu`（2147483002）低于 `.dshk-overlay`（2147483004）。把菜单提到遮罩之上（2147483005）——同一个数字同时服务设置页与头部弹窗两处的下拉，所以一次修正两处生效。

## 安装

`dsh plugin add` 只接受一个精确的包目标（本地路径、tarball、npm 包名走同一条命令）；装完会自动把包写进该 profile 的 `dsh.profile.bundles`。

```bash
# 1) 从本地源码目录安装（开发用，改完即生效）
dsh plugin --profile <profile> add "link:<本仓库绝对路径>"

# 2) 从 tarball 安装（不带源码，最干净）
npm pack
dsh plugin --profile <profile> add "file:<绝对路径>/dsh-permission-panel-<version>.tgz"

# 3) 从 npm 安装（发布后）
dsh plugin --profile <profile> add dsh-permission-panel
```

- `--profile` 是必填项，没有默认 profile。
- `--profile desktop` **只被 DSH Desktop 自带的 `dsh` 接受**：普通 `@deepseek-ai/dsh` 会直接报 `profile "desktop" is managed exclusively by the Electron application`。
- 卸载：`dsh plugin --profile <profile> remove dsh-permission-panel`，会同时从 `dsh.profile.bundles` 摘掉。
- 装完重启对应的 DSH（Desktop 直接重启应用；Web 重新启动 `dsh web`），即可在 `设置 → 插件` 看到「权限面板」与「工作区权限」两页，在 `设置 → 快捷键` 看到「重启 DSH（权限面板）」一行。

### 可安装性

- `dsh.client.platform` 固定为 `"web"`：这是唯一合法值（Desktop 自身也声明 `"web"`）。它描述的是浏览器半体的运行环境，与 Web/Desktop 载体无关——双载体支持由运行时识别完成。
- `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**；真实依赖由插件顶层 `inject` 与 `ctx.inject()` 决定。
- `peerDependencies`（`react` / `react-dom`）是可选提示；profile 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），未启用 `engine-strict`，只作提示。

## 开发与测试

```bash
npm test   # 无外部依赖：键位审计 / 词典 / 宿主 API / 迁移兼容 / 面板渲染 / 双载体
```

- **`test/binding-audit.cjs`** — 键位审计。官方 `shortcuts.register()` 会一次性校验**全部** `runtime:platform` 档位（不只是当前设备），任一档位触发保留键、Web 不合法组合或与其它命令默认值重叠都会**抛错**，而该异常会穿过 `ctx.effect` 直接让插件激活失败。本套件复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，断言所有「命令 × 档位」组合合法且与官方核心默认值零冲突，并带**反向对照**（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须被判非法），确保审计本身不是空转。
- **`test/dictionaries.cjs`** — 词典完整性。`zh` / `en` 键集完全一致、代码里每个字面量 `t("key")` 都存在。宿主本地化**不跨命名空间回退**，缺键会把原始键名直接显示给用户。
- **`test/host-api.cjs`** — 宿主 API 兼容。剥掉注释后只查活跃代码：断言不再出现已移除的 `settingsScope`、客户端 `sessions.list` 与 `workspaces.list` 快照，也不再从 `permissions` 投影读 `options`；断言每个 `remote.<ns>` 读取都在 `inject` 声明过；断言 `workspaces` / `shortcuts` / `sessions` **不在**硬门控数组里；断言面板确实使用 `remote.session.list`、`remote.session.projections`、`remote.workspace.follow`，并断言 `commands.execute` 的首参是裸 Session id（出现对象形状即失败）。行为检查在**两种载体**上、仅用 0.2.1 真实提供的接口激活插件。
- **`test/legacy-model-search.cjs`** — 迁移兼容。真实加载 `client.js`、渲染设置页、按行定位开关并调用其 `onChange`，断言偏好文档里的 `modelSearch` 字段在每次整份重写后都**完好保留**。
- **`test/smoke.cjs`** — 面板渲染与交互。夹具是 `remote.session.list` 返回的行；断言行内下拉**没有被禁用**、点击后按会话 id 下发 `/permission`、默认权限写入携带 revision、批量只作用于勾选行（未勾选行被刻意放在同一预设上，使「忽略选择」必然产生第二条命令）、归档会话不出现且跳过数被报告。
- **`test/platform.cjs`** — 双载体回归。以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，断言插件**不再安装自己的全局 `keydown` 监听**、命令已贡献给官方服务、Desktop-only 命令**不含任何 Web 档位默认值**且在 Web 下 `resolve` 返回 `blocked`；并在**完全不提供 `workspaces`** 的载体上再加载一次，验证软门控缺失时插件仍能激活。

## 工具

```bash
node tools/verify-profile.cjs <profile>       # 插件确实作为一行进了组合树
node tools/verify-coexistence.cjs <profile>   # 与滑块插件共存、模型席位只有一个主人
node tools/probe-inject.cjs                   # 用真实 cordis 复现嵌套命名空间门控语义
node tools/mutate.cjs client.js .mut.js '<原文>' '<替换文本>'   # 变异测试
```

`verify-profile.cjs` 用真实 `dsh --profile <name> --dump-config` 组合出完整 loader 树（不启动应用），断言包确实被 profile 挂载、`exports["./client"]` 可解析——比只看 `package.json` 更有力。

`probe-inject.cjs` 把网关的注册方式如实复刻：`remote` 是一个服务，每个 `remote.<ns>` 是独立注册的服务，读取时按读取方 fiber 的 inject 集合解析。它打印 10 个场景的实测结果，其中「父层只声明 `remote.settings`、嵌套作用域读 `remote.permissionPresets`」一例会抛 `cannot get property "remote.permissionPresets" without inject`——这正是面板早期「半个功能坏掉」的成因，`test/host-api.cjs` 的静态断言就是照着它写的。

`mutate.cjs` 按字面量替换生成变异副本（不做替换就报错退出），用来验证某条断言**真的能抓到**它声称防住的缺陷。没被变异测试验证过的断言，就只是一句注释。

## 迁移与兼容契约

- **从 `dsh-hotkey-toolkit` 改名而来**：包名、Loader 行 id、客户端模块 id、字典命名空间、`settings.section` 行 id、快捷键命令 id 全部改为 `dsh-permission-panel` / `permissionPanel.*`。profile 里若还留着旧包，先 `dsh plugin --profile <profile> remove dsh-hotkey-toolkit` 再装新包，避免两行同时挂载、两个设置页同时出现。
- **`modelSearch` 只写不读地透传**：可搜索的模型菜单已迁到 [dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider)——两个插件注册的都是 `conversation.input.model` 这一格位，而槽位对遮蔽型席位是「单选」语义，同时注册只会互相遮蔽，胜负取决于加载顺序。本插件的偏好文档仍保留 `modelSearch` 字段但不再读取。之所以必须保留：`update()` 每次都用整份快照重写文档，若顺手丢掉该字段，用户下一次拨动任意快捷键开关就会把旧选择抹掉，而滑块插件那时未必已经读过它。
- **旧版载荷容忍**：更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段；`shortcuts` 逐键合并，缺失的键取默认（开）；非布尔的脏值不会被带进后续写入。

## 取舍与边界

- **载体识别每次调用即时探测**，不在激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- **Desktop 专有命令在 Web 下是「不声明默认键位 + `resolve` 拒绝」**，而不是渲染成灰色行：置灰会暗示别的含义，而这里缺的是宿主能力，不是用户权限。
- **读投影不等于开会话**：`retain()` 会实体化 scope 并打开历史；列表型功能必须用 `projections` 冷读，否则「看一眼所有会话的权限」会变成「把所有会话都打开一遍」。
- **按 id 下发命令，不要先拿 binding**：`sessions.binding(id)` 只返回已存在的 scope、从不创建；`remote.commands.execute(sessionId, …)` 走宿主按需恢复，未打开的会话是完全合法的目标。
- **迁移待办会话（`migration-required`）**：宿主此时可能只给缓存里的部分投影键，其中也许没有 `permissions`。面板把这类行保留为不可用（fail-open），不会因为读不到就把会话从列表里藏掉。
- **探测失败不静默**：面板侧的服务探测失败会打 `console.error` 并写入全局诊断槽，把「面板莫名空白」变成一行可读答案。
