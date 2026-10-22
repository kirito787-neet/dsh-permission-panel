# 开发

## 测试

```bash
npm test   # 无外部依赖，纯 Node 内置模块，9 个 test/*.cjs 串行跑
```

| 测试 | 守着什么 |
| --- | --- |
| `test/binding-audit.cjs` | 键位审计。复刻 `normalizeBinding` / `isWebBindingAllowed` / `bindingIssue` / `overlappingBindings`，断言所有「命令 × 档位」组合合法且与官方核心默认值零冲突，并带反向对照（`Ctrl+R`、裸 `Esc`、`Ctrl+C`、`Numpad0` 必须判非法） |
| `test/dictionaries.cjs` | 词典完整性。`zh` / `en` 键集完全一致、每个字面量 `t("key")` 都存在（宿主本地化不跨命名空间回退，缺键会把原始键名显示给用户） |
| `test/host-api.cjs` | 宿主 API 兼容。剥掉注释后只查活跃代码：不出现已移除的面、每个 `remote.<ns>` 都在 `inject` 声明过、`workspaces` / `shortcuts` / `sessions` **不在**硬门控数组里、`commands.execute` 首参是裸 Session id |
| `test/legacy-model-search.cjs` | 迁移兼容。真实加载 `client.js`、渲染设置页、按行调用 `onChange`，断言偏好文档里的 `modelSearch` 字段在每次整份重写后都完好保留 |
| `test/smoke.cjs` | 面板渲染与交互。夹具覆盖正常/归档工作区；断言行内下拉、按会话 id 下发 `/permission`、默认权限写入携带 revision、批量只作用于勾选行、归档会话不出现且跳过数被报告，以及折叠、分组、搜索、当前会话卡片 |
| `test/platform.cjs` | 双载体回归。以「无 `dataset.platform` 印章」（浏览器）与「有印章」（Desktop）两种页面加载真实 `client.js`，断言不装全局 `keydown`、Desktop-only 命令在 Web 下 `resolve` 返回 `blocked`、在 Desktop 下 `handled`，并在完全没有 `workspaces` 时仍能激活。另断言**确认卡片**：Desktop 下按键只开卡片、不发请求；`Esc`、取消按钮、点外框都能关掉卡片且始终零请求；点确认必须正好 POST 一次 `/api/permission-panel/restart`。再断言重启的**页面级幂等**与**错误容忍**：宿主已退出时 shell 的 `dsh-app://` 处理返回 `503`，算成功并**latch**（连按不再发请求，否则会弹「操作失败：HTTP 503」误报）；请求完全没拿到回应（fetch 抛错）则算**可重试**，解锁让下次确认再试，避免一次瞬时故障把快捷键永久弄哑；`409` 这类明确拒绝必须抛错、在卡片上报错并解锁。全部用 POST 次数观察，不依赖 toast 文案 |
| `test/locate.cjs` | 定位按钮。断言按钮只在有当前会话时出现、只展开所属分组、`scrollIntoView({block:"center",behavior:"smooth"})` 恰好指向该行；搜索/筛选遮住该行时先清掉再定位；确实不在列表时才出提示 |
| `test/filter.cjs` | 权限等级筛选。断言 chip 由实际等级推导、命中数正确、选「完全权限」只剩该等级行、搜索与筛选叠加为空时显示筛选空态 |
| `test/restart-route.cjs` | 宿主半边重启路由。断言 `inject` 只有 `webServer`、注册路径与 `client.js` 的 `RESTART_PATH` 一致、GET→405、非 loopback 与任何 forwarded 头→403、`sec-fetch-site: cross-site`→403、无 cookie→403、同源与 Desktop 转发形状→202；202 时**只起一个 detached 助手**（同二进制、`-e` 脚本、`windowsHide`、`ELECTRON_RUN_AS_NODE=1`）、载荷带主进程 PID 与重新拉起用的 env（且剥掉 `ELECTRON_RUN_AS_NODE`），并且**对父进程（Electron 主进程）发 `SIGKILL` 而不是退出自己**（退出自己会让 shell 弹崩溃框）；被拒的请求、`dsh web` 宿主（→409）与起助手失败（→500）都不许杀任何进程；无 Electron 运行时→500；`getOrigin()` 在监听前抛错时激活不崩且该形状被拒。最后一段把真实 handler 挂到真实 `http` server 上用 Node 自己的 `fetch` 按 shell 的方式转发（删 `host`/`origin`/`cookie`/`sec-fetch-site`、注入 cookie），因为只有这样才会暴露 undici 会把 `host` 从目标 URL 补回来这一事实——按「两个头都缺失」写的旧判据会让每一次真实重启静默 403。同时否定 `dshDesktopActions` / `dsh-desktop-mode` / `/api/desktop/restart` 这些不存在的旧信号 |

