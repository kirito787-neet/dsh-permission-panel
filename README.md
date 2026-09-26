# dsh-hotkey-toolkit

DSH 快捷键工具包（官方快捷键体系）+ 输入框模型搜索子插件 + 工作区权限面板。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

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

### 模型搜索（可开关的子插件）

`设置 → 插件 → 快捷键工具包 → 子插件 → 模型搜索`，默认**开启**：

- 开启时：以更低优先级遮蔽官方 `conversation.input.model` 席位，提供可搜索的模型菜单
  （保留原版**两级菜单**：先「模型 / 推理等级」，进入「模型」后搜索框固定在模型选项**上方**）；
- 关闭时：席位被**注销**，官方原生模型菜单立即回归——同一格位回落到下一个存活项；
- 开关**即时生效**并持久化，无需重载；
- 重新开启会**重新注册**席位（已注销的 `slots.inject` 句柄无法复用，必须重新调用）。

搜索框行为：进入模型列表自动聚焦、输入即时过滤（按模型名 / ID / 供应商，忽略大小写）、
`Enter` 选中第一个匹配项、`Esc` 先清空再逐级返回、无匹配显示空状态、右侧有清除按钮。

### 工作区权限面板

`设置 → 插件 → 工作区权限`，集中管理**所有会话**的权限：

- 每个会话一行：彩色首字头像 + 会话标题 + 工作目录，运行中的会话带绿点，「当前」会话带标记；
- 右侧自绘下拉切换权限预设（仅可查看 / 工作区内修改 / 完全权限），带彩色预设标记与选中勾，通过宿主自带的 `/permission` 命令下发，实时生效；
- 顶部可修改**新会话的默认权限预设**（写入宿主 `permission` 设置）；
- 切换到「完全权限」前会弹出风险确认，且确认框是**窗口居中的模态框**（Portal 挂到 `<body>` 的固定遮罩层，独立于面板滚动容器），不再渲染在会话列表末尾——列表很长时无需滚到底部；支持 Esc 与点击遮罩关闭；
- 下拉为 Portal 渲染、视口内自动翻转避让，支持点击外部 / Esc 关闭；
- 会话列表支持手动刷新，子会话不出现在列表中。

### 设置页

`设置 → 插件 → 快捷键工具包`，只保留插件自身的东西：指向官方快捷键界面的说明，以及模型搜索子插件开关。

### Web / Desktop 双载体

插件是**同一份 bundle**，运行时会自动识别当前载体：

