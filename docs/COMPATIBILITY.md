# 兼容性与安装细节

## 其他安装方式

`dsh plugin add` 只接受一个精确的包目标（本地路径、tarball、npm 包名走同一条命令），装完会自动把包写进该 profile 的 `dsh.profile.bundles`。

```bash
# 从本地源码目录安装（开发用，改完重启即生效）
dsh plugin --profile <profile> add "link:<本仓库绝对路径>"

# 从 tarball 安装（不带源码，最干净）
npm pack
dsh plugin --profile <profile> add "file:<绝对路径>/dsh-permission-panel-<version>.tgz"
```

`--profile desktop` **只被 DSH Desktop 自带的 `dsh` 接受**：普通 `@deepseek-ai/dsh` 会报 `profile "desktop" is managed exclusively by the Electron application`。

## package.json 里几个字段的含义

这几个字段常被误读，写清楚免得改动时踩坑：

- `dsh.client.platform` 固定为 `"web"`：这是**唯一合法值**（Desktop 自身也声明 `"web"`）。它描述的是浏览器半体的运行环境，与 Web/Desktop 载体无关——双载体支持由运行时识别完成，不是靠这个字段。
- `dsh.client.inject` 只是**信息性**的包名依赖边（用于工厂到达顺序与 HMR diff），**不是激活门禁**。真实依赖由插件顶层 `inject` 与 `ctx.inject()` 决定。
- `peerDependencies`（`react` / `react-dom`）是可选提示；profile 默认 `autoInstallPeers: false`，宿主已自带 React 18，不会多装一份。
- `engines.node` 跟随 DSH Desktop 的要求（`^22.19.0 || >=24.0.0`），未启用 `engine-strict`，只作提示。

## 宿主半边（`index.js`）

面板全部在浏览器半边（`client.js`），但「重启 DSH」需要宿主侧承接一步：`index.js` 顶层声明 `inject = ["webServer"]`（硬依赖，官方服务，无新增 npm 依赖），并在 `apply(ctx)` 里注册一条精确路由：

| 项 | 值 |
| --- | --- |
| 方法 / 路径 | `POST /api/permission-panel/restart` |
| 来源校验 | 对端必须是 loopback；拒绝 `forwarded` / `x-forwarded-for` / `x-real-ip`；`sec-fetch-site: cross-site` 拒绝；**两种形状都要求带非空 cookie**。`origin` 缺失时视为 Desktop 代理转发形状，另要求 `host` 等于本服务自己的 `getOrigin()` authority（`#648` 会剥掉 `origin`，转发用的 Node `fetch` 会由 undici 从目标 URL 把 `host` 补回来；cookie 则是 `forwardWebRequest` 无条件注入的）；`origin` 存在时要求 `host` 与它同源。cookie 不是认证（本机进程可以伪造任何头），但这条路由注册为 `exact`，`match()` 先查 exact 表、不走 `/api` 前缀的统一认证栅栏，要求 cookie 至少让裸 `curl -X POST` 或只设 `Origin` 的探测打不下来；能执行本地代码的进程本就能直接杀进程，这是所有 loopback-only 护栏的共同上限 |
| 成功响应 | `202 {ok:true, restarting:true}`，随即先发一条宿主 IPC `{type:"fatal", message: <权限面板的说明>}`，再 `setTimeout(() => process.exit(0), 250)` |
| 非 Desktop 宿主 | `409`，且**不**退出进程、不发 `fatal`（`dsh web` 下没有 shell 能把服务拉回来） |
| 其它 | 非 POST → `405`（带 `allow: POST`）；未通过来源校验 → `403` |

那条 `fatal` 是为了对话框的 detail 可读：宿主只是退出时，shell 把 `dsh desktop host stopped` 与**本进程 stderr 的尾巴**拼成 detail，而 stderr 尾巴常常是别的插件最后打的一条日志（例如某插件每次启动都刷的一串告警），看上去像本插件崩了。`DesktopHostProcess.fail()` 有 `failureReported` 幂等锁，先到的 `fatal` 生效，所以主动报一句人话即可——对话框本身、默认「重启」按钮、崩溃报告与 `app.relaunch()` 全不变；`process.send` 不存在时静默跳过，重启照常。

