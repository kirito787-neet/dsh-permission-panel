# dsh-hotkey-toolkit

DSH 快捷键工具包（官方快捷键体系）+ 工作区权限面板。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

> **2.0 迁移提示**：原先内置的「模型搜索」子插件（遮蔽 `conversation.input.model` 席位的可搜索模型菜单）
> 已**迁出**到 [dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider)。
> 那个插件本来就占着同一个模型席位，两者**无法共存**——同格位只能有一个存活项，两个都注册只会互相遮蔽。
> 迁移后：
> - 搜索框的开关移到**设置 → 通用设置 → 模型搜索框**（滑块插件提供），默认开启；
> - 你原来的开关选择会**被继承**：本插件仍会在自己的偏好文档里保留 `modelSearch` 字段（只写不读），滑块插件首次加载时读它一次，此后各存各的；
> - 本插件不再向模型席位注册任何东西，`设置 → 插件 → 快捷键工具包 → 子插件` 卡片现在只是指向新位置的说明。

## 功能

### 快捷键（已并入官方体系）

快捷键**不再由本插件自绘录制界面**，而是通过官方的 `ctx.shortcuts.register()` 注册进宿主的快捷键服务，
因此它们会直接出现在 **设置 → 快捷键** 里，与官方命令共用同一套：

| 动作 | 默认组合键 | 载体 |
| --- | --- | --- |
| 刷新界面（本插件） | **默认不绑定**（见下） | Web + Desktop |
| 重启 DSH | `Ctrl+Shift+R` | 仅 Desktop |
| 兼容模式 | `Ctrl+Alt+1` | 仅 Desktop |
| 扩展模式 | `Ctrl+Alt+2` | 仅 Desktop |
| 增强模式 | `Ctrl+Alt+3` | 仅 Desktop |

- **录制 / 修改 / 恢复默认**都在官方界面完成，并写入宿主自己的偏好文档
  （Web：localStorage `dsh.keybindings.v1`；Desktop：`userData/keybindings.json`）；
- **统一冲突检测**：与官方命令共用一张键位表，冲突会在官方界面里提示；
- **「刷新界面」默认不绑定**：`Ctrl+R` 已经是官方 `page.refresh`（刷新页面），
  它的 Web 变体占用 `Ctrl+Alt+R`。若本插件也声明同一个键，官方注册会直接抛
  `Conflicting shortcut defaults`，而且两个命令会争抢同一个键。请在上表界面自行指定组合键。
- **重启与模式切换只声明 Desktop 档位**：它们在浏览器里本就没有意义（没有应用可重启、没有窗口模式可切），
  声明 Web 默认值只会给出一个永远无法触发的键位；而且 Web 档位限制很严
  （`web:linux` 只接受 `Mod+/`、`Mod+Shift+,`、`Mod+Shift+.`），
  因此这些动作在 Web 下**不绑定**，而不是绑到一个无效组合上。
- 在浏览器载体下按到「重启 / 模式切换」会被**拒绝**（`blocked`），不会向不存在的端点发请求。

### 快捷键开关（逐个启用 / 停用）

`设置 → 插件 → 快捷键工具包 → 快捷键开关`，**每个快捷键各有一个开关**，默认全部开启：

| 开关 | 对应命令 |
| --- | --- |
| 刷新界面 | `hotkeyToolkit.refresh` |
| 重启 DSH | `hotkeyToolkit.restart` |
| 切换到兼容模式 | `hotkeyToolkit.modeCompatibility` |
| 切换到扩展模式 | `hotkeyToolkit.modeExtended` |
| 切换到增强模式 | `hotkeyToolkit.modeAdvanced` |

- 开关控制的是**动作**，不是绑定：停用后命令仍留在官方快捷键列表中，
  键位、冲突检测、录制结果都不受影响，只是按下时**不执行**；
- 停用返回的是 `pass` 而**不是** `blocked`：`blocked` 会**吞掉**按键，
  那样一个被停用的插件快捷键会挡住用户真正想按的组合；`pass` 把按键留给其它处理者；
- 之所以不做「注销命令」，是因为每次注册/注销都会让官方界面里**正在编辑的草稿失效**，
  并让该命令短暂无法编辑；而用户录制的组合键也会在停用期间从运行目录里消失。
  只拦动作可以保住行、键位与冲突关系。
- 存储为**逐键合并**：某个开关在旧载荷里不存在时取默认值（开），
  不会因为 `undefined` 而被当成关闭。

