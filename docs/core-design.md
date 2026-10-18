# Core 设计：分层、端口与插件化

状态：**提案**（2026-10-18）；待 §9 的 Q1–Q3 裁决，裁决前不建票、不动代码。
配套：`docs/adr/0003-layered-core-seams.md`；产品范围见票 11 的裁决；数据模型见 `spec.md` §5；宿主事实见 `docs/agents/harness-facts.md`。

本文用 `codebase-design` 的词表，并严格按该词表说话：**module**（模块：一个接口＋一份实现，尺度不限）、**interface**（调用方必须知道的一切：类型、不变量、顺序、错误、配置、性能）、**implementation**、**depth**（接口上的杠杆：小接口藏大行为）、**seam**（可以替换行为的位置）、**adapter**（填缝的具体实现）。不用「组件 / 服务 / API / 边界」替代这些词。

「插件化」在本设计里指两件事：**可替换的 adapter**（provider / writer / port）与**单向的层依赖**。它不等于运行期加载器；运行期插件加载只留给「第三方 provider」这一真实需求。

## 0. 结论

1. **插件单位是 bundle，不是层。** 宿主只安装一个 Cordis bundle（`dsh-plugin-agents-manager`）；包内六层按 module + seam 隔离。把每层做成 Cordis 插件会过早冻结一份还没被消费验证的服务接口，v1 不做。
2. **六层**：`contract`（types only）、`core`（目录 / 编排 / 写面）、`providers`（来源与写入适配器）、`dsh`（宿主 / 浏览器连接器）、`ui-core`（界面核心）、`ui-react`（React 组件库）。依赖单向指向 `contract`；**宿主翼与界面翼不共享实现，只共享 `contract`**（wire 是它的投影）。
3. **四个深模块（catalog 计作一族）**：
   - `core/catalog`：01/02 冻结的两个读面（4 ＋ 5 成员），继续作为目录查询接口；
   - `core/orchestrator`：**新**，接口 1 个方法 `prepare(agentName, options?)`，藏「解析 → 组装 → 工具/能力检查 → 归一化警告」的顺序与 provenance；07 消费，11 可选消费；
   - `core/control`：11 票冻结的 6 成员写面与组合视图；
   - `ui-core/session`：界面侧唯一状态机，接口 4 成员，藏加载、草稿、保存、冲突、取消、过期响应。
4. **Provider 先做端口 ＋ 静态装配。** 现有真实两适配器的缝：fs（Node / host）与 writer（Node 原子写 / 内存）。`AgentSource` 先一个文件系统适配器 ＋ 多配置（5 个根），**不为它造注册表**；第一个非文件来源（装配源 / 跨 harness）出现时再升级。
5. **物理形态先单包分层**（维护者裁决「初期可以只按层隔离」）。拆 workspace 包由具体构建 / 复用触发（§7），不按日期。

### 0.1 用户词与落点

| 用户词 | 设计落点 |
| --- | --- |
| 编排服务 | `core/orchestrator`（内部缝 `core/resolve` / `core/assemble`） |
| DSH 连接器 | `dsh/host`（Cordis 入口 / 服务 / routes / sinks）＋ `dsh/client`（`settings.section` / 浏览器入口） |
| 用户界面核心 | `ui-core`：`AgentDocPort`、`SettingsSession`、view models、内存 / HTTP 适配器 |
| 用户界面 React 组件库 | `ui-react`：pane / 编辑器 / 基础控件 ＋ CSS |
| 各种 Provider | `providers`：`AgentSource` / `ModelLayerSource` / `DefinitionWriter` 的适配器；运行期注册见 Q2 |
| （设计新增）契约 | `contract`：两翼共享的数据形状 |

### 0.2 四条端到端流（验证分层闭合）

1. **读取与列表**：`providers` → `core/catalog` → `core/control.snapshot`（含可选 resolution view）→ `dsh/host` route → `ui-core` session → `ui-react` panes。
2. **目录注入（06）**：`core/catalog` → `core/catalog-injection`（纯渲染 ＋ digest）→ `dsh/host` pre-step sink（last-digest / offered message id 留在连接器）→ 主 Agent 上下文。
3. **召唤（07）**：`dsh/host` tool → `core/orchestrator.prepare` → `core/resolve` ＋ `core/assemble` → `PreparedAgent` → 连接器翻译成 `ctx.subagents.start` 的 request；链耗尽 → tool `isError`。
4. **编辑（11/12/05）**：`ui-react` → `ui-core` session → `AgentDocPort`（HTTP）→ `dsh/host` route → `core/control` → `providers` writer；逐文件结果回写 session，冲突保留草稿。