测试里的关键断言都做过**变异回退验证**：把实现改坏，用例必须真的失败。没被变异测试验证过的断言，就只是一句注释。

## 调试工具

```bash
node tools/verify-profile.cjs <profile>       # 插件确实作为一行进了组合树
node tools/verify-coexistence.cjs <profile>   # 与滑块插件共存、模型席位只有一个主人
node tools/probe-inject.cjs                   # 用真实 cordis 复现嵌套命名空间门控语义
node tools/mutate.cjs client.js .mut.js '<原文>' '<替换文本>'   # 变异测试
```

工具通过 `tools/dsh-install.cjs` 定位 DSH 安装目录：默认取各平台标准安装路径，可用 `DSH_INSTALL_DIR` 覆盖。注意 DSH 自己也用 `DSH_HOME`，但那指的是用户 profile 目录，不是安装目录。

## 为什么这样设计

挑出几条「看起来可以更简单、但其实不能」的决定，免得后来的人把它们「优化」回去：

- **按工作区分组，而不是按目录**：`workspace.sessionIds` 是注册表声明的归属关系，`cwd` 只是会话跑过的路径。按目录分组会把「在 A 目录启动、归档到 B 工作区」的会话放到错误的标题下，而那个位置上的批量操作会打错人。
- **默认折叠，但搜索时强制展开**：工作区多时一屏几十行反而看不见结构。折叠是默认视图，不是数据过滤——搜索命中必须可见，折叠组的已选数量必须可见。
- **选择范围永远等于可见范围**：搜索、归档、投影失败都会让行消失，批量条上的数字必须随之收缩。折叠是唯一例外：它只收起视线、不丢数据，但全局全选也只覆盖展开中的行。
- **「实际生效」只能来自宿主**：面板切换成功后写回的行值只是面板自己的记录，不能证明宿主在按什么策略执行，所以当前会话卡片走强制冷读，并在切换后再读一次。
- **读投影不等于开会话**：`retain()` 会实体化 scope 并打开历史。列表型功能必须用 `projections` 冷读，否则「看一眼所有会话的权限」会变成「把所有会话都打开一遍」。
- **按 id 下发命令，不要先拿 binding**：`sessions.binding(id)` 只返回已存在的 scope、从不创建；`remote.commands.execute(sessionId, …)` 走宿主按需恢复，未打开的会话是合法目标。
- **载体识别每次调用即时探测**，不在激活时缓存一次：Desktop 的 preload 在 `document.documentElement` 还不存在时会把 `dataset.platform` 印章推迟到 `DOMContentLoaded`，插件可能被热重载进一个印章还没落下的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- **载体信号只认 `document.documentElement.dataset.platform`**：这是 shell 无条件写给每个它拥有的页面的唯一标记。不要改用「preload 桥」或「URL 标记」——本插件曾假设存在一个 `dshDesktopActions` 桥与一个 `dsh-desktop-mode` 查询参数，实测 182MB 的 `app.asar` 里两者各有 0 命中，结果是快捷键在真实 Desktop 上永远走 `blocked` 分支、无声失效。
- **重启只能「从外部」做：杀 Electron 主进程 + detached 助手重新拉起**：Electron 主进程 `spawn` 了这个宿主子进程，`child.on("close")` 无论退出码是 0 还是非 0 都会走 `fail()` → `reportFatal()` → 官方崩溃恢复对话框；`app.relaunch()` 在生产代码里只有那个对话框的「重启」按钮一个入口，preload 没有重启通道、IPC 没有重启消息、`webServer` 没有重启服务。所以插件层不可能 in-process 重启，而是：① 起一个 detached 助手（同一 Electron 二进制、`ELECTRON_RUN_AS_NODE=1`、`stdio:"ignore"`、`windowsHide:true`、`-e` 内联脚本、载荷走环境变量）轮询主进程 PID；② 对**主进程**（本宿主的 `process.ppid`）发 `SIGKILL`——Windows 上是 `TerminateProcess`，不级联子进程，所以助手活得下来（`taskkill /T` 会连助手一起杀掉，绝不能用）；③ 主进程死后本宿主的 `process.once("disconnect")` 自行优雅退出，助手把应用重新拉起（去掉 `ELECTRON_RUN_AS_NODE` 再 spawn）。负责弹崩溃框的 shell 进程已死，因此**不出现任何对话框**。注意：不要用「自起一个 detached helper 重新跑宿主 argv」——那个 argv 是 Electron 给的宿主入口，自起会抢端口并变成游离的第二个宿主。**Windows Job Object 是这套方案唯一的暗礁，已实测探明**：真实 Electron 主进程持有 5 个 job（全带 `KILL_ON_JOB_CLOSE`），宿主子进程位于 `LimitFlags = 0x3C00` 那个；`SILENT_BREAKAWAY_OK` 让 job 成员 spawn 出来的助手自动脱离 job，所以 job 关闭时不会被连坐（用同标志 job 复现验证过：助手 `IsProcessInJob=false`，主进程被杀 + job 关闭后仍存活并拉起应用）。若将来 shell 换成不带 `SILENT_BREAKAWAY_OK` 的 job，这里会静默失效——这是必须知道的平台前提。
- **`dsh web` 下这条路由必须拒绝（409）而不是杀进程**：没有 shell 会把进程拉回来，关掉等于把服务关了再也起不来。
- **浏览器半边必须把 503 与「无回应」都当成功并 latch**：主进程被杀后页面多半收不到任何回应；即使 shell 的 `dsh-app://` 处理先回 `503`（`apps/desktop/lib/main.js` 的 `if (backend.host === void 0 …) return Response(null, {status: 503})`），语义上也是「重启正在进行」。把它当失败会在连按/长按时弹出「操作失败：HTTP 503」的假警报。配合 `restartApplication()` 的页面级幂等锁（成功与 503 都不清锁，因为页面马上会被重启拆掉），重复触发彻底安静。**请求完全没拿到回应（fetch 抛错）则相反，要解锁**：那也可能是一次瞬时网络故障，锁死会让快捷键永久失效，所以让它可重试；只有 `403`/`405`/`409` 这类明确拒绝才抛错并解锁（并在确认卡片上报错）。
- **重启前必须有一张确认卡片**：这是破坏性操作（正在跑的任务会被中断），快捷键按一下就重启太粗暴。卡片用纯 DOM 挂到 `document.body`（插件没有自己的 React 根可 portal），`Esc` / 取消 / 点外框都只关卡片、零请求；点确认才 POST。样式上用 `corner-shape:squircle` + 毛玻璃（`backdrop-filter`），不支持 `corner-shape` 的引擎靠 `@supports not` 退回普通 `border-radius`。
- **不要去改别人插件刷出来的 stderr 日志**：对话框若出现杂音，那既不在本仓库，也不是本插件的问题；本插件现在根本不进那个对话框。
- **Desktop 专有命令在 Web 下是「不声明默认键位 + `resolve` 拒绝」**，而不是渲染成灰色行：置灰会暗示别的含义，而这里缺的是宿主能力，不是用户权限。
- **迁移待办会话（`migration-required`）**：宿主此时可能只给缓存里的部分投影键，也许没有 `permissions`。面板把这类行保留为不可用（fail-open），不会因为读不到就把会话从列表里藏掉。
- **探测失败不静默**：面板侧的服务探测失败会打 `console.error` 并写入全局诊断槽，把「面板莫名空白」变成一行可读答案。
- **只有能真正改动的行才有勾选框**：给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择，数量与结果会对不上。
- **批量逐条顺序下发而非并发**：每个会话是一条独立命令，并发推进不了什么，却让「到底哪条失败」无法归因。