### 模型搜索（已迁出）

**本插件不再提供模型搜索框**。可搜索的模型菜单现在由
[dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider) 提供，
开关在 **设置 → 通用设置 → 模型搜索框**。

迁出原因不是功能取舍，而是**席位冲突**：两个插件注册的都是 `conversation.input.model` 这一格位，
而槽位运行时的语义是「遮蔽型单选」——动态门面给插件注册的优先级低于所有内置项，
所以谁注册谁赢，同时注册只会互相遮蔽，行为取决于加载顺序。

本插件为此保留的**兼容契约**（`test/legacy-model-search.cjs` 守护）：

- 偏好文档 `dsh.hotkeyToolkit.v1` 里的 `modelSearch` 字段**只写不读**地透传。
  这条不是可有可无：`createConfigStore().update()` 每次都会用整份快照重写文档，
  如果 `normalizeConfig` 在「移除功能」时顺手丢掉这个字段，那么用户**下一次拨动任意快捷键开关**就会把它抹掉——
  而那时滑块插件未必已经加载过，用户当初特意关掉的搜索框就会被悄悄打开；
- 非布尔的脏值不会被带进后续写入；
- 本插件源码中不再有任何 `conversation.input.model` / `modelDirectories` 引用（注释除外）。

搜索框本身的行为（迁出前一致）：进入模型列表自动聚焦、输入即时过滤（按模型名 / ID / 供应商，忽略大小写）、
`Enter` 选中第一个匹配项、`Esc` 先清空再逐级返回、无匹配显示空状态、右侧有清除按钮。

### 工作区权限面板

`设置 → 插件 → 工作区权限`，集中管理**所有会话**的权限：

- 每个会话一行：彩色首字头像 + 会话标题 + 工作目录，运行中的会话带绿点，「当前」会话带标记；
- 右侧自绘下拉切换权限预设（仅可查看 / 工作区内修改 / 完全权限），带彩色预设标记与选中勾，通过宿主自带的 `/permission` 命令下发，实时生效；
- 顶部可修改**新会话的默认权限预设**（写入宿主 `permission` 设置）；
- 切换到「完全权限」前会弹出风险确认，且确认框是**窗口居中的模态框**（Portal 挂到 `<body>` 的固定遮罩层，独立于面板滚动容器），不再渲染在会话列表末尾——列表很长时无需滚到底部；支持 Esc 与点击遮罩关闭；
- 下拉为 Portal 渲染、视口内自动翻转避让，支持点击外部 / Esc 关闭；
- 会话列表支持手动刷新，子会话不出现在列表中；
- **批量修改**：每行左侧勾选框，卡片标题旁的「全选」可一次勾选全部可管理会话；勾选后出现批量操作条，
  显示已选数量、一个预设选择器与「应用到所选 / 清除选择」。**只有能真正改动的行才有勾选框**——
  给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择，数量与结果会对不上。
  Apply 在未选择预设前保持禁用（批量控件不能一上来就处于待发状态，否则一次误点就会改掉一批会话）；
  切到「完全权限」时**整批只确认一次**，而不是每个会话弹一次——同一个确认问十遍只会训练用户无脑点过。
  逐个下发而非并发：每个会话是一条独立的宿主命令，并发推进不了什么，却会让「到底哪条失败」变得无法归因。
  部分成功按部分成功汇报，并把失败原因点名到会话（最多列 5 条，其余折叠计数）——把十次里失败三次说成成功，
  比原来的 bug 更糟：用户会相信一个根本没发生的权限变更；
- **已归档的会话不再出现在列表中**，并在卡片底部注明跳过了几个：归档意味着「这个会话已经结束了」，
  宿主自身的归档闸门会拒绝为它执行模型步骤，因此在这里给它一个权限开关等于给了一个**不会起作用的控件**；
  跳过数量是明确写出来的而不是悄悄省略——行突然消失看起来像 bug，写清楚用户才知道会话还在（在归档里）。

**1.8.0 修复**：此前本面板**完全不可用**，原因有六个，且都是静默失败：

1. 它通过 `ctx.settingsScope` 读取设置面，而该服务在 **DSH 0.1.7 已被移除**
   （改用 `configForms`）。嵌套的 `ctx.inject(['settingsScope'], …)` **既不报错也不会让插件激活失败**——
   回调永远不会执行，于是默认权限单元格一直停在「加载中」，无法写入。
   现已改用受支持的 `remote.settings.describe()` / `mutate()`。