## 1. 约束（设计输入）

- **安装面**：`plugin_manager install_bundle` 装的是目录；bundle 运行时不能依赖 `workspace:*` 或未发布的兄弟包，沙箱内也不做依赖变更（`docs/agents/harness-facts.md`）。
- **import 面**：ADR-0001 —— 运行期不得 import `@deepseek-ai/*` 宿主包；宿主服务只按形状结构读取。这条边界是分层的前提，不是可以商量的风格问题。
- **冻结面**：01/02 的读面、11 的 6 成员、12 的 wire 形状。本设计只改**落位**，不改语义；新形状进 `contract`，不改冻结文件里的旧类型（票 11 已如此要求）。
- **浏览器面**：`ui-core` / `ui-react` / `dsh/client` 不得 import `node:*`、`core`、`providers`；React 只出现在界面翼。
- **产品面**：v1 只支持标准 Agent 文件（单文件 body），不引入切片 / 装配源 / 跨 harness / 动态模式。这些是未来的 provider 与 format 扩展，**v1 不建空壳**。

## 2. 层图与依赖规则

```
宿主翼（Node / Cordis）                          界面翼（浏览器 / React）
──────────────────────────                       ──────────────────────────
dsh/host                                         dsh/client
  ├─▶ providers ──▶ core                           ├─▶ ui-react ──▶ ui-core
  └─▶ core                                         └─▶ ui-core
        │                                                  │
        └──────────────────┬───────────────────────────────┘
                           ▼
                     contract（types only）
```

| 层 | 可 import | 禁止 | 备注 |
| --- | --- | --- | --- |
| `contract` | 无（TS 类型与字面量常量） | 任何运行时 import | 环境中立，浏览器可安全引用 |
| `core` | `contract` | `providers`、`dsh`、`ui-*`、`node:fs` 直接（走端口）、React | 可用 `node:path`；I/O 一律经端口 |
| `providers` | `contract`、`core` 的 ports 子入口 | `dsh`、`ui-*` | 只做 I/O 适配，不含领域规则 |
| `dsh/host` | `contract`、`core`、`providers` | `ui-*`、`node:fs` 直接（走 providers） | 唯一可 `import type` Cordis 的宿主层 |
| `ui-core` | `contract` | `core`、`providers`、`dsh`、React / DOM | 浏览器安全；fetch 作为注入端口 |
| `ui-react` | `contract`、`ui-core` | `core`、`providers`、`dsh` | 纯 props；只有页面 / hook 碰 session |
| `dsh/client` | `contract`、`ui-core`、`ui-react` | `core`、`providers`、`dsh/host`、`node:*` | 唯一懂 `settings.section` 与 client slots 的层 |

规则：

1. **跨层只准走对方声明的 public entry**（`index.ts`，或显式列出的子入口，如 `core/ports.ts`）；层内可以深 import。这条用 `scripts/check.mjs` 的 import 矩阵强制执行（含自测），不靠自觉。
2. **`import type` 也算依赖**，按上表判定；唯一例外是 `dsh/host` 对 `@deepseek-ai/*` 的类型引用。
3. **禁止 `common/`、`utils/`、`shared/` 垃圾抽屉**：共享代码必须属于某个 module，并由该 module 的接口解释。
4. **禁止跨翼 import**（`core`/`providers` ↔ `ui-core`/`ui-react`）；两翼只通过 `contract` 里的 DTO 对齐。
5. `src/index.ts` 保持为 bundle 入口（`package.json` 的 `main` 不变），内部 re-export `dsh/host` 的 `apply`；它属于连接器层，不承载领域逻辑。

## 3. 各层设计

### 3.1 `contract`

**内容**：只放**跨翼共享**的形状——现有冻结类型（`AgentDefinition`、`AgentRegistry`、`AliasRegistry` 及其诊断 / findings）＋ 控制面 DTO（`ControlSnapshot`、`ComposedAgentDocument`、`DocumentEdit`、`WritePlan`、`WriteReport`、`RegistryEdit`，11 票）＋ 跨翼信号视图（归一化 `Warning`、`resolution view`，`snapshot` 要用）。12 票的 wire 是这些类型的 HTTP 投影，不另造第三份形状。

