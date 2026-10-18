# Core 设计：分层、Cordis 服务与插件化

状态：**定稿**（2026-10-18）。已裁决：Q1 = 部分 A / 部分 B（按 bundle 边界服务化）；Q2 = 优先 Cordis 特性、Provider 实例经 `agentProviders` 注册；Q3 = 先落 P1 机械分层（票 16）；Q4 = v1 单包多插件行；Q5 = 重开 ADR-0001、允许运行期 `import '@deepseek-ai/cordis'` 使用 `Service` 基类（限 `dsh/host`，ADR-0004）。无待决项。
配套：`docs/adr/0003-layered-core-seams.md`；产品范围见票 11；数据模型见 `spec.md` §5；宿主事实见 `docs/agents/harness-facts.md`。

本文用 `codebase-design` 的词表：**module**（接口＋实现，尺度不限）、**interface**（调用方必须知道的一切）、**implementation**、**depth**（接口上的杠杆）、**seam**（可替换行为的位置）、**adapter**（填缝的具体实现）。不用「组件 / 服务 / API / 边界」替代它们——但 **Cordis Service** 是专有名词，保留大写并加引号。

「插件化」= **Cordis 插件行 ＋ 服务契约 ＋ 单向层依赖**，不造自定义加载器。插件行由 bundle patch 插入，服务是跨 bundle 的唯一集成面。

## 0. 结论

1. **插件单位是 Cordis 插件行，不是层。** 一个包可以暴露多个子入口（`name` 允许子路径），一个 bundle patch 可以插入多行；服务 key 是跨 bundle 的唯一契约。把每层强绑成一个插件仍然不做——纯算法留在 module 内部，只有被其他 bundle 消费的能力才 provide。
2. **六层**：`contract`（types only）、`core`（目录 / 编排 / 写面）、`providers`（来源与写入适配器）、`dsh`（宿主 / 浏览器连接器）、`ui-core`（界面核心）、`ui-react`（React 组件库）。依赖单向指向 `contract`；宿主翼与界面翼不共享实现，只共享 `contract`（wire 是它的投影）。
3. **能力切分（Q1 的「部分 A / 部分 B」）**：

   | 能力 | A（module 内部） | B（Cordis 服务） | 理由 |
   | --- | --- | --- | --- |
   | 目录读面 `agentRegistry` / `aliasRegistry` | — | ✔（已冻结） | 06 / UI / 第三方都要读 |
   | Provider 注册表 `agentProviders` | — | ✔（新增） | provider bundle 的扩展点 |
   | 编排 `agentOrchestrator.prepare` | — | ✔（新增） | summon / UI 顾问 / 第三方消费 |
   | 写面 `agentControl`（6 成员） | — | ✔（新增） | UI host route / CLI / 第三方消费 |
   | 链解析、组装规划、工具差集、目录注入渲染 | ✔ | — | 纯算法，只被本 bundle 的 module 调用 |
   | 连接器 sinks / routes | ✔ | — | 每个能力插件自己的效果面 |
   | UI session / view models / 组件 | ✔ | — | 界面 bundle 内部 |

4. **Provider 经 `agentProviders` 服务注册**，镜像原生 `ctx.skills.registerProvider`：provider bundle 在 `apply` 里 `ctx.agentProviders.registerAgentProvider(create)`，工厂拿到 `ProviderControl`（`signal` / `invalidate`）并返回实例；core 的 catalogs 只消费注册表，不认识任何具体 provider 包。默认 provider（文件系统 / 内置 / 模型层 / DSH 默认对）随包提供，拆分到独立行。
5. **物理形态先单包多插件行**（子路径导出 ＋ patch 多行），拆包由独立发布 / 第三方 provider / 客户端构建触发（§7），不按日期。

### 0.1 用户词与落点

| 用户词 | 设计落点 |
| --- | --- |
| 编排服务 | `core/orchestrator`，provide 为 `agentOrchestrator` |
| DSH 连接器 | `dsh/host` ＋ `dsh/client` 的插件行；共享的 DSH 结构读取助手 |
| 用户界面核心 | `ui-core`：`AgentDocPort`、`SettingsSession`、view models、适配器 |
| 用户界面 React 组件库 | `ui-react`：pane / 编辑器 / 基础控件 ＋ CSS |
| 各种 Provider | `providers`：注册进 `agentProviders` 的 `AgentSourceProvider` / `ModelLayerProvider` / `DefaultModelProvider` |
| （设计新增）契约 | `contract`：跨 bundle 的数据形状与服务契约 |

### 0.2 四条端到端流