2. 它从会话投影里读取预设**选项**（`projectionValues.permissions.options`），
   但真实的 `PermissionSelection` 只有 `{ currentValue }`，**没有 `options` 字段**。
   于是每行都算出 `capable: false` 并渲染为**禁用**——行在，但永远点不动。
   预设选项现在取自进程级目录 `remote.permissionPresets.catalog()`（官方选择器用的也是它）。
3. 第一轮修复后面板**依旧**不可用：它读 `remote.settings` / `remote.permissionPresets`，
   但 `inject` 里只声明了 `remote`。**嵌套的 remote 命名空间是各自独立门控的**——
   `ctx.remote` 是一个服务，而它下面的每个命名空间都必须用自己的点号名字再声明一次，
   否则 cordis 抛 `cannot get property "remote.settings" without inject`，异常又被面板吞进错误态，
   于是用户看到的还是那个笼统的「不可用」。
4. 「新会话默认权限」下拉只能显示**当前值**，切不动。它从设置 schema 推导候选项，
   而 `defaultPreset` 的真实 schema 是 `z.string().volatile()`——一个**没有枚举的裸字符串**，
   推导结果自然只剩当前值。官方那一行读的是目录里的 `catalog.defaultOptions`，现已改为同一来源
   （并把当前值并入列表，而不是像官方那样在缺失时抛错——抛错会把整个面板打空）。
5. **部分会话显示「不可用」**。会话列表快照只带宿主**已经推过来**的投影（实时控制基线，
   或从持久化检查点读到的列表提示）；用户从没打开过的会话通常两者都没有，于是
   `projectionValues.permissions` 缺失、`current` 为 null、该行被判为不可用——**看起来像坏了，其实只是没读过**。
   现在面板为每个列表内会话调用 `sessions.refreshProjections(id)`，走宿主的
   `remote.session.projections`（服务端由 `observeSession` 应答，**不会激活 Agent**）。
   这里刻意**不用 `retain()`**：retain 会实体化客户端 scope 并启动该会话的历史 `open()`，
   为每一行这么做等于把侧栏里所有会话全部打开。投影正是为「读取我没打开过的会话的元数据」准备的廉价读。
   副作用按 **id 列表**而非快照对象触发：快照标识会因 running 标志、引用计数等无关字段变化，
   每变一次就重读全部投影纯属打扰宿主。
6. **切换权限报「该会话暂时无法下发指令（尚未装载）」**。面板此前走
   `sessionsRef.binding(id)?.session` 再 `session.command(line)`。
   `binding(id)` 只对**已经存在**的 scope 返回绑定，它从不创建 scope——创建是 `retain()` 的职责。
   于是面板只能驱动当时恰好打开着的那几个会话，其余一律拒绝，这正是报告里的那半句症状。
   现在改为 `remote.commands.execute(sessionId, line, [])`：直接按 id 下发，与官方
   `ui-plan` 芯片用的是同一个面；宿主侧经 `resolveAgent(sessionId)` **按需恢复**冷会话，
   所以未打开的会话是完全合法的目标，不涉及客户端 scope、历史打开或引用计数。
   `dispatchCommand` 仍保留一条 binding 兜底分支，供「组合了 sessions 但没有 `remote.commands`」的载体使用。

六个 bug 形状相同：代码信任了一个**并不存在**的服务或字段，而且没有任何地方报错。
它们之所以没被测出来，是因为测试桩比真实宿主**更丰富**（桩提供了 `settingsScope`，
还凭空造了 `permissions.options`）。`test/host-api.cjs` 现在专门盯住这类问题。

**测试桩必须和 React / 宿主一样「不更丰富、也不更贫瘠」**：本轮修复中，
桩的 `useState` 不支持惰性初始化（`useState(() => new Set())`），于是把函数本身当成状态，
渲染期直接抛错；桩的 `useSyncExternalStore` 也从不调用 `subscribe`，
导致「订阅根本没接上」的组件在测试里看起来完全健康。两者都已按真实契约修正。