**不进 `contract`**（留在拥有它的 module）：`PrepareOptions` / `PreparedAgent` / `ResolutionResult` / `AssemblyPlan` / `ToolPlan`（宿主翼内部，`core/orchestrator` 拥有）；`AgentSource` / `ModelLayerSource` / `DefinitionWriter` / `HostPorts` 端口（**缝由消费方拥有**，分别归 `core` 与 `dsh`）；`SettingsState` / `SettingsAction` / `AgentDocPort`（`ui-core` 拥有，`ui-react` 从 `ui-core` 取）。

**接口不变量**：

- 无 I/O、无环境 API、无 React / DSH import，types only；
- **一概念一形状**；`AgentDiagnostic` 与 `AliasFinding` 分族保留，归一化视图只做带 `origin` 的联合，不合并成一个 `Finding` 模型（11 票的教训）；
- 编辑类类型必须携带原文 / 原块信息，保证 D14 回写；展示串不得进入 `file` 一类字段；
- 新类型只有在**至少两个 module**消费时才进 `contract`，否则留在定义它的 module 里；
- **运行期校验不进 `contract`**：control 的编辑校验归 `core/control`，HTTP 请求校验与上限归 `dsh/host` 的 route（12 票），contract 只描述形状。

**删除测试**：删掉 `contract`，宿主与界面各造一套形状（原型已经发生过数据形状漂移），wire 也会长出第二份。

### 3.2 `core/catalog`

保留两个冻结接口：

```ts
interface AgentRegistry {          // ctx.agentRegistry
  list(options?): Promise<readonly AgentDefinition[]>
  get(agentName, options?): Promise<AgentDefinition | undefined>
  diagnostics(options?): Promise<readonly AgentDiagnostic[]>
  invalidate(): void
}
interface AliasRegistry {          // ctx.aliasRegistry
  snapshot(options?): Promise<AliasRegistrySnapshot>
  getAlias(aliasName, options?): Promise<AliasDefinition | undefined>
  getModel(modelName, options?): Promise<ModelDefinition | undefined>
  diagnostics(options?): Promise<readonly AliasDiagnostic[]>
  invalidate(): void
}
```

内部由 `createAgentCatalog({ sources, fs?, warn }, options)` 与 `createModelCatalog({ layers, defaultPair, fs?, warn }, options)` 组装；两个服务面只是这些 module 的薄壳。

**内部缝**（不进跨层接口，供自带测试）：`scanAgentSources`、`classifyEntry`、`parseAgentDocument`、`readRegistryLayer`、`mergeLayers`、`inspectAliasRegistry`、`createLazyLoad`。

**接口不变量**（沿用 01/02 的冻结语义，重构不得改变）：

- 首次查询按 project root 扫描并记忆化；失败不缓存；并发查询共享 in-flight；
- 无 watcher，`invalidate()` 是唯一刷新点；
- rank 低者胜，整层合并 / 整层弃用，绝不半合并；
- 受信根（bundled）的坏文档是硬错误，其余是软诊断数据；
- `diagnostics()` 与 `list()` 来自同一次扫描；
- 目录排序稳定（rank 升序，再按名称）。

**删除测试**：没有它，providers 与连接器会各自解析 / 合并 / 判定信任，冻结语义分叉。

### 3.3 `core/orchestrator`（编排服务）

这是宿主侧新增的深模块，也是「编排服务」的落点：

```ts
interface Orchestrator {
  prepare(agentName: string, options?: PrepareOptions): Promise<PreparedAgent>
}

interface PrepareOptions {
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly flavor?: 'spawn' | 'fork'          // 调用点覆盖 agent.md 的默认
  readonly capability?: RuntimeCapability      // 调用方（07）能兑现的能力
}

interface PreparedAgent {
  readonly agent: AgentDefinition
  readonly flavor: 'spawn' | 'fork'
  readonly resolution: ResolutionResult        // ok | failed（链耗尽等，不 throw）
  readonly assembly: AssemblyPlan              // 04 的规划器输出
  readonly tools: ToolPlan                     // 过滤结果＋缺失的 requiredTools
  readonly warnings: readonly Warning[]        // origin: agent | model | runtime
}
```