1. **读取与列表**：provider bundle 注册 → `agentProviders` → `core/catalog` → `agentControl.snapshot`（含可选 resolution view）→ `dsh/host` route → `ui-core` session → `ui-react` panes。
2. **目录注入（06）**：`core/catalog` → `core/catalog-injection`（纯渲染 ＋ digest）→ `dsh/host` pre-step sink（last-digest / offered message id 留在连接器）→ 主 Agent 上下文。
3. **召唤（07）**：`dsh/host` tool → `agentOrchestrator.prepare`（调用方传入 effective tools / capability）→ `core/resolve` ＋ `core/assemble` → `PreparedAgent` → 连接器翻译成 `ctx.subagents.start`；链耗尽 → tool `isError`。
4. **编辑（11/12/05）**：`ui-react` → `ui-core` session → `AgentDocPort`（HTTP）→ `dsh/host` route → `agentControl` → `providers` writer；逐文件结果回写 session，冲突保留草稿。

## 1. 约束（设计输入）

- **Cordis 能力**：用 `inject`（硬依赖，等待服务出现）、`ctx.get`（可选依赖）、`ctx.provide`（提供服务）、`ctx.effect`（可逆副作用）、`ctx.on` / waterfall（事件）、`ctx.logger`。2026-10-18 本仓探针验证：`ctx.provide` 的 plain object 可被 `inject` 消费（只是不进 Service 目录）。
- **`Service` 基类（Q5=B）**：允许运行期 `import '@deepseek-ai/cordis'`——**仅此一个宿主包**，以 `peerDependencies` + `devDependencies` 声明；只用于 `dsh/host` 的 Service 子类、Config schema、服务目录可见性。`core` 仍不 import 任何宿主包，只返回纯行为对象，由 `dsh/host` 包装成 Service。安装探针（loader 加载后 `Service.listService` 可见、`inject` / 卸载正常）是 P2 第一道门；失败则回报并回退 plain object（回退路径已探针验证可 inject）。
- **插件行**：bundle patch 的 `insert[].name` 可以是包名子路径（原生先例 `@deepseek-ai/dsh-plugin-manager/tools`），所以一个包可以承载 core / providers / control / summon / catalog / ui-host 多行；`inject` 写服务 key。
- **安装面**：`install_bundle` 装目录；运行时不能依赖 `workspace:*` 或未发布兄弟包；沙箱内不做依赖变更。
- **import 面**：运行期 `@deepseek-ai/*` 仅 `dsh/host` 可 import `@deepseek-ai/cordis`（Q5=B 例外，ADR-0004；P1 矩阵仍全层禁止运行期，仅 type-only）；宿主服务只按形状结构读取（ADR-0001）。
- **冻结面**：01/02 读面、11 的 6 成员、12 的 wire 语义；本设计只改落位与暴露方式，不改语义。
- **浏览器面**：`ui-core` / `ui-react` / `dsh/client` 不得 import `node:*`、`core`、`providers`；React 只在界面翼。
- **产品面**：v1 只支持标准 Agent 文件（单文件 body），不引入切片 / 装配源 / 跨 harness。

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
| `core` | `contract` | `providers`、`dsh`、`ui-*`、`node:fs`（完全无 I/O） | I/O 全在 provider；core 连 project root 都不解析 |
| `providers` | `contract`、`core` 的 ports 子入口 | `dsh`、`ui-*` | 只做 I/O 适配；环境策略在这里 |
| `dsh/host` | `contract`、`core`、`providers` | `ui-*`；其余 `@deepseek-ai/*` | 唯一可运行期 import `@deepseek-ai/cordis` 的层 |
| `ui-core` | `contract` | `core`、`providers`、`dsh`、React / DOM | 浏览器安全；fetch 作为注入端口 |
| `ui-react` | `contract`、`ui-core` | `core`、`providers`、`dsh` | 纯 props；只有页面 / hook 碰 session |
| `dsh/client` | `contract`、`ui-core`、`ui-react` | `core`、`providers`、`dsh/host`、`node:*` | 唯一懂 `settings.section` 与 client slots 的层 |

规则：

1. **跨层只准走对方声明的 public entry**（`index.ts`，或显式列出的子入口，如 `core/ports.ts`）；层内可以深 import。`scripts/check.mjs` 的 import 矩阵强制执行（含自测）。
2. **`import type` 也算依赖**；唯一例外是 `dsh/host` 对 `@deepseek-ai/*` 的类型引用。
3. **禁止 `common/`、`utils/`、`shared/` 垃圾抽屉**：共享代码必须属于某个 module。
4. **禁止跨翼 import**；两翼只通过 `contract` 的 DTO 对齐。
5. `src/index.ts` 保持为兼容入口（`package.json` 的 `main` 暂不变）：它组合已有插件行或 re-export `dsh/host` 的 all-in-one `apply`；不承载领域逻辑。

### 2.1 部署：插件行与服务