为什么是「退出宿主」而不是「调用某个重启 API」：DSH Desktop 的 Electron 主进程 `spawn` 了这个宿主子进程，`child.on("close")` 无论退出码 0 还是非 0 都会进 `fail()` → `reportFatal()` → 官方恢复对话框，其默认按钮「重启」执行 `app.relaunch(); quitWithoutConfirmation()`。生产代码里 `app.relaunch()` 只有这一个入口——preload 无重启通道、IPC 无重启消息、`webServer` 无重启服务（`app.asar` 全盘字节扫描 `dshDesktopActions` / `dsh-desktop-mode` / `desktop/restart` 均 0 命中）。所以这条路由与官方「禁用第三方插件并重启」以及社区插件管理器的 `shell` 模式同构。浏览器半边据此判断载体：只认 `document.documentElement.dataset.platform`（Desktop preload 无条件写入），不存在所谓 preload 重启桥或 URL 标记。

**浏览器半边对 503 的容忍**：宿主已经退出时，shell 的 `dsh-app://` 协议处理会直接返回 `503`（`apps/desktop/lib/main.js`：`if (backend.host === void 0 …) return Response(null, {status: 503})`），这在语义上是「重启已经在进行」，所以 `desktopAction()` 把 `503` 当作成功，只有 `403`/`405`/`409` 这类明确拒绝才抛错。`restartApplication()` 另有一个页面级幂等锁：第一次按下后 `restartPending` 置位，`503`/成功的路径**不清锁**（页面马上会被 relaunch 拆掉），因此连按、长按重复触发都不会再发第二次请求——否则第二次必然撞上 503，弹出「操作失败：HTTP 503」这种误报。而**请求完全没拿到回应（fetch 抛错）时反而要解锁**：那既可能是宿主已走出，也可能只是一次瞬时故障，锁死会让快捷键永久失效；真正的拒绝与无回应都清锁，让下一次按键还能重试。

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
- **硬门控 vs 软门控**：`inject` 数组里的名字是硬要求，服务缺失会让插件永远停在 PENDING；嵌套的 `ctx.inject([...], …)` 是软要求，回调不执行，只有依赖它的功能降级。因此 `shortcuts` 这类可选服务一律走软门控；归档集合读不到时失败开放为**空集合**（多显示一行归档会话无害，少显示一行正常会话才是 bug），工作区流断开时面板退化为平铺列表，行不会消失。
- **`catalog.options` 与 `catalog.defaultOptions` 是两个字段**：前者是当前全部可选预设（含仅当前会话可用的 `auto`），后者才是可作为新会话默认的子集。默认权限那一行读后者；两者混淆会让下拉里出现不能当默认的值。

## 迁移与兼容契约

- **从 `dsh-hotkey-toolkit` 改名而来**：包名、Loader 行 id、客户端模块 id、字典命名空间、`settings.section` 行 id、快捷键命令 id 全部改为 `dsh-permission-panel` / `permissionPanel.*`。profile 里若还留着旧包，先 `dsh plugin --profile <profile> remove dsh-hotkey-toolkit` 再装新包，避免两行同时挂载、两个设置页同时出现。
- **`modelSearch` 只写不读地透传**：可搜索的模型菜单已迁到 [dsh-client-ui-effort-slider](https://github.com/Kirito787/DSH-Claude-Style-Reasoning-Slider)——两个插件注册的都是 `conversation.input.model` 这一格位，而槽位对遮蔽型席位是「单选」语义，同时注册只会互相遮蔽，胜负取决于加载顺序。本插件的偏好文档仍保留 `modelSearch` 字段但不再读取。之所以必须保留：`update()` 每次都用整份快照重写文档，若顺手丢掉该字段，用户下一次拨动任意快捷键开关就会把旧选择抹掉，而滑块插件那时未必已经读过它。`test/legacy-model-search.cjs` 守着这条契约。
- **旧版载荷容忍**：更早写入的 `{ enabled, refresh, restart, modes }` 会被识别并忽略未知字段；`shortcuts` 逐键合并，缺失的键取默认（开）；非布尔的脏值不会被带进后续写入。