**藏起来的行为**（顺序固定，provenance 始终在）：

1. 从 `AgentRegistry` / `AliasRegistry` 读一次快照；
2. 链解析（03）：`modelOrder` 别名展开、`available:false` 跳过、raw `model:` 兜底、白名单、effort 优先级；
3. 组装规划（04）：节列表、通道、缓存断点；
4. 工具检查（06 的数据面）：`requiredTools` 与 effective tools 的差集；
5. 能力降级：`capability` 不满足 persona / toolFilter / depth 时的降级项；
6. 归一化警告：三族信号映射成统一视图，保留原始 code 与来源。

**接口不变量**：

- **域结果是数据，不是异常**：链耗尽返回 `resolution.ok=false`，07 映射成 tool `isError`；只有 catalog 的意外 I/O 才 throw。理由：11 的 `snapshot` 要展示链错误而不能被 try/catch 绑架，DSH 的 isError 语义在连接器边界兑现。
- 确定性：同样输入（catalog 快照、policy、channels、capability）⇒ 同样输出；
- 一次 `prepare` 只读一次 catalog 快照，绝不跨调用拼接半新半旧的状态；
- 绝不发明 provider/model 对；绝不隐藏诊断；警告顺序稳定；
- 不写盘、不碰 `ctx`、不注册副作用。

**依赖**：`AgentRegistry`、`AliasRegistry`、`ModelPolicy`（路由白名单）、`ChannelConfig`、`RuntimeCapability`，全部构造期注入。

**内部缝**：`resolveChain`（03）、`planAssembly`（04）、`normalizeWarnings`；纯函数，各自有直接测试，但不从 `core/index.ts` 对外暴露。`PrepareOptions` / `PreparedAgent` / `ResolutionResult` / `AssemblyPlan` / `ToolPlan` 只属于宿主翼，定义在 `core`，不进 `contract`。

工具差集不藏在 orchestrator 里：它同时被 06（目录警告）与 orchestrator（召唤前检查）消费，落成一个小 module `core/tool-capability`（接口只有「输入 requiredTools ＋ effective tools，输出缺失列表」），06 因而**不需要**依赖 03。

**删除测试**：删掉它，07 与 11 会各自重排「解析 → 组装 → 警告」并重造 provenance；而 06 **不**消费它（06 只依赖目录与工具检查，不能因 03 未落地而受阻），所以它只对 07 / 11 承担杠杆。

**消费关系**：

- 07：`prepare` → 连接器把 `PreparedAgent` 翻译成 `ctx.subagents.start` 的 request；
- 11：作为**可选**依赖注入 control（`ControlDeps.orchestrator?`）；03 未落地时 `snapshot` 显式标注「链解析待 03」，不自行实现平行解析器。

### 3.4 `core/control`

接口与语义以票 11 为准（6 成员：`snapshot` / `compose` / `plan` / `commit` / `applyRegistryEdit` / `invalidate`），此处只定它在分层里的位置与不变量：

- 依赖：两个 catalog、可选 `Orchestrator`、`DefinitionWriter`、唯一的序列化实现；
- `compose` 返回域形状（无编辑器偏移）；`plan` 是纯函数（同输入同输出）；`commit` 逐文件原子写、写后重校验、覆盖冲突返回明确错误；`applyRegistryEdit` 把层解析 / 删除回退 / 路径推导全部藏住；
- 只写由 catalog / 层文件推导出的路径，**绝不接受请求里的任意路径**；`agentName` 先验证再拼路径；
- 多文件保存**不是事务**：返回逐文件结果，失败可重试，不承诺回滚（写进接口文档，UI 文案据此）；
- 全仓只有一份 frontmatter 模型、一份序列化、一份块 → 文件路由；D14 往返是接口不变量（注释 / 未知键 / 键序保留）。

**删除测试**：删掉它，12 的 route 会重新发明组合与写路由（原型已经在客户端做过一次），第二份形状必然漂移。

### 3.5 `providers`

**端口**（定义在 `core`，由本层实现）：