| 行（子路径） | 职责 | provide | inject / 可选 get |
| --- | --- | --- | --- |
| `core` | catalogs、provider 注册表、orchestrator | `agentProviders`、`agentRegistry`、`aliasRegistry`、`agentOrchestrator` | — |
| `providers/default` | 默认 provider：4 个文件根、bundled、模型层、DSH 默认对 | （注册进 `agentProviders`） | `agentProviders`；可选 `fs`、`agentDefaultModel` |
| `control` | 控制核心 ＋ writer | `agentControl` | `agentRegistry`、`aliasRegistry`；可选 `agentOrchestrator` |
| `summon` | `summon_agent` 工具 ＋ 原生替换 | — | `agentOrchestrator`、`tools`、`subagents` |
| `catalog`（06） | 目录注入 digest ＋ 工具警告 | — | `agentRegistry`、`aliasRegistry`、`tools` |
| `ui-host`（12） | HTTP exact route | — | `agentControl`；可选 `agentOrchestrator`、`webServer` |
| `ui-client` | `settings.section` 整页 | — | HTTP fetch（12 的 route；客户端不拿宿主服务） |

行是**能力边界**，不是文件边界；一个行可以很小（只做注册）。**同一个服务只 provide 一次**：patch 在 `src/index.ts` 的 all-in-one 行与 granular 行之间二选一，不能同时插入。v1 先落 `core` ＋ `providers/default`；`control` / `summon` / `catalog` / `ui-*` 随 11/12/07/06/05 落地，期间 `src/index.ts` 保持 all-in-one 兼容，P2 起切 granular。

### 2.2 服务契约

| key | 成员数 | apiVersion | 消费者 |
| --- | --- | --- | --- |
| `agentProviders` | 注册 3 ＋ 读 3 ＋ change 1 | 1 | provider 行、catalogs |
| `agentRegistry` | 4（冻结） | —（形状即契约） | 06、ui-host、第三方 |
| `aliasRegistry` | 5（冻结） | —（形状即契约） | 03、06、ui-host |
| `agentOrchestrator` | 1 | 1 | summon、ui-host、第三方 |
| `agentControl` | 6 | 1 | ui-host、CLI、第三方 |

约定：**新增**服务对象带 `readonly apiVersion: 1`；既有两读面保持冻结形状、不加字段（它们就是契约本身）。消费方取到新服务后先校验版本，不匹配按「能力缺失」处理（不猜）。服务实现都是 `dsh/host` 的 `Service` 子类（core 只提供纯行为对象），`ctx.get` 返回服务代理——测试断言行为，不断言对象身份。跨 bundle 只传契约对象（服务对象、provider 实例）与可序列化领域的子集；不传 `ctx` / fiber / 宿主活对象；`apiVersion` 之外的破坏性变更换新 key。

## 3. 各层设计

### 3.1 `contract`

**内容**：跨 bundle / 跨翼的形状与契约，types only。

- 目录：`AgentDefinition`、`AgentRegistry`、`AliasRegistry` 及其诊断 / findings（01/02 冻结）；
- 控制：`ControlSnapshot`、`ComposedAgentDocument`、`DocumentEdit`、`WritePlan`、`WriteReport`、`RegistryEdit`（11）；
- 编排：`PrepareOptions`、`PreparedAgent`、`ResolutionResult`、`AssemblyPlan`、`ToolPlan`、归一化 `Warning`（服务边界，所以进 contract）；
- provider：`AgentProviders`、`ProviderControl`、`AgentSourceProvider`、`ModelLayerProvider`、`DefaultModelProvider`、`ProviderLookupOptions`、`SourceEntry`、`SourceDocument`；
- 服务：`AgentOrchestrator`、`AgentControl` 的接口形状、服务 key 常量、`SERVICE_API_VERSION`；
- 界面：`AgentDocPort` 的 **DTO 部分**（wire 投影）；`SettingsState` / `SettingsAction` 留在 `ui-core`。

**不进 `contract`**：`resolveChain` / `planAssembly` / `tool-capability` / `catalog-injection` 的内部签名；`DefinitionWriter`（control 内部端口）；`HostPorts`（连接器内部）；`SettingsState` / `SettingsAction` / `AgentDocPort` 接口本身（`ui-core` 拥有）。

**接口不变量**：

- 无 I/O、无环境 API、无 React / DSH import，types only；
- **一概念一形状**；`AgentDiagnostic` 与 `AliasFinding` 分族，归一化视图只做带 `origin` 的联合，不合并成 `Finding` 模型；
- 编辑类类型携带原文 / 原块信息（D14 回写）；展示串不得进入 `file` 一类字段；
- 运行期校验不进 `contract`：control 的编辑校验归 `core/control`，HTTP 请求校验归 route；
- 新类型只有在**跨 bundle 或跨翼**被消费时才进 `contract`。

**删除测试**：删掉它，每个 bundle 各造一套形状，服务 key 与 wire 长出多份。

### 3.2 `core/catalog`

两个冻结读面不变：

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