**硬门控 vs 软门控**：`inject` 数组里的名字是**硬要求**——服务缺失时 cordis 会让插件**永远停在 PENDING**；
而嵌套的 `ctx.inject([...], …)` 是**软要求**——回调不执行，只有依赖它的那个功能降级。
因此可选服务（`workspaces`、`shortcuts`）一律走软门控：`workspaces` 只用来**细化**权限面板，
`useArchivedIds()` 在服务缺失时**失败开放**为空集合（多显示一行归档会话无害，少显示一行正常会话才是 bug），
把它放进硬门控会把「某个功能不可用」升级成「整个插件不加载」。
`test/host-api.cjs` 静态断言这两个名字不在硬门控数组里，`test/platform.cjs` 则在**完全不提供 `workspaces`** 的载体上
验证插件仍能激活并注册全部区块与命令。

**嵌套命名空间的门控是逐个生效的**，这一点值得单独强调，因为它就是第三个 bug 的成因：
`ctx.remote` 是一个服务，但 `ctx.remote.settings`、`ctx.remote.permissionPresets`、`ctx.remote.session`
各自都是**独立注册的服务**（网关侧 `remoteServiceKey(namespace)`），读取时经由 `remote` 的 tracker
重定向到 `ctx['remote.<ns>']`，而重定向是按**读取方 fiber 的 inject 集合**解析的——
所以只声明 `remote` 并不覆盖它的子命名空间。

这不是推测，`tools/probe-inject.cjs` 用**真实 cordis** 复现了全过程：

```bash
node tools/probe-inject.cjs
# J parent=[remote,remote.settings] (missing permissionPresets) nested=[remote] read catalog
#   -> THREW: cannot get property "remote.permissionPresets" without inject
# I parent=[remote,remote.settings,remote.permissionPresets] nested=[remote] read BOTH
#   -> value=described/cataloged
```

场景 **J** 就是线上那个 bug（缺失即抛错），场景 **I** 是修复后的行为（嵌套作用域照常读到两个命名空间，
因为 cordis 会沿 fiber 链向上查找）。注意 `remote.settings` 与 `remote.permissionPresets` 是**分别**校验的：
只缺后者时前者仍能读到，这正是面板表现为「半个功能坏掉」而不是彻底消失的原因。
`test/host-api.cjs` 现在静态扫描活代码里所有 `remote.<ns>` 读取，断言每一个都在 `inject` 里声明过——
把它从数组里删掉会立刻让测试失败。

### 设置页

`设置 → 插件 → 快捷键工具包`，只保留插件自身的东西：指向官方快捷键界面的说明、五个快捷键开关，以及「子插件」卡片——该卡片现在只是**指向模型搜索框新位置**的说明，不再有开关。

### Web / Desktop 双载体

插件是**同一份 bundle**，运行时会自动识别当前载体：

- **识别方式**：存在 Electron 预加载桥 `window.dshDesktopActions`，或窗口 URL 带 `dsh-desktop-mode` 标记，即判定为 Desktop 载体；两者都没有（`dsh web`、远程浏览器访问）即为 Web 载体。
- **Web 载体下自动降级**：重启 DSH 与三个模式切换只声明 Desktop 档位、且在浏览器里会被拒绝执行；设置页会给出说明；
- **`Ctrl+R` 由官方 `page.refresh` 承担**，两种载体下都可用（Desktop 走宿主动作，Web 回退为浏览器刷新）；
- **陈旧绑定不会打空**：若组合键是在 Desktop 下录制的，之后在 Web 载体按到「重启 / 模式切换」会被 `blocked`，不会向不存在的 `/api/desktop/*` 端点发请求；
- **不解析不存在的设置表单**：`dsh-desktop` 是 Desktop 专有命名空间，Web 载体下不会去取它的配置表单。
- 工作区权限面板**在两种载体下完全一致**，不受载体影响。

### 快捷键归属

- 快捷键注册在插件自己的命名空间 `hotkeyToolkit` 下（`hotkeyToolkit.refresh` 等），
  命令 id 在加载时用官方 `commandPattern` 自校验：官方注册器**不校验** id 语法，
  但持久化层校验，一个语法错误的 id 会先注册成功、再在用户第一次编辑时让整份快捷键文档被判为
  `invalid`，把整个设置界面变成只读。这里选择在加载时直接报错，而不是让用户承担后果。
- 命令标签也注册在 `hotkeyToolkit` 命名空间，**不写入官方 `shortcuts` 命名空间**
  （重复注册同一 `(命名空间, 语言)` 会抛错）。
- 注册包在 `try/catch` 里：注册失败只会退化为「没有快捷键」，不会让整个插件激活失败。