```ts
interface AgentSource {
  readonly id: string
  readonly root: string
  readonly rank: number
  readonly trust: 'trusted' | 'untrusted'
  listEntries(options?): Promise<readonly SourceEntry[] | undefined>   // undefined = 根本不存在
  readDocument(agentName, options?): Promise<SourceDocument | undefined>
}

interface ModelLayerSource {
  readonly id: AliasRegistrySource        // 'project-dsh' | 'user-dsh'
  read(options?): Promise<RegistryLayerRead | undefined>
}

interface DefinitionWriter {
  replaceText(path, text): Promise<void>   // 逐文件原子；0600
}
```

**适配器**：

| 端口 | 适配器 | 说明 |
| --- | --- | --- |
| `AgentFileSystem` | Node fs | 无宿主 `fs` 服务时的回退 |
| `AgentFileSystem` | host `ctx.fs` | 沙箱 / 远端工作区，按 `optionalFileSystem` 形状结构读取 |
| `AgentSource` | 文件系统源（4 个用户根配置） | project `.dsh` / `.agents`、user `$DSH_HOME` / `$DSH_AGENTS_HOME` |
| `AgentSource` | 内置源（bundled） | 同一工厂＋Node fs＋`trusted`，走自己的资产 |
| `ModelLayerSource` | 文件层 | workspace / user 两个配置 |
| `DefinitionWriter` | Node 原子写 | temp ＋ rename；测试用内存适配器 |

**接口不变量**：

- 不认识 `process.env`，只收绝对路径；env / home 解析留在 `core`（纯函数）或连接器（选择配置）；
- 缺席是 `undefined`，不是 throw；意外 I/O 错误原样上抛，由 core 决定信任语义；
- **不做分类 / 排名 / 合并 / 保留字判断**——那些是 core 的领域规则；
- writer 是纯 sink：只负责原子替换；冲突检测的原文读取走 `AgentFileSystem`（不造第二条读路）；
- writer 的原子性是适配器不变量；`plan` 不依赖它，`commit` 依赖它。

**命名**：Provider ＝ 来源适配器。连接器里的副作用面叫 **sink**（system prompt 节、pre-step、tools、subagents、web routes），不叫 provider；LLM provider（DeepSeek / OpenAI…）在本项目里只是字符串，R1/R2 研究的是它们的关联，不是本层。

### 3.6 `dsh`（连接器）

**host 入口** `apply(ctx)`：

1. 从 `ctx` 取端口：`fs`（按用时解析）、`agentDefaultModel` 默认对（按用时）、`warn`；
2. 选 provider 配置（根 / rank / trust / bundled 目录），构造 catalogs、orchestrator、control；
3. `ctx.effect(() => ctx.provide('agentRegistry', …))`、`aliasRegistry`（冻结 key）；其余深模块**不** provide（除非 Q1 裁决）；
4. 注册 sink：04 的 system prompt 节（persona 委托原生 `deployment:persona-prefix`，不重复发明）、06 的 pre-step digest（last-digest / offered message id 等会话状态留在连接器，core 只渲染条目与算哈希）、07 的 tool ＋ `subagents.start`、12 的 `ctx.webServer` exact route；每个注册都包在 `ctx.effect` 里，卸载即撤；
5. 能力门控：把 `capability` 传给 orchestrator；07 的 request 翻译与 isError 回显都在这里；
6. 错误翻译：401/404/409/5xx（12 票）、链耗尽（07）、能力降级（警告）。

**端口形状**（连接器拥有的适配器面，不进 `contract`）：

```ts
interface HostPorts {
  fs(): AgentFileSystem | undefined          // ctx.get('fs')，按用时解析
  defaultPair(): AgentModelTarget | undefined // ctx.get('agentDefaultModel')
  warn(message: string): void
  sinks: RuntimeSinks                        // 04/06/07/12 的副作用面，形状由各票拥有
}
```

`ctx.fs` 的结构读取留在 `dsh/host`，包装成 `AgentFileSystem` 的函数在 `providers`——连接器不做领域包装。

**client 入口**：注册 `settings.section` 整页，构造 HTTP `AgentDocPort`（12 的 wire），创建 session，渲染 `<SettingsPage session={…}>`；加载 / 失败 / 重试状态在这一层兜底。

**接口不变量**：

- 唯一可以 `import type` DSH 的层；运行期零 `@deepseek-ai/*` import；
- 宿主服务按用时结构读取（`ctx.get`），绝不在 `apply` 时捕获（01 修复轮的教训）；
- 只有映射、能力门控、错误翻译、生命周期，**没有领域规则**；删掉连接器，core 仍可完整测试；
- 每个端口在测试里都有 fake；连接器自己的测试用假 `ctx`（`test/plugin.test.ts` 的形状），不要求真实 profile。