组装：`createAgentCatalog({ providers, warn })` 与 `createModelCatalog({ providers, warn })`。**core 不做任何 I/O**：不解析 project root、不碰 `process.env`、不 import `node:fs`。provider 收到 `{ cwd?, signal? }`，自己解析根（文件系统 provider 内部走 `findProjectRoot`）。

**内部缝**：`scanAgentProviders`、`classifyEntry`、`parseAgentDocument`、`mergeModelLayers`、`inspectAliasRegistry`、`createLazyLoad`。

**接口不变量**（冻结语义不变）：

- 查询按 `cwd` 记忆化（project root 的解析下沉到 provider；不同子目录各扫一次，结果正确；将来可用 provider 的 `workspaceKey` 优化）；
- 失败不缓存；并发查询共享 in-flight；无 watcher，`invalidate()` 是唯一刷新点；
- provider 集合变化或 provider 调 `control.invalidate()` ⇒ 注册表通知 ⇒ catalogs 清缓存；
- rank 低者胜；模型层整层合并 / 整层弃用，绝不半合并；
- 受信 provider 的坏文档是硬错误，其余是软诊断；`diagnostics()` 与 `list()` 来自同一次扫描；
- 目录排序稳定（rank 升序，再按名称）。

**删除测试**：没有它，provider 与连接器会各自分类 / 解析 / 合并 / 判信任，冻结语义分叉。

### 3.3 `core/orchestrator`（编排服务）

```ts
interface AgentOrchestrator {          // ctx.agentOrchestrator
  readonly apiVersion: 1
  prepare(agentName: string, options?: PrepareOptions): Promise<PreparedAgent>
}

interface PrepareOptions {
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly flavor?: 'spawn' | 'fork'
  readonly capability?: RuntimeCapability
  readonly effectiveTools?: readonly string[]   // 调用方（07）从 ctx.tools 取；core 不碰 ctx
}

interface PreparedAgent {
  readonly agent: AgentDefinition
  readonly flavor: 'spawn' | 'fork'
  readonly resolution: ResolutionResult          // ok | failed（链耗尽等，不 throw）
  readonly assembly: AssemblyPlan
  readonly tools: ToolPlan                       // 过滤结果＋缺失的 requiredTools
  readonly warnings: readonly Warning[]          // origin: agent | model | runtime
}
```

**藏起来的行为**（顺序固定，provenance 始终在）：

1. 从两个 catalog 各读一次快照；
2. 链解析（03）：别名展开、`available:false` 跳过、raw `model:` 兜底、白名单、effort 优先级；
3. 组装规划（04）：节列表、通道、缓存断点；
4. 工具差集：调用方传入的 `effectiveTools`（06 与 orchestrator 共用 `core/tool-capability`）；
5. 能力降级：`capability` 不满足 persona / toolFilter / depth 时的降级项；
6. 归一化警告：三族信号映射成统一视图，保留原始 code 与来源。

**接口不变量**：

- **域结果是数据，不是异常**：链耗尽 `resolution.ok=false`，07 映射成 tool `isError`；只有 catalog 的意外错误才 throw；
- 确定性：同样输入（快照、policy、channels、capability、effectiveTools）⇒ 同样输出；
- 一次 `prepare` 只读一次快照，不拼半新半旧状态；
- 绝不发明 provider/model 对；绝不隐藏诊断；警告顺序稳定；
- 不写盘、不碰 `ctx`、不注册副作用；不缓存（catalog 已缓存）。

**内部缝**：`resolveChain`（03）、`planAssembly`（04）、`tool-capability`、`normalizeWarnings`；纯函数，各自直接测试，不从 `core/index.ts` 暴露。

**消费关系**：summon（07）注入 `agentOrchestrator`；control（11）用 `ctx.get` **可选**注入，03 未落地时 `snapshot` 显式标注「链解析待 03」；06 不消费它（06 只依赖目录与 `tool-capability`，不因 03 未落地而受阻）。

### 3.4 `core/control`（写面服务）

接口与语义以票 11 为准（`snapshot` / `compose` / `plan` / `commit` / `applyRegistryEdit` / `invalidate`），provide 为 `agentControl`。位置与不变量：

- provide 方 = `control` 插件行；依赖：两个 catalog（inject）、可选 `agentOrchestrator`（get）、`DefinitionWriter`；
- `compose` 返回域形状（无编辑器偏移）；`plan` 纯函数；`commit` 逐文件原子写、写后重校验、覆盖冲突明确报错；`applyRegistryEdit` 藏住层解析 / 删除回退 / 路径推导；
- 只写由 catalog / 层文件推导出的路径，绝不接受请求里的任意路径；`agentName` 先验证再拼；
- 多文件保存**不是事务**：逐文件结果、失败可重试、不承诺回滚；
- 全仓一份 frontmatter 模型、一份序列化、一份块 → 文件路由；D14 往返是接口不变量；
- 只有它 provide `agentControl`；ui-host 只消费，不重复领域规则。