- **识别方式**：存在 Electron 预加载桥 `window.dshDesktopActions`，或窗口 URL 带 `dsh-desktop-mode` 标记，即判定为 Desktop 载体；两者都没有（`dsh web`、远程浏览器访问）即为 Web 载体。
- **Web 载体下自动降级**：重启 DSH 与三个模式切换只声明 Desktop 档位、且在浏览器里会被拒绝执行；设置页会给出说明；
- **`Ctrl+R` 由官方 `page.refresh` 承担**，两种载体下都可用（Desktop 走宿主动作，Web 回退为浏览器刷新）；
- **陈旧绑定不会打空**：若组合键是在 Desktop 下录制的，之后在 Web 载体按到「重启 / 模式切换」会被 `blocked`，不会向不存在的 `/api/desktop/*` 端点发请求；
- **不绑定不存在的设置命名空间**：`dsh-desktop` 是 Desktop 专有命名空间，Web 载体下不会绑定该作用域。
- 模型搜索子插件与工作区权限面板**在两种载体下完全一致**，不受载体影响。

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
npm pack                                  # 生成 dsh-hotkey-toolkit-1.5.0.tgz
dsh plugin --profile web add "file:<绝对路径>/dsh-hotkey-toolkit-1.5.0.tgz"

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
- `dsh.client.inject` 只列**共享**包（locale / shortcuts / conversation / settings / slots / remotes / session-controller），因此任何基于官方 profile 模板的配置都能直接装。
- 注意 `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**；真正的服务依赖由插件顶层的 `inject` 与 `ctx.inject()` 决定。这也是 `shortcuts` 用 `ctx.inject(['shortcuts'], …)` 惰性注入的原因。
- `peerDependencies`（`react` / `react-dom`）为可选提示；profile 的 `pnpm-workspace.yaml` 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会因此多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），且未启用 `engine-strict`，只作提示。

## 开发

```bash
npm test          # 无依赖：键位审计 + 词典完整性 + 模型席位 + 子插件开关 + 权限面板 + 双载体
npm run test:dom  # 可选：用真实 React + jsdom 渲染并驱动模型席位（含抗崩退回归）
```

- `test/binding-audit.cjs`：**键位审计**。`ctx.shortcuts.register()` 会一次性校验**全部六个**
  `runtime:platform` 档位（不只是你当前这台设备），任一档位触发保留键、Web 不合法组合或与其它命令默认值重叠都会**抛错**，
  而该异常会穿过 `ctx.effect` 直接让插件激活失败。本套件按官方 `binding.ts` / `configuration.ts`
  忠实复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，
  从 `client.js` 里取出真实默认值表，断言 247 个「命令 × 档位」组合全部合法，且与 18 条官方核心默认值零冲突；
  并带**反向对照**（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须被判非法），确保审计本身不是空转。
  它还断言 Web 档位**保持不绑定**——这正是开发时抓到真实违规的那条断言。
- `test/dictionaries.cjs`：词典完整性。断言 `zh`/`en` 与 `seatZh`/`seatEn` 键集完全一致、
  代码里每一个字面量 `t("key")` 都存在、以及快捷键标签键（含 `"cmdMode" + mode…` 这种动态拼接）都存在。
  宿主本地化**不跨命名空间回退**，缺键会直接把原始键名显示给用户。
- `test/model-seat.cjs`：以桩化 react 加载真实 `client.js`，断言打开菜单先落在「模型 / 推理等级」两行、
  进入模型列表后搜索框位于模型选项**上方**、过滤 / Enter 选中 / Esc 逐级返回、推理等级入口可达，
  并校验席位词典 zh/en 键一致。其词典桩严格复刻宿主的解析规则（**仅在本命名空间查找，不跨命名空间回退**）。
- `test/seat-toggle.cjs`：**子插件开关**。真实渲染设置页、找到模型搜索开关并调用它的 `onChange`，
  断言：关闭后席位被注销（官方菜单回归）、**再次开启会重新调用 `slots.inject`**
  （已注销的句柄不能复用，这是最容易写成「单向开关」的地方）、重复关闭幂等、
  以及存量 OFF / 缺省 / 旧版 1.4 载荷 / 损坏 JSON 四种输入都能正确降级。
- `test/smoke.cjs`：权限面板渲染 + 下拉 Portal + 点击切换 + 默认权限写入。
- `test/platform.cjs`：Web/Desktop 双载体回归。以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，
  断言插件**不再安装自己的全局 keydown 监听**（键盘归官方服务独有）、五个命令都已贡献给官方服务、
  Desktop-only 命令**不含任何 Web 档位默认值**且在 Web 下 `resolve` 返回 `blocked`、
  「刷新界面」默认不绑定、Web 下刷新回退为页面刷新、Desktop 下走宿主动作、
  以及仅在 Desktop 载体绑定一次 `dsh-desktop` 作用域；并校验两个命名空间 zh/en 键集合完全一致。
- `test/model-seat-dom.cjs`（可选）：用真实 React 18 + jsdom 渲染并驱动席位，验证根菜单只有「模型 / 推理等级」两行、搜索框位于模型列表首位、占位符为真实译文、过滤收敛、Enter 选中。
- `test/model-seat-resilience.cjs`（可选）：抗崩退回归。席位是「遮蔽官方」的单选席位，**首次渲染出错就会被席位运行时退役（abdicate）**，此后整段会话都退回官方两级菜单、搜索框消失。该套件用残缺快照（缺 `groups`/`failures`、空对象、`reasoning` 无 `efforts`）与「会话未解析导致 `directoryFor` 抛错」两类冷启动输入，断言搜索框依然渲染、注册不被中断。两个 DOM 套件都需指定依赖目录：
  ```bash
  DSH_DOMTEST_DIR=<含 react/react-dom/jsdom 的目录> npm run test:dom
  ```

### 安装校验

```bash
node tools/verify-profile.cjs web
```

用真实 `dsh --profile web --dump-config` 组合出完整 loader 树（不启动应用），断言
`dsh-hotkey-toolkit` 确实作为一行被 profile 挂载，且 `exports["./client"]` 可解析、
`dsh.client.platform === "web"`、`dsh.client.inject` 含 `@deepseek-ai/dsh-client-shortcuts`。
这比只检查 `package.json` 更有力：它证明插件真的进了组合树。

## 说明

- 模式切换会先写入 `dsh-desktop` 设置（切换到非兼容模式时同时关闭浏览器访问与局域网暴露），再重启 DSH Desktop 生效；因此该功能与「重启 DSH」一样**只在 Desktop 载体可用**。
- 载体识别是**每次调用即时探测**，不是激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- Desktop 专有的命令在 Web 载体下是**不声明默认键位 + `resolve` 拒绝**，而不是「渲染成灰色行」——置灰会暗示「装上 Desktop 就能用」以外的含义，而这里缺的是宿主能力，不是用户权限。
- 载体说明文案注册在主命名空间 `hotkeyToolkit`（`webCarrierNote` / `desktopOnly` / `scopeUnavailable`），与席位命名空间彼此独立。
- **键盘监听只有一个**：插件删除了自己的全局 `keydown` 监听，键盘完全交给官方快捷键服务，避免两套监听在捕获阶段互相竞争、以及两套录制器各自持有不同的键位真相。
- **快捷键持久化不在插件里**：宿主偏好文档是唯一真相（Web `dsh.keybindings.v1`，Desktop `userData/keybindings.json`）。插件的 localStorage 现在只存模型搜索开关。
- **旧版载荷兼容**：1.4 及更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段，只保留模型搜索开关，因此升级不会丢失该偏好。
- `shortcuts` 服务用 `ctx.inject(['shortcuts'], …)` **惰性注入**，而不是写进插件顶层 `inject`：这样即使某个载体没有该服务，设置页、权限面板、模型席位依然可用，只有快捷键缺失，而不是整个插件停在 PENDING。
- 注册失败会被 `try/catch` 收敛成「没有快捷键」并打日志，不会让 `apply()` 抛错——插件退化是可接受的，插件加载失败不是。
- 模型搜索通过遮蔽官方 `conversation.input.model` 席位实现；关闭开关或席位出错时，官方模型选择会自动恢复。
- 正因如此，席位**不能抛错**：席位运行时对遮蔽型席位采用「一崩即退役」策略，首次渲染异常就会让本席位永久退场（直到重载），表现就是搜索框消失、官方两级菜单回归。因此席位对宿主快照做了防御性归一（`groups`/`failures` 非数组即降级为空），`directoryFor` 抛错时降级为只读空列表，而不是把异常抛给渲染器。
- 席位里 `available` **默认 true**，只有在确知「这是被寻址的子会话」时才置 false——因为 `available === false` 时组件直接 `return null`，会把输入框的模型按钮整个抹掉。遇到异常一律保持可见并降级。
- 目录**延迟解析**：注入面每个 binding 只计算一次，而 `directoryFor()` 在会话 scope/binding 尚未就绪时会抛错。若在构建注入面时立即解析，冷启动会把一个空目录钉死整段会话——表现为菜单只剩搜索框、没有模型列表。现在改为首次订阅 / 每次 `load()` 时才解析，未就绪期间报告 `loading`（菜单显示「正在加载模型列表…」），会话绑定后自动接管真实 store。
- 菜单对**任何非 loading 状态**都会渲染一行（加载中 / 加载失败 / 没有可用模型），不再出现「只有搜索框、下面空白」的情况。
- 目录在**席位挂载时就开始预热**（不是等打开菜单才取）：模型目录是跨会话共享的缓存，席位一挂载就 `load()`，等你点开菜单时通常已经 ready，列表**直接出现**而不必等一次 Host 往返。
- 会话往往**在输入框挂载之后**才完成绑定，而这件事没有任何通知；因此预热带**有界自轮询**（每 250ms，最多约 10s），会话一就绪就立刻取列表，而不是拖到你点开菜单才取。
- 预热**失败不会锁死**：`load()` 报错时重置标记并自行重试，否则一次瞬时故障会让触发器永远停在「加载中…」。
- 重试预算用尽后不再谎报 loading，而是转为**错误行并写出真实原因**（如 `modelDirectories.directoryFor: … resolved no binding`），避免出现永不结束的转圈。
- 加载中一行会附带**目录快照摘要**（`status=` / `groups=` / `failures=` / `current=` / `error=`）。这是区分两类故障的关键：`status=loading` 表示 Host 请求仍挂着，`status=idle` 表示请求回来了但投影没接上。
- 诊断同时写入 `window.__dshHotkeySeat` 与 `localStorage["dsh.hotkeyToolkit.seatDiag"]`，因此**不需要开发者工具**也能取到（后者可直接从磁盘 leveldb 读）。
- 插件必须注入 `remote` 与 `remote.session`（以及 `sessions`），**即使自己从不调用它们**。`modelDirectories` 是 cordis 的 `Service`，其 tracker 会把 `this.ctx` 重绑成**调用方的 ctx**，于是 `directoryFor()` 内部的 `this.ctx.remote.session` 是通过**本插件**的 fiber 解析的。只声明自己直接调用的服务会导致每次 `directoryFor()` 都抛 `cannot get property "remote.session" without inject`，表现就是模型列表永远停在加载中。
- 降级时不会静默吞掉原因：最后一次失败会记录在 `window.__dshHotkeySeat`（含 `where` 与 `message`）。排查时在控制台执行 `window.__dshHotkeySeat` 即可看到是 `directoryFor` 还是 `subagentAddress` 出的问题。
- 席位文案注册在 `hotkeyToolkit.seat` 命名空间；宿主的本地化**不跨命名空间回退**，因此该命名空间必须自带席位用到的全部键（缺失时会直接显示原始键名）。
- 权限面板读取宿主的 `permissions` 会话投影（会话列表快照自带），切换走 `/permission` 斜杠命令，默认预设走 `permission` 设置命名空间——三者都是宿主原生通道，插件自身不存储任何权限状态。