**删除测试**：删掉它，core 在 DSH 里不可用，但它的接口仍然成立——这正是 adapter 的职责，不追求深度。

### 3.7 `ui-core`（界面核心）

**文档端口**（12 票 wire 的投影；内存与 HTTP 两适配器）：

```ts
interface AgentDocPort {
  snapshot(options?): Promise<ControlSnapshot>
  compose(agentName, options?): Promise<ComposedAgentDocument>
  plan(edits, options?): Promise<WritePlan>
  commit(edits, options?): Promise<WriteReport>
  applyRegistryEdit(edit, options?): Promise<WriteReport>
  invalidate(options?): Promise<void>
}
```

**状态机**（界面侧唯一深模块）：

```ts
interface SettingsSession {
  readonly state: SettingsState
  subscribe(listener: (state: SettingsState) => void): () => void
  dispatch(action: SettingsAction): void
  dispose(): void
}
```

**藏起来的行为**：加载 / 刷新的单飞与过期响应丢弃（generation guard）、按 agent 保存草稿、脏判定、`plan → commit` 的保存流程、冲突时保留草稿、切换 agent 的未保存策略、400/404/409/5xx 的 typed error 映射、在途请求取消（AbortSignal）、`invalidate` 后对账。

**接口不变量**：

- 不 import React / DOM / DSH / core；`fetch` 作为构造参数注入；
- 同一查询同时只有一个在途加载；过期响应按 generation 丢弃，不覆盖新状态；
- 保存只经 `AgentDocPort`；组件不得直接 fetch；
- **不重算宿主语义**：层合并、链解析、块 → 文件路由都不在这里（原型的三处 `available` 断言是反例）；
- `dispose()` 之后不再发状态、不再发请求。

**内部缝**（纯函数，各自测试）：`reduce(state, action)`、`selectAgentList`、`selectRegistryView`、`buildEditorModel`（块视图 / 行号 / 折叠 / dirty）、`selectAdvisor`、`computePaneLayout`、`mapPortError`。

**删除测试**：删掉它，异步、过期、草稿、冲突逻辑会退回组件（原型的 `App.tsx` 三个内存 map 就是证据）。

### 3.8 `ui-react`（组件库）

**内容**：`MasterDetailPane`、`AgentListPane`、`AgentDocumentEditor`、`ModelLinksPane`、`RegistryPanel`、`AdvisorPanel`、`SettingsPage`、基础控件与 CSS。

**接口契约**：

- pane 组件只收**只读 view model ＋ 回调**（`state` 切片、`onAction`）；不 import session / adapter / port；
- 只有 `SettingsPage`（及其 `useSettingsSession` hook）接触 `SettingsSession`：`subscribe` ＋ `dispatch`，用 `useSyncExternalStore` 绑定；
- 编辑器允许持有**纯 UI 临时态**（光标、滚动、折叠），文档 / 脏 / 保存状态全部来自 props；
- 无 fetch、无定时器、无 localStorage、无领域计算；主题 token 用 CSS 变量并带 fallback；交互元素带稳定 `data-*` 供 13 的组件测试。

**诚实的说明**：这是全系统最浅的一层（props 接口几乎就是它的实现规模）。这是刻意的——深度在 `ui-core`；把领域逻辑推进组件只会让测试面变成 DOM，并重现原型的泄漏。

## 4. 缝清单（真缝 vs 假想缝）

| 缝 | 接口 | 现有适配器 | 判定 |
| --- | --- | --- | --- |
| 文件系统 | `AgentFileSystem` | Node fs / host `ctx.fs` | 真缝（2），保留 |
| 定义来源 | `AgentSource` | 文件系统（多根配置）/ 内置（trusted＋Node fs） | 真缝（后端＋信任两维），但**一个工厂**；不建注册表 |
| 模型层 | `ModelLayerSource` ＋ default pair 端口 | workspace / user / 内置对 | 真缝（3 配置＋1 非文件） |
| 写入 | `DefinitionWriter` | Node 原子写 / 内存 | 真缝（2），测试与未来远端 |
| 文档端口 | `AgentDocPort` | 内存 / HTTP | 真缝（2），12/13 已定 |
| 宿主环境 | `HostPorts` | 真 `ctx` / 测试 fake | 真缝（2） |
| 定义格式 | `DefinitionFormat` | 仅标准 Agent 文件 | **假想缝**：v1 不建接口；跨 harness 落地时再开 |
| 运行期 provider 注册 | — | 无 | **不做**（Q2） |