**删除测试**：删掉它，12 的 route 会重新发明组合与写路由（原型已在客户端做过一次）。

### 3.5 `providers`：注册表与默认 provider

**注册表服务**（core 提供；镜像 `ctx.skills.registerProvider`）：

```ts
interface AgentProviders {                 // ctx.agentProviders
  readonly apiVersion: 1
  registerAgentProvider(create: (control: ProviderControl) => AgentSourceProvider): () => void
  registerModelProvider(create: (control: ProviderControl) => ModelLayerProvider): () => void
  registerDefaultModelProvider(create: (control: ProviderControl) => DefaultModelProvider): () => void
  listAgentProviders(): readonly AgentSourceProvider[]     // rank 升序，再按注册顺序
  listModelProviders(): readonly ModelLayerProvider[]
  defaultModelProvider(): DefaultModelProvider | undefined
  onChange(listener: () => void): () => void
}

interface ProviderControl {
  readonly signal: AbortSignal
  invalidate(): void          // provider 数据变化 ⇒ 通知 catalogs 清缓存
}
```

**Provider 契约**：

```ts
interface AgentSourceProvider {
  readonly id: string
  readonly source: AgentSource            // v1 仍是闭合标签；第三方标签等 contract v2
  readonly rank: number
  readonly trust: 'trusted' | 'untrusted'
  listEntries(options: ProviderLookupOptions): Promise<readonly SourceEntry[] | undefined>
  readDocument(agentName: string, options: ProviderLookupOptions): Promise<SourceDocument | undefined>
}

interface ModelLayerProvider {
  readonly id: string
  readonly source: AliasRegistrySource
  read(options: ProviderLookupOptions): Promise<SourceDocument | undefined>   // 只交原文＋路径；解析与整层弃用在 core
}

interface DefaultModelProvider {
  readonly id: string
  read(options: ProviderLookupOptions): Promise<AgentModelTarget | undefined>   // DSH 默认对
}

interface SourceEntry {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
  readonly path: string              // provider 解析后的绝对路径；诊断与 provenance 都用它
}

interface SourceDocument { readonly path: string; readonly text: string }

interface ProviderLookupOptions { readonly cwd?: string; readonly signal?: AbortSignal }
```

**生命周期与不变量**：

- 工厂**同步**执行（注册期完成构造）；异步初始化放在 `listEntries` / `read`；工厂拿到 `control.signal`，卸载时 abort；
- 返回的 disposer 由 provider 插件用 `ctx.effect` 挂到自己的 fiber：卸载 ⇒ 从注册表移除 ＋ abort ＋ 通知；`control.invalidate()` 只通知，不注销；
- **`id` 唯一**；agent provider 的 `source` 标签唯一；model provider 每层一个；默认对 provider 最多一个；重复即 throw（对齐原生 skills 的 duplicate 语义）；
- 注册顺序稳定；rank 相同的按注册顺序；注册 / 注销 / invalidate 都触发 `onChange`；
- provider 的 `trusted` 只给随包资产；第三方 provider 默认 `untrusted`，`trusted` 需要核心配置显式允许（v2 策略，v1 只有随包 provider）；
- provider 可以读 `process.env` / config（它是环境适配器）；core 不读；
- provider 错误：缺席 = `undefined`；意外错误上抛，由 core 决定信任语义。

**默认 provider 行**（随包，`providers/default`）：

| provider | 注册 | 说明 |
| --- | --- | --- |
| 文件系统 ×4 | project `.dsh` / `.agents`、user `$DSH_HOME` / `$DSH_AGENTS_HOME` | 每个一个 provider；内部解析 project root，host `fs` 可用则走 host，否则 Node |
| bundled ×1 | 随包资产 | `trusted`，Node 读取，rank 600 |
| 模型层 ×2 | workspace / global `registry.yaml` | 工作区层压过全局层 |
| 默认对 ×1 | `ctx.agentDefaultModel` | 只提供 pair；`dsh-default` 的合成 / 匹配逻辑仍在 catalog（D6 不变式） |

**命名**：Provider ＝ 定义来源适配器；连接器副作用面叫 **sink**；LLM provider 只是字符串（R1/R2 研究其关联），不是本层。

### 3.6 `dsh`（连接器）

连接器不再是一个单体插件，而是**每个能力行**的 DSH 适配代码；共享的结构读取助手（`ctx.fs`、`agentDefaultModel`、`webServer`、`subagents`、`tools`）留在 `dsh/host`。每个 provide 的服务都是这里的 `Service` 子类：`super(ctx, key)` 注册，内部委托 core 的纯行为对象；Service 子类不写领域规则。

