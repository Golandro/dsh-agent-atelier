# Agent 组装规格索引（过渡）

> **状态：过渡跟踪（2026-10-24）**。本仓尚未把 contract / core / dsh / ui 真正分包隔离，组装词汇、契约符号、裁决与实现状态暂时混在一处。本文是 GLOSSARY 与协议签名之间的索引：它**不复述词义**，也**不内联完整签名**，只负责把「概念 → 词条 → 契约符号 → 消费方 → 当前状态」对齐。
>
> **权威顺序**：语义以 [GLOSSARY](../../GLOSSARY.md) 为准；双模裁决以 [ADR-0006](../adr/0006-compat-base-replacement-wide-subtype.md) 为准；协议形状以 [assembly.ts](../../src/contract/assembly.ts) 为准；实现决策以 [issue #5 规格](https://github.com/Golandro/dsh-agent-atelier/issues/5#issuecomment-6383984067) 为准。本文与上述来源冲突时，以上述来源为准。
>
> **退役条件**：分包隔离完成（contract 可被外部包只读消费）、替换模式包落地、或 06/07 开始按服务面编码后，把协议索引迁入包文档；本文删除或缩成纯链接页。
>
> **本轮修订（2026-10-27）**：v1 兼容模式直接 extend DSH 原生接口——直接与 `ctx.systemPrompt` 交互的数据采用原生名（`SystemPrompt`、`PromptSection`、`AssembleContext`），不另造同构抽象层；规划数据继续用 `Assembly*` 领域名。解耦与移植留待后续决策。

## 1. 阅读路径

| 你想做什么 | 先读什么 |
|---|---|
| 改一个词的含义 | [GLOSSARY](../../GLOSSARY.md) |
| 改协议成员或返回形状 | [assembly.ts](../../src/contract/assembly.ts) ＋ [issue #5 规格](https://github.com/Golandro/dsh-agent-atelier/issues/5#issuecomment-6383984067) |
| 查为什么分兼容 / 替换两模 | [ADR-0006](../adr/0006-compat-base-replacement-wide-subtype.md) |
| 查实现到哪一步 | 本文第 9 节「状态矩阵」 |
| 核对宿主 API 事实 | [harness-facts.md](../agents/harness-facts.md) |
| 查模块职责与层边界 | [core-design.md](./core-design.md) |

## 2. 概念索引

| 概念 | 一句话角色 | 契约 / 代码符号 | 主要消费方 | 状态 |
|---|---|---|---|---|
| Agent 组装 | 规划器 + 运行时节注册的合称 | `AssemblyPlan`、`AgentAssembly` | 05/06/07 | 契约已落 |
| 组合会话 | 一次会话启动的解析答案，组装规划的输入 | `ComposedAgentSession`（control） | 04/07 | 已交付；`model` 已填充 |
| 规划输入视图 | 契约层看到的组合会话最小投影 | `AssemblySession`、`AssemblySessionParameters` | 规划器 | 契约已落 |
| 组装规划 | 五通道节列表 + 断点 + lint | `AssemblyPlan` | 顾问面板、06 | 已实现 |
| 节 | 规划里一个具名内容单元 | `AssemblySection` | 规划器、sink、面板 | 已实现 |
| 通道 | 节的放置路由（五类） | `AssemblyChannel` | 规划器、面板 | 已实现 |
| 通道锚点 | 非 system 通道的不可执行占位行 | `AssemblySection.executable: false` | 面板、06/07 | 已实现 |
| 变维度 | 节依赖的变化来源 | `AssemblyVariesWith`、`AssemblySection.variesWith` | 规划器、lint | 已实现 |
| 缓存断点 | 某变维度第一个依赖节 | `AssemblyBreakpoint` | 面板 | 已实现 |
| 顺序 lint | 易变节排稳定节之前的建议性警告 | `AssemblyLint`、`AssemblyLintCode` | 06、面板 | 已实现 |
| 顺序豁免 | 配置条目上的 lint 豁免标记 | `AssemblyOrderEntry`、`AssemblySection.cacheIsolated` | 配置、lint | 已实现 |
| 顺序覆盖 | 全局改节的相对次序 | `AssemblyConfig.sectionOrder` | 组装行配置 | 已实现 |
| 组装注册 | 把可执行 system 节以原生 `PromptSection` 挂进 Agent scope 的运行时面 | `AgentAssembly.registerAssemblySections`、`AssemblyRegistration`、`PromptSection` | 07 | 已实现（兼容 sink） |
| 注册 scope | 宿主 scoped 提示词注册表的契约切片 | `AssemblyScope`、`SystemPrompt` | 兼容 sink | 已实现 |
| 宿主提示词面 | 兼容模式直接 extend 的 DSH 原生注册面 | `SystemPrompt`、`PromptSection`、`AssembleContext` | 兼容 sink、07 | 已扩展（原生名） |
| 基础接口 | 下游只依赖的组装面 | `AgentAssembly` | 06/07/替换包 | 已 provide（assembly 行） |
| 兼容模式 | 注册进原版 `ctx.systemPrompt` 的默认产品面 | `src/agent-assembly/sink.ts` | 运行时 | 已交付（独立 assembly 行） |
| 替换模式 | 经 patch 激活的额外包，功能更多 | 实现未落 | 运行时 | 已定，不实现 |
| 宽子类型接口 | 基础成员全保留、只增不改 | `ReplacementAgentAssembly extends AgentAssembly`（规则） | 替换包 | 规则已定 |
| 面板投影 | 快照里按 Agent 携带的派生规划 | `ControlSnapshot.assemblies` | 顾问面板 | 已接线；缺 key = 不可用 |
| 服务 key | 两种模式共用的宿主服务名 | `AGENT_ASSEMBLY_SERVICE` | 宿主 / 下游 | 已 provide（assembly 行） |

## 3. 协议面索引

完整成员与内联文档在 [assembly.ts](../../src/contract/assembly.ts)；本节只列索引，不重复签名。

### 3.1 服务 key

- `AGENT_ASSEMBLY_SERVICE = 'agentAssembly'`，定义于 [service-keys.ts](../../src/contract/service-keys.ts)。
- 兼容模式与替换模式提供**同一个 key**；同一 profile 只允许一份实现。
- 基础接口没有 `mode` 成员；下游不做能力探测。

### 3.2 基础接口成员

| 成员 | 语义 | 返回 |
|---|---|---|
| `AgentAssembly.plan(session)` | 对一份已解析会话做纯规划；无 IO、无落盘、确定性 | `AssemblyPlan` |
| `AgentAssembly.registerAssemblySections(input)` | 把一个 Agent 的可执行 system 节全量挂载 / 替换；失败回滚 | `Promise<AssemblyRegistration>` |

### 3.3 规划数据

| 符号 | 角色 |
|---|---|
| `AssemblyChannel` | 五类放置路由：`system` / `tools` / `digest` / `first-message` / `pre-step` |
| `AssemblyVariesWith` | 四个变化维度：`model` / `agent` / `registry` / `tools` |
| `AssemblySection` | 一行：channel、name、order、variesWith、text、interpolate、executable、cacheIsolated |
| `AssemblyBreakpoint` | 某维度的第一个依赖行：dimension、channel、section |
| `AssemblyLint` | 顺序建议：code、severity、channel、section、message |
| `AssemblyPlan` | sections、breakpoints、lints |

### 3.4 注册数据

| 符号 | 角色 |
|---|---|
| `AssemblyScope` | Agent 的 scoped 上下文切片；`agent.ctx` 结构满足 |
| `SystemPrompt` | 原生名切片：`section(PromptSection)` + `getSectionOrder(PromptSectionOrderName)`；不另造同构接口 |
| `PromptSection` | 交给宿主的单节，字段与原生 `PromptSection` 一致：name、order、text（静态或 `AssembleContext` provider）、interpolate、complete |
| `AssembleContext` | 原生 `AssembleContext` 切片：`scope`（不透明）与 `signal` |
| `PromptSectionOrderName` | 本切片解析的原生 placement：`'DEPLOYMENT_PERSONA_PREFIX'` |
| `AssemblyRegistration` | agentName、plan、幂等 `dispose()` |
| `AssemblyMountInput` | scope + session；同一 scope 的第二次挂载是全量替换 |

> `PromptContext` 尚未进入切片：06 接入 digest 时按同一策略 extend 原生 `context(PromptContext)`，本票不提前建模。

### 3.5 输入视图

| 符号 | 角色 |
|---|---|
| `AssemblySession` | `agent` + `parameters` + 可选 `model`；不 import control |
| `AssemblySessionParameters` | `route` + `persona`；规划器实际读取的会话字段 |
| `AssemblyConfig` | `sectionOrder` 覆盖 |
| `AssemblyOrderEntry` | 裸名字，或 `{ name, cacheIsolated }` |

### 3.6 既有形状的加法（已交付）

| 形状 | 加法 | 当前状态 |
|---|---|---|
| `ComposedAgentSession`（[session.ts](../../src/control/session.ts)） | `model?: ModelDefinition`，承载获胜条目的 `sysPrompt` | 已交付；`composeSessionOf` 已填充（票 04） |
| `ControlSnapshot`（[types.ts](../../src/control/types.ts)） | `assemblies: Readonly<Partial<Record<string, AssemblyPlan>>>` | 已交付；[core.ts](../../src/control/core.ts) 的 `snapshot` 已接线，缺 key = 不可用 |

## 4. 规划行集

计划数组按推荐缓存分层（D10）排列；`order` 只对 `system` 行有宿主含义。

| 行名 | 通道 | order | variesWith | executable | 执行方 / 内容来源 |
|---|---|---:|---|---|---|
| `atelier:model-sys` | `system` | −500 | `model` | 是 | 获胜模型条目的 `sysPrompt`；为空则不出该行 |
| `channel:tools` | `tools` | 0 | `tools` | 否 | 07 的工具过滤；本票只建模 |
| `deployment:persona-prefix` | `system` | 0 | `agent` | 是 | 文档正文；空正文也注册，用于遮蔽部署级人设 |
| `atelier:skills` | `system` | 100 | `agent` | 否 | 07 决定目录注入或内容预注入 |
| `channel:digest` | `digest` | 0 | `registry` | 否 | 06 的目录摘要建模；实际投递由 core 行的 `agent/pre-step` 监听器执行 |
| `channel:first-message` | `first-message` | 0 | 无 | 否 | 07 的首条消息 |
| `channel:pre-step` | `pre-step` | 0 | 无 | 否 | DSH 原生 compaction / 提醒 |

### 4.1 通道 → 宿主原生机制

通道是领域概念（放置路由），不是新的宿主接口；每个通道执行时直接 extend 对应的原生机制：

| 通道 | DSH 原生机制 | 本票状态 |
|---|---|---|
| `system` | `ctx.systemPrompt.section(PromptSection)` | 已执行（兼容 sink） |
| `digest` | `ctx.systemPrompt.context(PromptContext)`（06 建模；实际投递经 `agent/pre-step`） | 06 已落地（pre-step），digest 仍只建模 |
| `tools` | `ctx.tools.restrict()` 做过滤；`systemPrompt.tools()` 只追加 schema | 07 已接线：`agent/created` 在 child 的 scope 隐藏原生入口 |
| `first-message` | Agent 启动 / 首条消息（07 决定） | 07 已接线：`startActivation` 的 prompt 是子代理首条消息 |
| `pre-step` | agent loop 的 `agent/pre-step`（DSH 原生） | 06 已接入目录投递；其余原生用途由 DSH |

- 领域名（`AssemblyChannel`、`AssemblySection`、`AssemblyPlan`）只用于规划与面板；直接与 DSH 服务交互的数据一律用原生名。
- 06 的目录投递直接 extend `agent/pre-step` 通道（core 行监听器），digest 通道保持规划锚点；07 落地时只 extend 上表对应机制，不为通道另造平行接口。

## 5. 顺序、断点与 lint

- **数组顺序**：model-sys → tools → persona → skills → digest → first-message → pre-step。这是缓存分层视图，不等于宿主注册顺序；system 行的宿主顺序看 `order`。
- **断点**：按数组扫描，对 `model / agent / registry / tools` 各取第一个依赖行；没有依赖则不出该维度。断点数组按该固定维度顺序输出。
- **lint**：只比较 system 行（按 `order`），频率序 `model < registry < tools < agent`；相邻两行若前行频率更高且未 `cacheIsolated`，对前行发 `warning`。非 system 通道不参与该 lint。
- **顺序覆盖**：`sectionOrder` 中列出的行按数组顺序排在前面，未列出的行按推荐顺序追加；有覆盖时 system 行按数组下标重新编号，非 system 行 `order` 保持 0。未知名与重复名忽略。
- **插值**：规划器只对 model-sys 行代入 `{{provider}}` / `{{model}}`，并在该行携带 `interpolate: false`；sink 只做机械映射，不再按节名重推。人设行保留原文，交给宿主原生插值。

## 6. 运行时注册生命周期

- **挂点**：调用方在 Agent 的 setup 窗口内把 `agent.ctx` 作为 `AssemblyScope` 传入；注册是 scope-visible 且 scope-lifetime。
- **全量替换**：同一 scope 的再次注册先 dispose 旧注册，再注册全部可执行行；并发注册串行化。
- **失败语义**：注册中途失败要撤销本次已注册的节并 reject，不留半挂载 scope。
- **人设**：`deployment:persona-prefix` 总是注册（空文本也注册），靠同名 scoped 节遮蔽部署级人设；不另起节名。
- **模型行**：仅在 `sysPrompt` 非空时注册。
- **析构**：每个 mount 包进插件 ctx 的 effect；插件被 HMR 卸载时自动 dispose；`AssemblyRegistration.dispose()` 幂等。
- **重载**：服务端 HMR 走 `hmr/change` / `hmr/reload`，析构 effect 是清理点；客户端走 `client-hmr` 的 `graph` / `rebuilt` 帧，面板模块重载后重新拉 `/state`。07 的 agent→plan 关联簿负责重挂。
- **冲突**：同一 Agent scope 若已有别的插件注册同名 `deployment:persona-prefix`（如 agent preset），注册会 throw；07 只能在自己创建的 Agent 上挂载。
- **零持久化**：注册不写盘、不创建 Agent、不启动会话。

## 7. 双模与激活

| 维度 | 兼容模式 | 替换模式 |
|---|---|---|
| 形态 | 基础包，注册进原版 `ctx.systemPrompt` | 额外包，替换原版实现 |
| 服务 key | `agentAssembly` | `agentAssembly`（同一个） |
| 接口 | 基础面 `AgentAssembly` | 宽子类型，只增不改 |
| 激活 | 默认 | `cordis.patch.yml` 停用兼容组装行 + `insert` 替换行 |
| 状态 | 已交付（独立 assembly 行） | 已定，本阶段不实现 |

- `cordis.patch.yml` 按 `id` 覆盖整行；`name` 是校验字段，不能就地改名；被禁用的 required 行按「有意缺席」忽略。
- 两行不得同时 provide `agentAssembly`；同一 profile 只挂一份实现。
- 下游按基础面编码，替换模式返回更丰富的对象也对其不可见；不做能力探测。
- 兼容模式的宿主数据用原生名（`PromptSection` / `SystemPrompt`）；替换模式的宽子类型只增不改基础成员。

## 8. 投影面

- `ControlSnapshot.assemblies` 按 `agentName` 携带规划；缺 key = 链无法解析或组装服务未挂载，面板显示不可用，不编造规划。
- `GET /state` 不新增路由，快照自然携带 `assemblies`。
- 顾问面板以规划替换硬编码通道表；AGENTS.md / compaction 等 DSH 原生行为仍留在静态知识库，fork 头部断点陷阱文案保留。
- `core.snapshot` 已接线：按 Agent 走同一 `composeSession` 路径解析链后调用当前 `agentAssembly.plan`；链耗尽或服务缺席不写 key。

## 9. 状态矩阵

| 区域 | 现有产物 | 状态 | 下一步 |
|---|---|---|---|
| 契约类型与服务 key | `assembly.ts`、`service-keys.ts` | 契约已落；宿主面已改原生名 | 06/07 按通道 extend |
| 宿主注册面切片 | `SystemPrompt`、`PromptSection`、`AssembleContext` | 已扩展（原生名） | 06/07 按需加成员 |
| 纯函数规划器 | `src/agent-assembly/planner.ts` | 已交付 | 06 消费 lint |
| 兼容注册 sink | `src/agent-assembly/sink.ts` | 已交付 | 07 已挂载（`agent/created`） |
| 独立组装插件行 | `src/dsh/host/assembly.ts`、`./assembly` 导出、patch 行 | 已交付 | — |
| `ComposedAgentSession.model` | 接口字段 + 填充 | 已交付 | 07 消费 |
| `ControlSnapshot.assemblies` | 快照投影 | 已交付 | 面板消费 |
| 顾问面板 | 规划表 | 已替换 | — |
| 06 lint 消费 | 无 | 未开始 | 06 |
| 07 召唤与关联簿 | `src/dsh/host/summon.ts`、`src/control/summon.ts`、`test/summon.test.ts`、`test/host-*.test.ts` | 已交付（单元 + 假宿主 + 进程内真实宿主服务验收） | `install_bundle` 仅发布冒烟；#8 按新证据收尾 |
| 替换模式包 | 无 | 已定，不实现 | 后续额外包票 |
| ADR-0006 | 已提交文档 | 已交付 | — |
| GLOSSARY 词条 | 已更新 | 已交付 | — |
| 票 04 规格 | GitHub #5 评论 | 已实现 | 接口文档已同步；进程内真实服务验收已做（`test/host-system-prompt.test.ts`） |

## 10. 不变式与验收门

- **确定性**：同一 `AssemblySession` + 同一 `AssemblyConfig` 必得同一 `AssemblyPlan`。
- **纯规划器**：零 IO、零落盘、不读宿主；规划可在无 profile 的单测里直接跑。
- **唯一注册面**：兼容与替换共用 `agentAssembly`，同一 profile 只有一份实现。
- **只增不改**：替换模式不得改变基础成员的名字、参数与基础返回契约。
- **无能力探测**：基础接口不含 mode；下游不按模式分支。
- **只执行 system 行**：sink 只注册 `executable === true` 的行；锚点留给 06/07/native。
- **宿主面原生名**：直接与 `ctx.systemPrompt` 交互的数据用 `SystemPrompt`、`PromptSection`；不另造同构类型（v1 不做解耦）。
- **数据 extend 原版**：`PromptSection` 保留原生 `text` provider、`interpolate`、`complete`；`complete` 当前未接线，但字段不删。
- **领域名只用于规划**：`AssemblyPlan`、`AssemblySection`、`AssemblyChannel` 不改名；它们是派生规划，不是宿主接口。
- **人设遮蔽**：空正文也必须注册 scoped `deployment:persona-prefix`。
- **失败不留半挂载**：注册失败回滚并 reject。
- **缺 key 即不可用**：快照不构造假规划。
- **守卫**：`pnpm run check` 全绿；import 矩阵不越层。

## 11. 本轮词汇增量

本轮 domain-modeling 在 [GLOSSARY](../../GLOSSARY.md) 的「组装与通道」下新增或修订：

- 新增：通道锚点、顺序豁免（cacheIsolated）、组装注册、兼容模式、替换模式、宽子类型接口。
- 修订：组合会话补「选中的模型条目」；变维度的 `_Avoid_` 把 cacheIsolated 明确为 lint 豁免而非变维度；组装规划补「含通道锚点」。
- 2026-10-27 命名修订：`PERSONA_SECTION` → 原生名 `PERSONA_PREFIX_SECTION`；`AssemblySectionRegistrar` → `SystemPrompt`；`AssemblySectionRegistration` → `PromptSection`；新增 `AssembleContext`、`PromptSectionOrderName`；`AssemblySection.interpolate` 承载注册意图。
- 相关裁决：[ADR-0006](../adr/0006-compat-base-replacement-wide-subtype.md) 补「激活机制核查」事实。

## 12. 权威来源

- 语义：[GLOSSARY](../../GLOSSARY.md)
- 双模裁决：[ADR-0006](../adr/0006-compat-base-replacement-wide-subtype.md)
- 协议形状：[assembly.ts](../../src/contract/assembly.ts)、[service-keys.ts](../../src/contract/service-keys.ts)
- 既有形状：[session.ts](../../src/control/session.ts)、[types.ts](../../src/control/types.ts)、[core.ts](../../src/control/core.ts)
- 实现决策：[issue #5 规格](https://github.com/Golandro/dsh-agent-atelier/issues/5#issuecomment-6383984067)
- 宿主事实：[harness-facts.md](../agents/harness-facts.md)
- 模块职责：[core-design.md](./core-design.md)

## 13. 已知缺口与风险

- **快照体积**：规划含文本，与 `body` / `sysPrompt` 有重复；实测过大时后续在 wire 投影里裁文本，不改规划器。
- **插值边界**：model-sys 只代 provider / model；未知 `{{variable}}` 因 `interpolate: false` 保持字面，需在面板知识库说明。
- **preset 冲突**：同一 Agent scope 的 persona 节只能有一份；07 必须只在自建 Agent 上挂载。
- **模式切换**：停用旧组装行会 dispose 现有挂载；07 的关联簿需在新服务出现后重挂。
- **宿主漂移**：persona order 0、节名、`section()` 返回 disposer 都可能随版本变化；v1 用原生名直接 extend，漂移风险更高，需真机集成测试与后续守卫兜住。
- **complete 未接线**：`PromptSection.complete` 已是原生形状，但兼容 sink 不设置；真正使用 complete 的票必须先明确它与人设遮蔽的关系。
- **digest 仍只建模 / pre-step 已接线**：06 的目录投递走 `agent/pre-step`（core 行监听器），不注册 `systemPrompt.context`；digest 行仍是规划锚点。07 已把 `tools` 通道接到 `ctx.tools.restrict()`（`agent/created` 窗口），把 `first-message` 接到 `startActivation`。
- **宿主 0.2.2-rc.1 的接线事实**：`SubagentStartRequest` 已无 `persona`/`toolFilter`；`system-prompt/assemble` 的 `PromptPresentation` 只含 sections/contexts/variables，tools 在 waterfall 之后由 provider 追加。07 因此不用 assemble 过滤 tools，而用 per-agent `tools.restrict()`；子代理的人设/模型节在 `agent/created`（首条 prompt 组装之前）挂到 child scope。已装 rc.1 的 `startActivation` 参数是嵌套 `request`，且子代理 header 的 `origin` 在顶层（详见 [harness-facts](../agents/harness-facts.md) 的「安装包 rc.1 与源码树漂移」）。
- **文档漂移**：`.scratch/agents-manager/spec.md` 已不存在；当前权威是票面、#5 评论、ADR、GLOSSARY 与本文。
- **票面旧词**：`includes` 已废弃，现字段是 `skills` / 预置技能；注入方式归 07。