一个适配器只是假想缝；上表里没有第二个适配器的，都不建接口、不建空壳。

## 5. 深度审计

| module | 接口规模 | 藏住的行为 | 删除测试 | 判定 |
| --- | --- | --- | --- | --- |
| `contract` | types only | 形状 / 分族 / wire 对齐 | 两翼各造一套形状 | 必要，非行为模块 |
| `core/catalog` | 4＋5 成员（冻结） | 发现、解析、rank、信任、懒加载、诊断 | 解析与合并分叉 | 深（已冻结） |
| `core/orchestrator` | 1 方法 | 解析→组装→检查→provenance | 07/11 各自重排 | 深（本设计新增） |
| `core/control` | 6 成员 | 组合、写计划、原子写、registry 编辑 | route 重造写路由 | 深（11 冻结） |
| `providers` | 4 个端口 | I/O 差异（fs / 信任 / 原子性） | 每个来源在 core 里长分支 | 适配器层，不追求深 |
| `dsh` | 2 个入口 | DSH 映射、能力、生命周期 | core 不可用但仍可测 | 适配器层，不追求深 |
| `ui-core/session` | 4 成员 | 加载/草稿/保存/冲突/取消 | 逻辑退回组件 | 深（本设计新增） |
| `ui-react` | props | 无（只做渲染） | 组件库消失、页面内联 | 刻意浅 |

## 6. 测试策略（接口即测试面）

- **`contract`**：只由 `tsc` 保护；类型测试不进运行时。
- **`core`**：纯函数用假 catalog / 假 fs；catalog 用临时目录做一层薄集成；orchestrator 用固定快照断言确定性、顺序、provenance；control 用内存 writer 断言 D14 往返与冲突（11 票）。
- **`providers`**：同一套 adapter 契约套件跑 Node fs 与假 host fs；writer 套件跑 Node 与内存（含失败注入）。
- **`dsh`**：假 `ctx`（服务 / logger / webServer / subagents）断言注册、撤销、能力降级、错误翻译；`test/plugin.test.ts` 保留为安装点证明。
- **`ui-core`**：session 状态转移用内存 port；同一套用例再跑 HTTP 假 port（13 票的适配器契约套件）；不 mock 内部函数。
- **`ui-react`**：jsdom ＋ testing-library，只断言渲染与用户可见行为；不碰组件内部 state。
- **守卫**：`scripts/check.mjs` 增加 import 矩阵判定 ＋ 自测；锚点、`hostRuntimeDeps`、`build` 新鲜度照旧。

## 7. 物理形态与升级触发

### 7.1 目标目录（单包）

```
src/
  index.ts                 # bundle 入口：re-export dsh/host 的 apply
  contract/                # types only
  core/
    catalog/               # 01/02 的模块
    resolve/               # 03
    assemble/              # 04
    control/               # 11
    orchestrator.ts        # 编排服务
    ports.ts               # fs / source / writer 端口
  providers/               # fs、source、writer 适配器
  dsh/
    host/                  # Cordis 入口、services、routes、sinks
    client/                # settings.section 入口（12 之后）
  ui-core/                 # port、session、view models（12 之后）
  ui-react/                # 组件库（05/13）
test/                      # 按层镜像；适配器契约套件单列
```

`tsconfig.json` 现在 `include: ["src", "test"]`；界面文件落地时加 `tsconfig.client.json`（JSX／DOM lib），宿主构建排除 `src/ui-*`、`src/dsh/client`，`package.json` 增 `./client` export 与 `dsh.client` 声明（12 票已定）。

### 7.2 拆 workspace 包的触发条件（不按日期）

满足任意一条才拆：

1. **构建需要**：客户端产物不能与宿主共用一份 `tsconfig` / 依赖清单（12 落地前后验证）；
2. **复用出现**：第二个插件或外部项目消费 `ui-core` / `ui-react` / `contract`；
3. **第三方 provider**：外部作者要提供自己的 source / format，必须独立发布。