- `core` 行：构造 `agentProviders` 注册表 → provide → 构造 catalogs → provide → 构造 orchestrator → provide。**没有 DSH 副作用**。
- `control` 行：构造 writer、catalog 依赖、可选 orchestrator；provide `agentControl`。
- `providers/default` 行：注册默认 provider；`ctx.get('fs')` / `ctx.get('agentDefaultModel')` 按用时读。
- `summon`（07）：注册 `summon_agent` tool；把 `PreparedAgent` 翻译成 `ctx.subagents.start` 的 request；`system-prompt/assemble` 过滤原生工具；链耗尽 → tool isError；能力降级 → 警告放行。
- `catalog`（06）：pre-step digest；last-digest / offered message id 等会话状态留在本行；core 只渲染条目与算哈希。
- `ui-host`（12）：`ctx.webServer` exact route；校验请求 → 调 `agentControl` → 序列化；错误 400/404/409/5xx；请求上限。
- `ui-client`：`settings.section` 整页；构造 HTTP `AgentDocPort`，创建 session，渲染 `<SettingsPage>`；加载 / 失败 / 重试兜底。
- persona 委托原生 `deployment:persona-prefix`，不重复发明。

**接口不变量**：

- 唯一可以 `import '@deepseek-ai/cordis'`（含运行期）的子层（`dsh/host`）；其余 `@deepseek-ai/*` 运行期仍禁；
- 宿主服务按用时结构读取（`ctx.get`），绝不在 `apply` 时捕获；
- 只有映射、能力门控、错误翻译、生命周期，**没有领域规则**；
- 服务注册用真 Context 测试（`@deepseek-ai/cordis` 是 devDependency）；sink / 可选服务用假 `ctx`，不要求真实 profile；
- 每行只 provide 自己声明的 key，不偷偷占用原生 key（`agentProviders` / `agentOrchestrator` / `agentControl` 已核无 catalogued 占用）；Service 子类让服务进入 `Service.listService`，安装点仍用 loader entry ＋ 集成测试证明；`ctx.get` 返回代理，测试断言行为。

**删除测试**：删掉连接器，core 仍可完整测试——adapter 的职责，不追求深度。

### 3.7 `ui-core`（界面核心）

**文档端口**（12 wire 的投影；内存 / HTTP 两适配器）：

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

藏住：加载 / 刷新单飞与过期响应丢弃、按 agent 的草稿、脏判定、`plan → commit` 保存、冲突保留草稿、切换 agent 的未保存策略、400/404/409/5xx typed error、AbortSignal 取消、`invalidate` 后对账。

**不变量**：不 import React / DOM / DSH / core；`fetch` 注入；同一查询只有一个在途加载；保存只经 `AgentDocPort`；**不重算宿主语义**（层合并 / 链解析 / 块路由都不在这里）；`dispose()` 后不再发状态或请求。

**内部缝**：`reduce`、`selectAgentList`、`selectRegistryView`、`buildEditorModel`、`selectAdvisor`、`computePaneLayout`、`mapPortError`。

**删除测试**：删掉它，异步 / 过期 / 草稿 / 冲突逻辑会退回组件（原型的三个内存 map 是证据）。

### 3.8 `ui-react`（组件库）

内容：`MasterDetailPane`、`AgentListPane`、`AgentDocumentEditor`、`ModelLinksPane`、`RegistryPanel`、`AdvisorPanel`、`SettingsPage`、基础控件与 CSS。

契约：pane 只收只读 view model ＋ 回调；只有 `SettingsPage` / `useSettingsSession` 接触 session（`useSyncExternalStore`）；编辑器只持纯 UI 临时态；无 fetch / 定时器 / localStorage / 领域计算；CSS 变量带 fallback；交互元素带稳定 `data-*`。

**诚实的说明**：全系统最浅的一层，深度在 `ui-core`；把领域逻辑推进组件只会把测试面变成 DOM。

## 4. 缝清单（真缝 vs 假想缝）

| 缝 | 接口 | 现有适配器 | 判定 |
| --- | --- | --- | --- |
| Provider 注册 | `AgentProviders` 服务 | 文件系统 / 内置 / 模型层 / 默认对（随包）＋ 第三方（后续） | 真缝；Cordis 服务注册，不建自定义加载器 |
| 文件系统 | `AgentFileSystem` | Node fs / host `ctx.fs` | 真缝（2） |
| 定义来源 | `AgentSourceProvider` | 4 根 ＋ bundled | 真缝（5 个 provider），provider 各自解析 workspace |
| 模型层 | `ModelLayerProvider` | workspace / user ＋ 默认对 | 真缝（3） |
| 写入 | `DefinitionWriter` | Node 原子写 / 内存 | 真缝（2），测试与未来远端 |
| 文档端口 | `AgentDocPort` | 内存 / HTTP | 真缝（2），12/13 已定 |
| 宿主环境 | `HostPorts` | 真 `ctx` / 测试 fake | 真缝（2） |
| 定义格式 | `DefinitionFormat` | 仅标准 Agent 文件 | **假想缝**：v1 不建接口；跨 harness 时再开 |
| 自定义插件加载器 | — | 无 | **不做**：用 Cordis patch 行 |