## 安装

`dsh plugin add` 只认一个精确的包目标，本地路径、tarball、npm 包名都走同一条命令；装完会自动把包加入该 profile 的 `dsh.profile.bundles`。

```bash
# 1) 从本地源码目录安装（开发用，改完即生效）
dsh plugin --profile web add "link:H:/Github/dsh-hotkey-toolkit"

# Desktop 载体请用 DSH Desktop 自带的 dsh（普通 dsh 会拒绝 desktop profile）
dsh plugin --profile desktop add "link:H:/Github/dsh-hotkey-toolkit"

# 2) 从 tarball 安装（不带源码，最干净）
npm pack                                  # 生成 dsh-hotkey-toolkit-2.0.0.tgz
dsh plugin --profile web add "file:<绝对路径>/dsh-hotkey-toolkit-2.0.0.tgz"

# 3) 从 npm 安装（发布后）
dsh plugin --profile web add dsh-hotkey-toolkit
```

- **`--profile` 是必填项**，没有默认 profile；`web` 也有别名：`dsh web`。
- **`--profile desktop` 只被 DSH Desktop 自带的 `dsh` 接受**：普通 `@deepseek-ai/dsh` 会直接报 `profile "desktop" is managed exclusively by the Electron application`。装 desktop 载体请用应用内那条 `dsh`（或直接在应用里装）。
- 换 `--profile <名字>` 即可装到任意 profile（`web`、`rescue`、或你自建的配置）。
- 相对路径（`.`、`../dsh-hotkey-toolkit`）会被**按你当前所在目录**锚定，不会误装成 profile 自身，但显式写绝对路径最不容易出错。
- 卸载：`dsh plugin --profile web remove dsh-hotkey-toolkit`（会同时从 `dsh.profile.bundles` 摘掉）。
- 安装后重启对应的 DSH（Desktop 直接重启应用；Web 重新启动 `dsh web`）即可在 `设置 → 插件` 看到「快捷键工具包」与「工作区权限」两页，并在 `设置 → 快捷键` 看到本插件贡献的命令行。

### 可安装性说明