拆的时候按 `contract / core / providers / dsh / ui-core / ui-react` 切；根包退化为元包。**安装约束**：`install_bundle` 装根目录，运行期不能依赖 `workspace:*`；兄弟包要么一起发布，要么在根包内联。

### 7.3 运行期 provider 注册（Q2）

只有出现「第三方 provider」或「跨 harness 适配器 ≥ 2」时才做：为 source 定义 Cordis 子服务契约（注册 / 版本 / 生命周期 / 错误隔离），连接器从注册表取而不是读静态列表。之前不做——一个适配器的注册表是纯负债。

## 8. 迁移阶段与现有票的落位

| 阶段 | 内容 | 票 / 前置 | 验收 |
| --- | --- | --- | --- |
| P0 | 本设计与 ADR | —（当前） | 裁决 Q1–Q3 |
| P1 | **机械分层**：搬 01/02 模块（含 `types.ts` → `contract/`）；拆 fs 端口与适配器；加 import 矩阵守卫；更新锚点与测试 import | 新票候选（Q3） | 行为零变化；`pnpm check` 全绿 |
| P2 | `core/resolve`（03）＋ `core/assemble`（04）＋ `orchestrator` | 03、04 | 纯函数单测；`prepare` 确定性 |
| P3 | 06 的目录注入（core 纯逻辑 ＋ host pre-step sink）；07 的 tool ＋ `subagents.start` | 06、07 | 假 ctx 集成测试 |
| P4 | 11 control → `core/control`；12 的 host route / client 入口 / ui-core；05 的 ui-react；13 的测试 | 11、12、05、13 | 适配器契约套件；真机 |
| P5 | 拆包 / 运行期注册 | 触发条件（§7） | 安装与回退实测 |

**票的落位**（不改语义，只改归属）：

| 票 | 落到 |
| --- | --- |
| 01 / 02 | `core/catalog`（＋ fs/source 适配器拆到 `providers`） |
| 03 | `core/resolve` |
| 04 | `core/assemble`（纯规划）＋ `dsh/host` 的 sink（注册） |
| 06 | `core/catalog-injection`（纯 digest / 渲染）＋ `core/tool-capability`（与 orchestrator 共用）＋ `dsh/host` 的 pre-step sink |
| 07 | `core/orchestrator`（决策）＋ `dsh/host` 的 tool / subagent 翻译（效果） |
| 11 | `core/control` |
| 12 | `dsh/host` route ＋ `dsh/client` 入口 ＋ `ui-core` 的 HTTP port |
| 13 | 各层测试 ＋ 适配器契约套件 |
| 05 | `ui-react` ＋ `SettingsPage` |

**P1 的具体代价**：约 29 处 `src/...` 锚点、测试 import、README 的路径陈述要一起改；一次性提交、守卫全绿，避免「移动中」的中间态。锚点是断言不是合同——移动时逐条重验，不照抄行号。

## 9. 未决问题

- **Q1（编排服务的公开面）**：`core/orchestrator` 是**包内深模块**（推荐；07 / 11 在包内消费，不 provide），还是 provide 成 `ctx.agentOrchestrator` 供第三方插件消费？推荐前者：当前只有自家连接器消费，公开服务会冻结一份未被使用验证的接口；出现第二个消费者时再 provide。
- **Q2（Provider 的时机）**：v1 只做「端口 ＋ 静态装配」（推荐：文件系统 / 内置两配置，writer 两适配器），还是现在就做运行期 provider 注册表？推荐前者（一个适配器的注册表是负债；触发条件见 §7.3）。
- **Q3（P1 的时机）**：先落一张机械分层票（推荐：import 矩阵从第一天起约束后续 03/04/11/12 的落位），还是等 03 或 06 动工时顺带搬？推荐先落；否则每张票都要先猜目录。

## 10. 非目标

- 运行期插件加载器、provider 注册表、版本化服务契约（Q2 触发前）；
- 跨 harness provider、装配源 provider、切片 / include / `.sections/`（票 11 已裁决延后）；
- pnpm workspace 拆包与发布流水线（§7.2 触发前）；
- 依赖变更（沙箱内不做，由维护者在沙箱外执行）；
- 改 01/02 的冻结读面语义、改 11 的 6 成员、改 12 的 wire 形状。
