# dsh-hotkey-toolkit

DSH 快捷键工具包 + 输入框模型搜索 + 工作区权限面板。同一份源码同时支持 **Web** 与 **Desktop** 两种载体。

## 功能

| 快捷键 | 作用 | 载体 |
| --- | --- | --- |
| `Ctrl+R` | 刷新界面（重新加载渲染进程） | Web + Desktop |
| `Ctrl+Shift+R` | 重启 DSH Desktop | 仅 Desktop |
| `Ctrl+Alt+1` / `2` / `3` | 切换 兼容模式 / 扩展模式 / 增强模式（可在 设置 → 插件 中自定义） | 仅 Desktop |

### Web / Desktop 双载体

插件是**同一份 bundle**，运行时会自动识别当前载体：

- **识别方式**：存在 Electron 预加载桥 `window.dshDesktopActions`，或窗口 URL 带 `dsh-desktop-mode` 标记，即判定为 Desktop 载体；两者都没有（`dsh web`、远程浏览器访问）即为 Web 载体。
- **Web 载体下自动降级**：隐藏「重启 DSH」与三个模式切换行（它们依赖 Desktop 宿主，在浏览器里无意义），并在设置页给出说明；
- **`Ctrl+R` 在两种载体下都可用**：Desktop 下走宿主 reload 动作，Web 下回退为浏览器刷新页面，效果一致；
- **陈旧绑定不会打空**：若组合键是在 Desktop 下录制的，之后在 Web 载体按到「重启 / 模式切换」会被静默忽略，不会向不存在的 `/api/desktop/*` 端点发请求；
- **不绑定不存在的设置命名空间**：`dsh-desktop` 是 Desktop 专有命名空间，Web 载体下不会绑定该作用域。
- 模型搜索框与工作区权限面板**在两种载体下完全一致**，不受载体影响。

### 模型搜索（输入框模型按钮）

保留原版**两级菜单**：点击输入框右侧的模型按钮，先看到「模型 / 推理等级」两行；
点「模型」进入模型列表——**搜索框就在这一级，固定在模型选项上方**：

- 搜索框位于模型列表顶部（按模型名 / 模型 ID / 供应商过滤，忽略大小写），与它过滤的列表在同一级；
- 进入模型列表自动聚焦搜索框，输入即时过滤，结果仍按供应商分组；
- `Enter` 直接选中第一个匹配项；`Esc` 先清空搜索，再逐级返回（模型列表 → 根菜单 → 关闭）；
- 无匹配时显示空状态提示；右侧有清除按钮；
- 「推理等级」是根菜单里的另一行，进入后可用「返回」回到根菜单；
- 键盘上下键仍可在选项中移动焦点，点击菜单外任意处关闭。

### 工作区权限面板

`设置 → 插件 → 工作区权限`，集中管理**所有会话**的权限：

- 每个会话一行：彩色首字头像 + 会话标题 + 工作目录，运行中的会话带绿点，「当前」会话带标记；
- 右侧自绘下拉切换权限预设（仅可查看 / 工作区内修改 / 完全权限），带彩色预设标记与选中勾，通过宿主自带的 `/permission` 命令下发，实时生效；
- 顶部可修改**新会话的默认权限预设**（写入宿主 `permission` 设置）；
- 切换到「完全权限」前会弹出风险确认，且确认框是**窗口居中的模态框**（Portal 挂到 `<body>` 的固定遮罩层，独立于面板滚动容器），不再渲染在会话列表末尾——列表很长时无需滚到底部；支持 Esc 与点击遮罩关闭；
- 下拉为 Portal 渲染、视口内自动翻转避让，支持点击外部 / Esc 关闭；
- 会话列表支持手动刷新，子会话不出现在列表中。

### 设置页

`设置 → 插件 → 快捷键工具包`，可开关整套快捷键、录制新的模式切换组合键（模式相关行仅在 Desktop 载体显示）。

## 安装

`dsh plugin add` 只认一个精确的包目标，本地路径、tarball、npm 包名都走同一条命令；装完会自动把包加入该 profile 的 `dsh.profile.bundles`。

```bash
# 1) 从本地源码目录安装（开发用，改完即生效）
dsh plugin --profile desktop add "link:H:/Github/dsh-hotkey-toolkit"
dsh plugin --profile web     add "link:H:/Github/dsh-hotkey-toolkit"

# 2) 从 tarball 安装（不带源码，最干净）
npm pack                                  # 生成 dsh-hotkey-toolkit-1.4.0.tgz
dsh plugin --profile web add "file:<绝对路径>/dsh-hotkey-toolkit-1.4.0.tgz"

# 3) 从 npm 安装（发布后）
dsh plugin --profile web add dsh-hotkey-toolkit
```