- `dsh.client.platform` 固定为 `"web"`：这是**唯一的合法值**，Desktop 自身也声明 `"web"`。它描述的是「浏览器半体的运行环境」，与 Web/Desktop 载体无关——双载体支持由运行时识别完成，不需要（也不存在）第二个 platform 值。
- `dsh.client.inject` 只列**共享**包（locale / shortcuts / settings / slots / remotes / session-controller），因此任何基于官方 profile 模板的配置都能直接装。
- 注意 `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**；真正的服务依赖由插件顶层的 `inject` 与 `ctx.inject()` 决定。这也是 `shortcuts` 用 `ctx.inject(['shortcuts'], …)` 惰性注入的原因。
- `peerDependencies`（`react` / `react-dom`）为可选提示；profile 的 `pnpm-workspace.yaml` 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会因此多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），且未启用 `engine-strict`，只作提示。

## 开发

```bash
npm test          # 无依赖：键位审计 + 词典 + 宿主 API 兼容 + 迁移兼容 + 权限面板 + 双载体
```

- `test/binding-audit.cjs`：**键位审计**。`ctx.shortcuts.register()` 会一次性校验**全部六个**
  `runtime:platform` 档位（不只是你当前这台设备），任一档位触发保留键、Web 不合法组合或与其它命令默认值重叠都会**抛错**，
  而该异常会穿过 `ctx.effect` 直接让插件激活失败。本套件按官方 `binding.ts` / `configuration.ts`
  忠实复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，
  从 `client.js` 里取出真实默认值表，断言 247 个「命令 × 档位」组合全部合法，且与 18 条官方核心默认值零冲突；
  并带**反向对照**（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须被判非法），确保审计本身不是空转。
  它还断言 Web 档位**保持不绑定**——这正是开发时抓到真实违规的那条断言。
- `test/host-api.cjs`：**宿主 API 兼容**。专门盯住「插件信任了宿主并不提供的服务或字段」这一类**静默**失败：
  静态检查（先剥掉注释，只查活代码）断言源码不再出现已被移除的 `settingsScope`，
  也不再从 `permissions` 投影读取并不存在的 `options`；断言活代码里每一个 `remote.<ns>` 读取
  都在 `inject` 数组里声明过（嵌套命名空间各自独立门控，漏一个就是一次静默抛错）；
  断言 `workspaces` / `shortcuts` **没有**被放进硬门控 `inject` 数组（放进去＝服务缺失时整个插件永远 PENDING）；
  断言面板**按 id 下发命令**（`commands.execute(id, line, [])` 且门控条件仍在），
  不再出现 per-row 的 `binding(row.id)`——那是「尚未装载」的成因；
  行为检查则在**两种载体**上，仅用 DSH 0.1.7 真实提供的接口激活插件，断言权限面板确实调用了
  `remote.settings.describe()` 与 `remote.permissionPresets.catalog()`、
  `dsh-desktop` 表单只在 Desktop 载体解析一次，
  渲染面板断言**已归档会话不出现在行里**、活跃会话在、跳过数量被报告，
  并断言「新会话默认权限」下拉取的是 `defaultOptions` 而非 `options`。
  六个已修 bug 与归档过滤都用变异测试验证过能被它抓到。
- `test/legacy-model-search.cjs`：**迁移兼容**。真实加载 `client.js`、真实渲染设置页、
  按行标签定位开关并调用其 `onChange`，然后断言偏好文档里的 `modelSearch` 字段
  逐次写入都**完好保留**。它守护的是一个不显眼的破坏方式：`update()` 每次都用整份快照重写文档，
  若 `normalizeConfig` 在「移除功能」时顺手丢掉这个字段，用户**下一次拨动任意快捷键开关**就会抹掉它——
  而滑块插件那时未必已加载，用户当初特意关掉的搜索框会被悄悄打开（变异测试已验证该断言有效）。
  另外断言本插件源码（去注释后）不再引用 `conversation.input.model` / `modelDirectories`。
- `test/dictionaries.cjs`：词典完整性。断言 `zh`/`en` 键集完全一致、
  代码里每一个字面量 `t("key")` 都存在、以及快捷键标签键（含 `"cmdMode" + mode…` 这种动态拼接）都存在。
  宿主本地化**不跨命名空间回退**，缺键会直接把原始键名显示给用户。
- `test/smoke.cjs`：权限面板渲染 + 下拉 Portal + 点击切换 + 默认权限写入 + **批量修改**。
  它的宿主桩**只提供真实存在的接口**（会话投影里没有 `options`，也不提供 `settingsScope`），
  并额外断言会话行的选择器**没有被禁用**——这条正是修好「权限管理不可用」的回归守卫；
  会话夹具里放了一个**已归档**会话，断言它不出现在行里而其余会话照常，跳过数量也照常报告。
  批量用例**只勾选两行中的一行**：全勾会让「已选」与「全部可管理行」无从区分，
  一个忽略选择、直接改全部的实现在全勾情况下照样通过（第一版就是这么写的，变异测试当场证明该断言毫无价值）。
  未勾选的那行被特意放在同一个预设上，使「忽略选择」必然产生第二条命令，从而无法藏身。
- `test/platform.cjs`：Web/Desktop 双载体回归。以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，
  断言插件**不再安装自己的全局 keydown 监听**（键盘归官方服务独有）、五个命令都已贡献给官方服务、
  Desktop-only 命令**不含任何 Web 档位默认值**且在 Web 下 `resolve` 返回 `blocked`、
  「刷新界面」默认不绑定、Web 下刷新回退为页面刷新、Desktop 下走宿主动作、
  以及仅在 Desktop 载体解析一次 `dsh-desktop` 配置表单；并校验命名空间 zh/en 键集合完全一致。
  它还会在**完全不提供 `workspaces`** 的载体上再加载一次（软门控缺失时宿主根本不会回调 `ctx.inject`），
  断言插件仍能激活、设置页与权限面板都已注册、五个命令一个不少；
  并在**不提供 `settingsSchema`** 的载体上渲染权限面板，断言它依然驱动了
  `remote.settings.describe()`——即设置绑定没有和 schema 服务重新耦合。
  设置页用例同时断言「子插件」卡片渲染的是指向新位置的说明文字、
  且**没有**任何残留的模型搜索开关（一个有壳无肉的开关比没有更糟）。

模型席位相关的 `test/model-seat*.cjs`、`test/seat-toggle.cjs` 三套 DOM/开关套件已随功能一起迁往
`dsh-client-ui-effort-slider`。

### 安装校验

```bash
node tools/verify-profile.cjs web         # 本插件确实进了组合树
node tools/verify-coexistence.cjs web     # 与滑块插件共存且模型席位只有一个主人
```

`verify-profile.cjs` 用真实 `dsh --profile web --dump-config` 组合出完整 loader 树（不启动应用），断言
`dsh-hotkey-toolkit` 确实作为一行被 profile 挂载，且 `exports["./client"]` 可解析、
`dsh.client.platform === "web"`、`dsh.client.inject` 含 `@deepseek-ai/dsh-client-shortcuts`。
这比只检查 `package.json` 更有力：它证明插件真的进了组合树。

`verify-coexistence.cjs` 在同一棵组合树上再断言一次跨插件的分工：两个包都是 loader 行，
且 `conversation.input.model` 这一格位**只有一个主人**（滑块插件，`priority: -1`），
本插件的客户端半体在去注释后对此格位零引用。两个插件都想接管同一格位时，
胜负由加载顺序决定——这正是迁出要消灭的歧义，所以它值得一条自动断言。

### 注入语义探针

```bash
node tools/probe-inject.cjs
```

用**真实 cordis**（`vendor/cordis/lib`）验证嵌套 `ctx.inject([...], …)` 的门控语义，无需启动应用。
它把网关的注册方式如实复刻出来：`remote` 是一个 `Service`，而每个 `remote.<ns>` 是**独立注册的服务**，
读取时经 tracker 重定向到 `ctx['remote.<ns>']` 并按读取方 fiber 的 inject 集合解析。
脚本会打印 10 个场景的实测结果，其中最关键的两个是：

- **J**（缺失即抛错）：父层只声明 `remote.settings` 时，嵌套作用域读 `remote.permissionPresets` 抛
  `cannot get property "remote.permissionPresets" without inject` —— 这正是线上那个 bug；
- **I**（修复后）：父层声明齐全时，嵌套作用域能同时读到 `settings` 与 `permissionPresets`，
  因为 cordis 会沿 fiber 链向上查找。

这份脚本的存在是为了**让结论可复现**而不是停留在注释里：`test/host-api.cjs` 的静态断言就是照着它写的。

### 变异测试助手

```bash
node tools/mutate.cjs client.js .mut.js '<原文>' '<替换文本>'
```

按字面量替换生成一份变异副本（不做替换就报错退出），用来验证某条断言**真的能抓到**它声称防住的缺陷。
断言没被变异测试验证过，就只是一句注释——本项目的每个关键守卫都用它跑过一遍。

之所以是脚本而不是 `node -e`：PowerShell 会吃掉内联脚本里的引号与反斜杠，
结果是变异**没生效**而测试照样通过，看起来像「断言通过」实则什么也没验证。这个坑踩过一次。

## 说明

- 模式切换会先写入 `dsh-desktop` 设置（切换到非兼容模式时同时关闭浏览器访问与局域网暴露），再重启 DSH Desktop 生效；因此该功能与「重启 DSH」一样**只在 Desktop 载体可用**。
- 载体识别是**每次调用即时探测**，不是激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- Desktop 专有的命令在 Web 载体下是**不声明默认键位 + `resolve` 拒绝**，而不是「渲染成灰色行」——置灰会暗示「装上 Desktop 就能用」以外的含义，而这里缺的是宿主能力，不是用户权限。
- 载体说明文案注册在主命名空间 `hotkeyToolkit`（`webCarrierNote` / `desktopOnly` / `scopeUnavailable`）。
- **键盘监听只有一个**：插件删除了自己的全局 `keydown` 监听，键盘完全交给官方快捷键服务，避免两套监听在捕获阶段互相竞争、以及两套录制器各自持有不同的键位真相。
- **快捷键持久化不在插件里**：宿主偏好文档是唯一真相（Web `dsh.keybindings.v1`，Desktop `userData/keybindings.json`）。插件的 localStorage 现在只存五个命令开关，外加一个不再被读取、仅为交接保留的 `modelSearch` 字段。
- **命令开关拦的是动作，不是绑定**：这样既不会让官方界面里正在编辑的草稿失效，也不会让用户录制的组合键在停用期间丢失；停用返回 `pass` 而非 `blocked`，避免吞掉用户真正想按的键。
- **旧版载荷兼容**：1.4 及更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段；`shortcuts` 逐键合并，缺失的键取默认（开）；`modelSearch` 作为交接字段原样保留。
- `shortcuts` 服务用 `ctx.inject(['shortcuts'], …)` **惰性注入**，而不是写进插件顶层 `inject`：这样即使某个载体没有该服务，设置页与权限面板依然可用，只有快捷键缺失，而不是整个插件停在 PENDING。
- **面板的设置绑定只注入 `remote`，不注入 `settingsSchema`**：候选默认权限改从宿主目录 `defaultOptions` 读取后，schema 只剩兜底作用。把两者耦合会让「没有 schema 服务的载体」上绑定回调不执行、`settingsCtx` 为 null、面板永远停在「加载中」——与 `settingsScope` 那个 bug 完全同形，没有理由再冒一次这个风险。`test/platform.cjs` 用一个**不提供 `settingsSchema`** 的载体盯着这条。
- **`catalog.options` 与 `catalog.defaultOptions` 是两个不同的字段**：前者是当前可选的全部预设（含 `auto`），后者才是**可作为新会话默认**的子集。官方那一行读后者，本插件也读后者；`test/host-api.cjs` 的桩把两者设成不同集合，读错字段会立刻被抓到。
- **依赖宿主服务一律用 `ctx.inject` 惰性获取，并对其缺失保持可降级**：DSH 0.1.7 移除了 `settingsScope`（改为 `configForms`），而嵌套 `inject` 对不存在的服务**既不报错也不激活失败**——回调静默不执行。因此面板侧的探测失败会写入 `window.__dshHotkeyPanel` 并打日志，把「面板莫名空白」变成一行可读答案。
- 注册失败会被 `try/catch` 收敛成「没有快捷键」并打日志，不会让 `apply()` 抛错——插件退化是可接受的，插件加载失败不是。
- **模型席位已迁出本插件**：可搜索模型菜单现在由 `dsh-client-ui-effort-slider` 提供，它原本就占着 `conversation.input.model` 同一格位。槽位运行时对遮蔽型席位是「单选」语义，两个插件都注册只会互相遮蔽、结果取决于加载顺序，因此这里不是取舍而是必须分出唯一归属。
- 迁出后本插件不再声明 `modelDirectories`、不再引用 `remote.session`：那个依赖原本只是为了让 `directoryFor()` 能在**本插件**的 fiber 上解析 `this.ctx.remote.session`（cordis 的 `Service` tracker 会把 `this.ctx` 重绑成调用方 ctx），席位走了，这条硬门控也就没有必要再留着——一个用不到的硬门控只会让插件在缺该服务的载体上停在 PENDING。
- **偏好字段 `modelSearch` 只写不读地透传**，这是迁移的兼容契约（`test/legacy-model-search.cjs`）。原因见「模型搜索（已迁出）」一节：`update()` 整份重写文档，字段一旦被丢掉，用户下次拨动任意快捷键开关就会把旧选择抹掉。
- 权限面板读取宿主的 `permissions` 会话投影（会话列表快照自带），切换走 `/permission` 斜杠命令，默认预设走 `permission` 设置命名空间——三者都是宿主原生通道，插件自身不存储任何权限状态。
- **读投影不等于开会话**：面板对未打开的会话调用 `sessions.refreshProjections(id)`，宿主由 `observeSession` 应答，不激活 Agent；而 `retain()` 会实体化 scope 并 `open()` 历史。列表型功能要用前者，否则「看一眼所有会话的权限」会变成「把所有会话都打开一遍」。
- **按 id 下发命令，不要先拿 binding**：`sessions.binding(id)` 只返回已存在的 scope，从不创建；`remote.commands.execute(sessionId, line, [])` 直接按 id 走宿主 `resolveAgent()`，冷会话会被按需恢复。这是官方 `ui-plan` 芯片的做法，也是面板能管理未打开会话的原因。
- 归档集合读自 `workspaces.list.getSnapshot().archivedSessionIds`（`IWorkspaces` 的 `WorkspaceSource`，官方侧栏用的是同一个面）。归档会话不列出、不管理，并报告跳过数量；该服务缺失时降级为**空集合**（失败开放）。
- `workspaces` 与 `shortcuts` 走**软门控**（嵌套 `ctx.inject`），不进 `inject` 数组。硬门控数组里的名字缺失会让插件**永远停在 PENDING**，而这两个服务都只是「有更好」：`workspaces` 只细化权限面板，`shortcuts` 只提供命令。把可选服务放进硬门控，会把「某功能不可用」升级成「插件不加载」。
