# 开发

## 测试

```bash
npm test   # 无外部依赖，纯 Node 内置模块，8 个 test/*.cjs 串行跑
```

| 测试 | 守着什么 |
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
- **载体识别每次调用即时探测**，不在激活时缓存一次：插件可能被热重载进一个稍后才装上 preload 桥的页面，缓存住一次否定会让宿主本可提供的命令永久失效。
- **Desktop 专有命令在 Web 下是「不声明默认键位 + `resolve` 拒绝」**，而不是渲染成灰色行：置灰会暗示别的含义，而这里缺的是宿主能力，不是用户权限。
- **迁移待办会话（`migration-required`）**：宿主此时可能只给缓存里的部分投影键，也许没有 `permissions`。面板把这类行保留为不可用（fail-open），不会因为读不到就把会话从列表里藏掉。
- **探测失败不静默**：面板侧的服务探测失败会打 `console.error` 并写入全局诊断槽，把「面板莫名空白」变成一行可读答案。
- **只有能真正改动的行才有勾选框**：给不可用的行一个勾，等于让用户拼出一个 Apply 会悄悄跳过的选择，数量与结果会对不上。
- **批量逐条顺序下发而非并发**：每个会话是一条独立命令，并发推进不了什么，却让「到底哪条失败」无法归因。