- 换 `--profile <名字>` 即可装到任意 profile（`desktop`、`web`、或你自建的配置）；不指定时用默认 profile。
- 相对路径（`.`、`../dsh-hotkey-toolkit`）会被**按你当前所在目录**锚定，不会误装成 profile 自身，但显式写绝对路径最不容易出错。
- 卸载：`dsh plugin --profile web remove dsh-hotkey-toolkit`（会同时从 `dsh.profile.bundles` 摘掉）。
- 安装后重启对应的 DSH（Desktop 直接重启应用；Web 重新启动 `dsh web`）即可在 `设置 → 插件` 看到「快捷键工具包」与「工作区权限」两页。

### 可安装性说明

- `dsh.client.platform` 固定为 `"web"`：这是**唯一的合法值**，Desktop 自身也声明 `"web"`。它描述的是「浏览器半体的运行环境」，与 Web/Desktop 载体无关——双载体支持由运行时识别完成，不需要（也不存在）第二个 platform 值。
- `dsh.client.inject` 只列**共享**包（locale / conversation / settings / slots / remotes / session-controller），因此任何基于官方 profile 模板的配置都能直接装。
- `peerDependencies`（`react` / `react-dom`）为可选提示；profile 的 `pnpm-workspace.yaml` 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会因此多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），且未启用 `engine-strict`，只作提示。

## 开发

```bash
npm test          # 无依赖：模型席位（含二级模型列表搜索框）+ 权限面板 + Web/Desktop 双载体
npm run test:dom  # 可选：用真实 React + jsdom 渲染并驱动模型席位（含抗崩退回归）
```

- `test/model-seat.cjs`：以桩化 react 加载真实 `client.js`，断言打开菜单先落在「模型 / 推理等级」两行、进入模型列表后搜索框位于模型选项**上方**、过滤 / Enter 选中 / Esc 逐级返回、推理等级入口可达，并校验席位词典 zh/en 键一致、无未翻译键泄漏。其词典桩严格复刻宿主的解析规则（**仅在本命名空间查找，不跨命名空间回退**），因此把字符串放错命名空间会直接以原始键暴露。
- `test/smoke.cjs`：权限面板渲染 + 下拉 Portal + 点击切换 + 默认权限写入。
- `test/platform.cjs`：Web/Desktop 双载体回归。分别以「有 preload 桥」「只有 URL 标记」「两者都没有」三种页面加载真实 `client.js`，断言 Web 载体隐藏重启与模式行、`Ctrl+R` 回退为页面刷新、陈旧的重启/模式绑定不发网络请求、不绑定 `dsh-desktop` 作用域；Desktop 载体则行数完整、绑定一次该作用域、刷新走宿主动作；并校验两个命名空间 zh/en 键集合完全一致。
- `test/model-seat-dom.cjs`（可选）：用真实 React 18 + jsdom 渲染并驱动席位，验证根菜单只有「模型 / 推理等级」两行、搜索框位于模型列表首位、占位符为真实译文、过滤收敛、Enter 选中。
- `test/model-seat-resilience.cjs`（可选）：抗崩退回归。席位是「遮蔽官方」的单选席位，**首次渲染出错就会被席位运行时退役（abdicate）**，此后整段会话都退回官方两级菜单、搜索框消失。该套件用残缺快照（缺 `groups`/`failures`、空对象、`reasoning` 无 `efforts`）与「会话未解析导致 `directoryFor` 抛错」两类冷启动输入，断言搜索框依然渲染、注册不被中断。两个 DOM 套件都需指定依赖目录：
  ```bash
  DSH_DOMTEST_DIR=<含 react/react-dom/jsdom 的目录> npm run test:dom
  ```

## 说明

- 模式切换会先写入 `dsh-desktop` 设置（切换到非兼容模式时同时关闭浏览器访问与局域网暴露），再重启 DSH Desktop 生效；因此该功能与「重启 DSH」一样**只在 Desktop 载体可用**。
- 载体识别是**每次调用即时探测**，不是激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的行永久消失。
- Desktop 专有的三行（重启 + 三个模式）在 Web 载体下是**不渲染**而非置灰——置灰会暗示「装上 Desktop 就能用」以外的含义，而这里缺的是宿主能力，不是用户权限。
- 载体说明文案注册在主命名空间 `hotkeyToolkit`（`webCarrierNote` / `desktopOnly` / `scopeUnavailable`），与席位命名空间彼此独立。
- 模型搜索通过以更低优先级遮蔽官方 `conversation.input.model` 席位实现；若本插件被卸载或出错，官方模型选择会自动恢复。
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