## 5. 深度审计

| module | 接口规模 | 藏住的行为 | 删除测试 | 判定 |
| --- | --- | --- | --- | --- |
| `contract` | types only | 形状 / 服务契约 / wire 对齐 | 每个 bundle 各造一套 | 必要，非行为模块 |
| `agentProviders` | 7 方法 | 注册 / 生命周期 / 排序 / 通知 | 每个 provider 自己找消费者 | 扩展点，宽是本质，不追求深 |
| `core/catalog` | 4＋5（冻结） | 发现、解析、rank、信任、懒加载、诊断 | 语义分叉 | 深（已冻结） |
| `agentOrchestrator` | 1 方法 | 解析→组装→检查→provenance | summon / control 各自重排 | 深（新增） |
| `agentControl` | 6 成员 | 组合、写计划、原子写、registry 编辑 | route 重造写路由 | 深（11 冻结） |
| `providers` | 3 个 provider 契约 | I/O 差异（fs / 信任 / 原子性 / workspace） | 每个来源在 core 里长分支 | 适配器层，不追求深 |
| `dsh` | 多行适配 | DSH 映射、能力、生命周期 | core 可测但宿主不可用 | 适配器层，不追求深 |
| `ui-core/session` | 4 成员 | 加载/草稿/保存/冲突/取消 | 逻辑退回组件 | 深（新增） |
| `ui-react` | props | 无（只做渲染） | 组件库消失、页面内联 | 刻意浅 |

## 6. 测试策略（接口即测试面）

- **`contract`**：`tsc` 保护；服务 key / apiVersion 常量有静态断言。
- **`core`**：假 `agentProviders` 注册表（内存 provider）；catalog 断言注册后再查询会重扫、注销 / invalidate 会清缓存、rank 决胜；orchestrator 固定快照断言确定性、顺序、provenance；control 内存 writer 断言 D14 往返与冲突（11）。
- **`providers`**：provider 契约套件跑真实临时目录 ＋ 假 host fs；project root 解析、缺失即 `undefined`、意外错误上抛。
- **`dsh`**：服务注册用真 Context（`@deepseek-ai/cordis` 是 devDependency）断言 `Service` 注册、`inject` 属性访问、卸载；sink / 可选服务用假 `ctx` 断言注册、撤销、能力降级、错误翻译；安装探针走 loader entry ＋ `Service.listService`。
- **`ui-core`**：session 状态转移用内存 port，再跑 HTTP 假 port（13 的适配器契约套件）；不 mock 内部函数。
- **`ui-react`**：jsdom ＋ testing-library，只断言渲染与用户可见行为。
- **守卫**：`scripts/check.mjs` 增加 import 矩阵 ＋ 服务契约静态检查（key/apiVersion 字面量）＋ 自测。

## 7. 物理形态与升级

### 7.1 目标目录（单包，多子入口）

```
src/
  index.ts                 # 兼容入口：all-in-one apply / re-export
  contract/                # types only（数据 + 服务契约）
  core/
    catalog/               # 01/02
    resolve/               # 03
    assemble/              # 04
    control/               # 11
    orchestrator.ts
    providers-registry.ts
    ports.ts               # 内部端口（fs 等）
  providers/
    default/               # 默认 provider 行
    fs/                    # Node / host fs、workspace 解析
    writer/                # Node 原子写
  dsh/
    host/                  # 共享结构读取 + 各能力行的 apply
    client/                # settings.section（12 后）
  ui-core/                 # port / session / view models（12 后）
  ui-react/                # 组件库（05/13）
test/
```

`package.json` 的 `exports` 增子路径（`./core`、`./providers/default`、`./control`、`./summon`、`./catalog`、`./ui-host`、`./client`）；`cordis.patch.yml` 按行插入。P2 增 `peerDependencies: { "@deepseek-ai/cordis": "…" }`（devDependencies 已有），Service 子类只在 `src/dsh/host/`。宿主构建 `tsc` 排除 `src/ui-*` / `src/dsh/client`，客户端用 `tsconfig.client.json` ＋ 独立构建（12 票）。

### 7.2 拆 workspace 包的触发条件（不按日期）

1. **独立发布节奏**：provider / control / UI 需要各自版本与回退；
2. **第三方 provider**：外部作者要独立发布 provider 包；
3. **客户端构建**：客户端依赖清单与宿主必须分开（12 落地时验证）。

拆时按 `contract / core / providers / dsh / ui-core / ui-react` 切；根包退化为元包。**安装约束**：`install_bundle` 装根目录，运行期不能依赖 `workspace:*`；兄弟包要么一起发布，要么根包内联。服务契约（key ＋ apiVersion）在拆包后不变，这是现在就把契约放进 `@contract` 的原因。

### 7.3 不使用自定义加载器

插件行、依赖注入、生命周期、事件全部交给 Cordis；provider 注册是唯一自建的注册表，且形状镜像 `ctx.skills.registerProvider`。运行期服务缺失 = 能力缺失（`inject` 等待或 `ctx.get` 返回 undefined），不抛自定义错误。

## 8. 迁移阶段与现有票的落位

| 阶段 | 内容 | 票 / 前置 | 验收 |
| --- | --- | --- | --- |
| P1 | **机械分层**：搬 01/02 模块（含 `types.ts` → `contract/`）；拆 fs 端口与 provider；加 import 矩阵守卫；更新锚点与测试 import；仍单行 apply | 票 16 | 行为零变化；`pnpm check` 全绿 |
| P2 | `core` ＋ `providers/default` 两行；`agentProviders` 注册表上线；catalogs 改消费注册表；**Service 子类包装 ＋ `@deepseek-ai/cordis` peer ＋ loader 安装探针**；`src/index.ts` 保持 all-in-one 兼容 | 01/02、16 | 注册 / 注销 / invalidate 重扫；`Service.listService` 可见；真机安装 |
| P3 | `core/resolve`（03）＋ `core/assemble`（04）＋ `agentOrchestrator` 行；`summon`（07）＋ `catalog`（06）行 | 03、04、06、07 | 假 ctx 集成；链耗尽 isError |
| P4 | `control` 行（11）＋ `ui-host` / `ui-client`（12）＋ `ui-core` / `ui-react`（05/13） | 11、12、05、13 | 适配器契约套件；真机编辑落盘 |
| P5 | 拆包 / 第三方 provider | §7.2 触发 | 安装与回退实测 |

**票的落位**：

| 票 | 落到 |
| --- | --- |
| 01 / 02 | `core/catalog` ＋ `providers/default`（fs / bundled / 模型层 / 默认对） |
| 03 | `core/resolve`（内部）→ `agentOrchestrator` |
| 04 | `core/assemble`（内部）＋ sink 注册在 summon / dsh 行 |
| 06 | `core/catalog-injection` ＋ `core/tool-capability` ＋ `catalog` 行 |
| 07 | `agentOrchestrator` 消费 ＋ `summon` 行（tool / subagents / 原生过滤） |
| 11 | `core/control` → `agentControl` 服务 |
| 12 | `ui-host` 行 ＋ `ui-client` 入口 ＋ `ui-core` HTTP port |
| 13 | 各层测试 ＋ 适配器契约套件 |
| 05 | `ui-react` ＋ `SettingsPage` |

**P1 的代价**：约 29 处 `src/...` 锚点、测试 import、README 路径陈述要一起改；一次性提交、守卫全绿。锚点是断言不是合同，移动时逐条重验。

## 9. 裁决记录

2026-10-18，维护者裁决，全部落定：

- **Q1 = 部分 A / 部分 B**：读面、provider 注册表、orchestrator、control 服务化（B）；纯算法、sink、UI 内部保持 module（A）。因为一些能力包是不同插件 bundle，服务是唯一集成面。
- **Q2 = 优先 Cordis 特性**：provider 实例经 `agentProviders` 服务注册与传递；用 `inject` / `ctx.get` / `ctx.provide` / `ctx.effect` / `ctx.on`。不造自定义加载器。
- **Q3 = A**：先落 P1 机械分层，票 16（`ready-for-agent`）。
- **Q4 = A**：v1 单包多插件行（子路径导出 ＋ patch 多行）；拆包与第三方 provider 留触发条件（§7.2）。
- **Q5 = B**：重开 ADR-0001，允许运行期 `import '@deepseek-ai/cordis'`（peer ＋ dev，仅此一个宿主包），用 `Service` 基类 / Config schema / 服务目录可见性；Service 子类只在 `dsh/host`，core 保持纯行为对象。安装探针是 P2 第一道门，失败则回退 plain object 并回报。详见 ADR-0004。

无待决项。

## 10. 非目标

- 自定义插件加载器 / 版本化服务注册中心（用 Cordis patch ＋ 服务契约）；
- 跨 harness provider、装配源 provider、切片 / include / `.sections/`（票 11 已裁决延后）；
- 第三方 provider 的 `source` 标签扩展（等 contract v2，随跨 harness 一起做）；
- pnpm workspace 拆包与发布流水线（§7.2 触发前）；
- 除 `@deepseek-ai/cordis`（peer ＋ dev，Q5=B）外的依赖变更；沙箱内不跑安装，由维护者在沙箱外执行；
- 改 01/02 冻结读面语义、改 11 的 6 成员、改 12 的 wire 形状。
