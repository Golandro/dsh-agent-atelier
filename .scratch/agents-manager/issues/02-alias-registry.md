# 02 — 别名与模型注册表

Status: resolved
Type: task
Blocked by: 10（`10` 已于 2026-10-14 `resolved` ⇒ 本票现可开工）

## 范围

实现 registry.yaml 的 schema、加载与合并（spec §5.2）：

1. **双轨 schema**（spec D5/D6）：
   - `models:` 真实模型条目 `{provider, model, sysPrompt, available}`——per-model 系统提示词与可用性挂**真实模型**；`available` v1 为手动开关。
   - `aliases:` 纯指针，v1 为**单目标数组**（`smart: [ds-reasoner]`）；池化是 R1/R2 的落点，schema 留数组不必动。
   - `dsh-default:` 内置别名，**装载时**从 DSH 子代理默认对读取（懒装载快照，`invalidate()` 后重读——D24 同构；原「启动时」措辞按裁决 Q1 修订，2026-10-15）。目标 = 与默认对 provider+model 相等的已声明 models 条目（多个条目同 pair ⇒ 合并结果稳定序第一个），无匹配 ⇒ **隐式合成条目**（无 sysPrompt、`available: true`）——保「别名=纯指针」不变式（裁决 Q2）。运行时读取面 = Cordis 服务 `ctx.agentDefaultModel` 的 `currentSelection()`（不可 import 原生包，ADR-0001；该服务已装配进本 profile；锚点 `core/agent-default-model/src/index.ts:24` 为其 Config 定义）。
2. **合并规则**：profile 全局（`$DSH_HOME/agents/registry.yaml`）+ workspace（`$WORKSPACE/.dsh/agents/registry.yaml`）覆盖合并；别名/模型同名 workspace 胜。**错误面（裁决 Q4）**：某层文件解析/校验失败 ⇒ 该层弃用 + 诊断记录，另一层照常参与合并；两层全坏 ⇒ 空注册表（只含 dsh-default）+ 诊断（软诊断，D21 同构，无硬错）。
3. **校验与 lint**（spec §8；产出一律为 finding 数据，不在 02 运行时硬抛）：
   - modelOrder 引用不存在的别名 = **错误级 finding**（裁决 Q5）：跨层校验以**纯函数**提供——agent 的 `modelOrder`/`model` 数组作入参注入（01 已交付 `src/types.ts:64-66`），02 不扫 agent 根、不消费 `ctx.agentRegistry`；运行时硬错仍归 03 的链耗尽（D8）。逃逸口只指 raw `{provider,model}` 条目，见 03。
   - `dsh-default` 为**保留字**（裁决 Q3）：用户在 registry.yaml 写它 ⇒ 校验错误（与 agent `default` 保留字同构）。
   - 多别名同指一模型 = lint 提示（允许）。
   - raw 条目建议 lint："建议改用别名"。
4. 对 03 暴露纯数据（models+aliases+合并结果）。服务面与 01 同构：懒装载按项目根记忆化 + `invalidate()` + 诊断读面 + `{cwd, signal}` 查询选项；服务键 `aliasRegistry`（原生无占用，已核验；参照 01 避开 `agents` 的教训）。契约实施期冻结并回写本票。
5. **解析器（诊断发现，必做）**：registry.yaml 语法（布尔 `available`、两层块映射 models→条目→字段、四键流映射）超出 01 frontmatter 子集（`src/frontmatter.ts`），需新写最小 YAML 解析器——D23 原则、零运行时依赖（`yaml` 包不可用，`scripts/check.mjs` bundle 项强制）。

## 验收

- 单测：schema 校验（models 条目形状、aliases 单目标数组）；覆盖合并（同名 workspace 胜）；dsh-default 同步（装载时快照；默认对变化 + `invalidate()` 后目标跟随；无匹配条目 ⇒ 隐式合成条目）；别名缺失错误（错误级 finding、纯函数入参注入）；多对一 lint（hint）；`dsh-default` 保留字错误；坏层软诊断（单层坏 ⇒ 另一层照常参与合并；两层全坏 ⇒ 空注册表只含 dsh-default）。
- 未新增运行时依赖；`npm run check` 通过（含锚点）。

## 契约（冻结：03/05/06 消费面，D24）

实施期冻结（scope 第 4 条要求回写本票）；签名与 `src/types.ts`、`src/alias-registry.ts` 一致。

```ts
export const ALIAS_REGISTRY_SERVICE = 'aliasRegistry'
export interface AliasRegistry {
  snapshot(options?: { cwd?: string; signal?: AbortSignal }): Promise<AliasRegistrySnapshot>
  getAlias(aliasName: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<AliasDefinition | undefined>
  getModel(modelName: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<ModelDefinition | undefined>
  diagnostics(options?: { cwd?: string }): Promise<readonly AliasDiagnostic[]>
  invalidate(): void
}
export interface AliasRegistrySnapshot {
  readonly models: readonly ModelDefinition[]      // 合并序：工作区层先、全局层后，同名先到者胜
  readonly aliases: readonly AliasDefinition[]     // 同上；内置 dsh-default 排在末尾
}
export interface ModelDefinition {
  readonly modelName: string
  readonly provider: string
  readonly model: string
  readonly sysPrompt?: string
  readonly available: boolean                      // 缺省 true
  readonly source: 'project-dsh' | 'user-dsh' | 'built-in'
  readonly synthesized?: boolean                   // 仅 dsh-default 的隐式合成条目
  readonly path?: string                           // 内置条目无
}
export interface AliasDefinition {
  readonly alias: string
  readonly targets: readonly string[]              // v1 恒为 1 个（D18）
  readonly source: 'project-dsh' | 'user-dsh' | 'built-in'
  readonly path?: string
}
export interface AliasDiagnostic {
  readonly path: string
  readonly code: 'unparseable-registry' | 'invalid-registry'
  readonly message: string
}
// 纯函数：不扫 agent 根、不读 ctx（Q5），agent 侧数据注入
export function inspectAliasRegistry(
  snapshot: AliasRegistrySnapshot,
  agents?: readonly AgentChainInput[],
): readonly AliasFinding[]
export interface AgentChainInput {
  readonly agentName: string
  readonly modelOrder?: readonly string[]
  readonly model?: readonly { provider: string; model: string }[]
}
export interface AliasFinding {
  readonly severity: 'error' | 'hint'
  readonly code: 'unknown-alias' | 'unknown-model-target' | 'raw-model-escape' | 'alias-fan-in'
  readonly message: string
  readonly agentName?: string
  readonly alias?: string
}
```

冻结语义（实施期决定，连同依据）：

- **装载**：`invalidate()` 是唯一刷新点——层文件与 dsh-default 默认对都在装载时取快照（Q1，D24 同构）。
- **层错误面**：语法坏 ⇒ 一条 `unparseable-registry`（收拢全部语法问题，因 schema 分析已不可靠）；schema 坏 ⇒ 每个问题一条 `invalid-registry`；整层弃用，另一层照常合并（Q4）。
- **dsh-default**：默认对可读即存在；先取合并序第一个 provider+model 相等的已声明条目，无匹配则合成隐式条目（无 sysPrompt、`available: true`、`synthesized: true`）——永保「别名 = 指针」（Q2）。默认对读不到（无服务 / 空选择）⇒ **不存在内置别名，不臆造 provider/model**。
- **保留字**：`dsh-default` 在 `models:` 与 `aliases:` 两处皆为校验错误；连 `models:` 侧也占位，是为了让合成条目与用户条目不会撞名（Q3 的直接推论）。
- **打错字不静默**：未知顶层键、重复键、model 条目未知字段、`available` 非 `true`/`false`、alias 非单目标数组，全部 `invalid-registry`（`alias:` 写错不该静默成空表）。
- **fan-in 提示不含内置别名**：它照默认对生成，否则每个与默认对重合的用户别名都会被误报。
- **别名两种写法**：流式 `[x]` 与块序列 `- x` 都读；v1 仍只接受恰好 1 个目标。
- **发现覆盖面**（复核后登记）：除 scope 四项外，`inspectAliasRegistry` 还校验「别名 → 模型目标」存在性（D6 不变式：别名必须指向一个条目，否则 03 到解析期才炸）。agent 侧的 `model:` 数组**只**用于逃逸口 hint，不做目标存在性校验——按 spec §5.3 / D5，raw 链本就允许直连。
- **默认对不可读**（复核后明确）：`dsh-default` 不存在（不臆造 provider/model）；此时任何引用它的链会得到一条**主机归因**的错误级 finding（「仅当主机暴露可读的 `agentDefaultModel` 默认对时才存在」），而非提示用户去声明一个他无权写的保留字。
- **为 05/06 预留的字段**：`path?`（条目/别名来自哪个层文件，内置项无）与 `synthesized?`（仅 dsh-default 隐式条目）——当前无 src 消费方，是冻结契约的一部分。
- **标量工具共用**：`src/yaml-scalar.ts` 抽出 01 `frontmatter.ts` 的引号/注释/流字面规则，两个读取器共用（零运行时依赖下不复制两份）。

## Comments

- 来源：grilling 共识 D5/D6（spec §2.2）；"别名统一管理 + 传统 model 数组兜底"是用户最终轮裁决。

### 诊断记录（/triage，2026-10-15）

> *This was generated by AI during triage.*

**阶段闸门**：Status 已是 `ready-for-agent`（非 needs-triage）；无 Answer、无实施记录、无 agent brief；`src/` 现存 6 文件全部为票 01 交付物 ⇒ 判定**未动工**，走正常诊断。本记录为该票首个诊断。

**现象**：本票要求的 M2 别名注册表（registry.yaml 的 schema/加载/合并、dsh-default 内置别名、校验与 lint、对 03 的纯数据暴露）在代码库中不存在，DSH 原生亦无对应物；票自 spec 落盘起处于 `ready-for-agent` 但从未挂 agent brief。

**影响范围**：03（`Blocked by: 10,01,02`，前两者已 resolved ⇒ **02 是其唯一剩余阻塞**）；05/06（同样只剩 02）。MS1（M1+M2+M3）与 MS2/MS3 的关键路径都过本票；当前 frontier = 02、08、09。

**核验证据（最小复现）**

- 冗余检查：`grep -rn "alias|registry.yaml|dsh-default" src/ test/` → 命中全为票 01 的测试（`modelOrder: [dsh-default]` 字符串；`test/discovery.test.ts:165` 把 registry.yaml 当发现根下杂散文件写入，测 01 的忽略行为）⇒ 无既有实现，非重复劳动。
- DSH 源码对照：`grep -rln "alias" ~/repo/deepseek-harness/packages/tool-subagent/src/ .../packages/core/llm/src/` → 0 命中 ⇒ 原生无别名机制（spec §3 事实表「模型路由」行成立）。
- 磁盘：`~/.dsh/agents/` 与 workspace `.dsh/agents/` 均不存在 ⇒ 两层 registry.yaml 均未建立。
- 锚点核验：`core/agent-default-model/src/index.ts:24` 经 DSH 源码树（`~/repo/deepseek-harness`）解析成功，`:24` 恰为 `export interface Config {`（provider/model/reasoningEffort 三个 Volatile 字段）⇒ 锚点有效无漂移。
- **运行时读取面（票面未写，实施必读）**：本插件不能 import 该包（ADR-0001 import 边界）；live 读取面是 Cordis 服务 `ctx.agentDefaultModel` 的 `currentSelection(): {provider, model, reasoningEffort?}`。该服务已装配进本 profile（`~/.dsh/profiles/web/cordis.patch.yml` 第 49-52 行，当前默认对 = `volcengine-plan` / `glm-5.3`，无 reasoningEffort）。
- 解析器能力边界：`src/frontmatter.ts`（D23 最小 YAML 子集）只覆盖围栏文档 + 标量/引号串/字符串数组/双键 `{provider, model}` 流映射；registry.yaml 需要**布尔**（`available`）、**两层块映射**（models→条目→字段）、**四键流映射**（spec §5.2 示例的 `{provider, model, sysPrompt, available}`）⇒ 需为本票新写最小解析器（D23 原则；零运行时依赖由 `scripts/check.mjs` 的 bundle 项强制，`yaml` 包不可用）。
- 跨层校验输入已就绪：01 交付的 `AgentDefinition.modelOrder` / `model` 字段（`src/types.ts:64-66`）即「modelOrder 引用不存在的别名」校验所需输入。
- `.out-of-scope/` 不存在 ⇒ 无历史拒绝记录可比对。
- 现状守卫：`npm run check` 全绿（44 锚点 / 46 用例 / build 新鲜 / 运行时零依赖）。

**根因候选（置信度）**

- **C1（95%）** 纯能力缺口（全新实现票，非 bug）：别名注册表未实现，原生亦无。
- **C2（90%）** dsh-default **读取时机**未定：票面「启动时读取」在 D24 懒装载架构里没有明确时刻；默认对是 volatile 配置（GUI 可改，见 profile patch 现值），一次性快照会陈旧（❓Q1）。
- **C3（85%）** dsh-default **目标语义**未定：spec §5.2 示例 `dsh-default: [ds-chat]` 指向 models 条目名，但真实默认对（本机 volcengine-plan/glm-5.3）可能不匹配任何已声明条目；`dsh-default` 是否保留字亦未定（❓Q2/Q3）。
- **C4（75%）** 「modelOrder 引用不存在的别名 = **校验错误**」的落点歧义：该校验需要 01 的 agent 数据作输入，而 02 被规定为纯数据暴露；「校验错误」是 finding 数据还是运行时硬错未定（❓Q5）。
- **C5（60%）** registry.yaml **自身错误面**未定：某层文件解析/校验失败 ⇒ 软诊断弃用该层 vs 硬错（与 D21 哲学的关系需明确，❓Q4）。
- **C6（低，不阻塞）** 服务面/契约未冻结（键名、读面形状）——按 01 票 Q4 裁决先例可实施期冻结并回写票面。

**分流结论**：终态**维持 `ready-for-agent`**（票已在态，无需流转）。依据：未动工 + 无冗余实现 + 无历史拒绝 + 验收标准可测（schema 校验/覆盖合并/dsh-default 同步/别名缺失错误/多对一 lint 均可单测）+ 锚点核验有效。下列裁决项**不阻塞状态本身**，但按 01 先例应在动工前裁决并回填票面；agent brief 待裁决后挂票。

**待裁决清单（对应会话收尾 ❓Q1–Q5）**

1. dsh-default 读取时机：装载时快照 + `invalidate()` 重读（推荐，D24 同构） vs 每查询直读 volatile vs 字面启动时一次性。
2. dsh-default 目标语义：匹配已声明条目、无匹配则隐式合成条目（推荐，保「别名=纯指针」不变式） vs 绕过 models 直指 {provider, model} 对。
3. `dsh-default` 是否保留字：保留字、用户写 = 校验错误（推荐） vs 允许用户覆盖。
4. registry.yaml 自身错误面：软诊断弃用该层（推荐，D21 同构） vs 硬错。
5. 跨层校验读法：02 以纯函数提供、agent 数据入参注入、产出错误级 finding 数据，运行时硬错仍归 03 链耗尽（推荐） vs 02 装载时强校验。

### 维护者裁决（2026-10-15）

> *This was generated by AI during triage.*（记录维护者对诊断 ❓Q1–Q5 的答复与已执行动作）

维护者原话：「全部采取推荐方案」。五项裁决全部按推荐（A）落地，已就地回填上方范围/验收：

- **Q1 → A**：dsh-default 装载时快照 + `invalidate()` 重读（范围第 1 条，「启动时」措辞已修订）。
- **Q2 → A**：目标 = 与默认对相等的已声明条目，无匹配 ⇒ 隐式合成条目（范围第 1 条）。
- **Q3 → A**：`dsh-default` 保留字（范围第 3 条）。
- **Q4 → A**：registry.yaml 软诊断错误面（范围第 2 条）。
- **Q5 → A**：跨层校验 = 纯函数 + 错误级 finding（范围第 3 条第 1 项改写）。

Status 维持 `ready-for-agent`，本票可开工；agent brief 挂票（见下）。

## Answer

> *This was generated by AI during implementation.*

**Status：`resolved`**（commit `85fa97d`，分支 `integration/agents-manager`）。`claimed` 一行未落——实施与回填在同一会话里连续完成，记录在此以免看起来漏了 claim。deck 闸本轮仍 defer，挂账见 `map.md`。

**交付**（实施提交 `85fa97d`；复核后修正见 `6820f23`）：

- `src/registry-file.ts`（新，403 行）：单层读取器——自写最小 YAML 子集解析（两层块映射、流式映射/序列、布尔、引号、注释）+ schema 校验；整层读或整层拒（Q4）。
- `src/alias-registry.ts`（新，281 行）：层表与合并、dsh-default 同步（Q1/Q2）、按项目根记忆化的 `ctx.aliasRegistry` 服务、纯函数 `inspectAliasRegistry`（Q5）。
- `src/types.ts`：02 的冻结契约（见上）；`ModelDeclaration`/`AliasDeclaration` 是唯一形状声明，`ModelDefinition`/`AliasDefinition` 只加 provenance（复核后收敛）。
- `src/yaml-scalar.ts`（新，110 行）：抽出 01 `frontmatter.ts` 的引号/注释/流字面标量规则共用；`frontmatter.ts` 由 475 行降至 380 行（行为不变，11 个既有用例原样通过）。
- `src/roots.ts`（新，78 行）+ `src/lazy-load.ts`（新，62 行）：把 01 与 02 都在用的**项目根走查/home 解析**与**懒加载记忆化**各收一处；01 的 `scanFor` 改由共享 loader 驱动（`discovery.ts` 397 → 308 行），两份 `NO_PROJECT_ROOT_KEY` 合并为一份（复核后抽出）。
- `src/index.ts`：注册 `aliasRegistry`；默认对读取面在**用时**解析 `ctx.agentDefaultModel`（01 修复轮教训）。
- 测试：`test/registry-file.test.ts`（15 例）、`test/alias-registry.test.ts`（20 例）、`test/plugin.test.ts` +3 例。
- 文档：`CONTEXT.md` 新增「模型与别名」术语（模型条目 / 别名 / 别名注册表 / 层 / 发现）并细化 Dsh-default；`README.md` 补 02 交付与两个服务面，并把安装验证一节改为「loader entry + 单测」（harness-facts：plain-object service 不进 Host 服务目录）。

**验收对照**：`## 验收` 每一条都有单测落地（覆盖合并/同名胜、dsh-default 快照与 invalidate 跟随、无匹配合成、保留字、坏层弃用与两层全坏、别名缺失错误级 finding、多对一 hint、跨层校验纯度）。终态 `npm run check` 全绿：静态守卫（无探针残留、`lib/` 新鲜、零 runtime `dependencies`、54 处锚点全解析）+ typecheck + **83 用例**（上车 46 → 增 37）。**未新增运行时依赖**。

**真机复核**（harness-facts「票面事实先复核」）：

- `ctx.agentDefaultModel` 服务键与 `currentSelection()` 签名在 `core/agent-default-model/src/index.ts:67` 核对：同步、返回 `{provider, model, reasoningEffort?}`、不抛。本 profile 的 patch 里该服务带 `provider: volcengine-plan` / `model: glm-5.3`，故真机上默认对可读。
- 服务键 `aliasRegistry` 在 DSH 源码、装好的 dsh lib bundle、profile patch 三处 grep 均无占用。本会话没有 `cordis_inspect_query` 工具，故未走 harness-facts 推荐的 `listService` 探针——该探针按 harness-facts 本身也照不到 plain-object service。
- 票面锚点漂移由守卫 anchors 项兜住（50 处全解析，含本票新增的 `core/agent-default-model/src/index.ts:24`、`src/types.ts:64-66`、`agent-control-prototype.html:209`）。

**两轴 `/code-review`**：fixed point `5bfa19b` ⇒ `git diff 5bfa19b...HEAD` 只含本票那一笔（`85fa97d`）；两轴各跑一个子代理（`deepseek-official/deepseek-flash`）。

### 两轴复核结论

**Standards 轴**（8 条：1 条文档标准违背、6 条基线嗅探、1 条已按文档抑制）：

| 发现 | 处置 |
|------|------|
| `AliasRegistrySource` 写 `'builtin'`，glossary 的 Origin 与 `AgentOrigin` 都是 `'built-in'`（`docs/agents/domain.md` 禁同义词漂移） | **已修**：全仓（含票面契约、测试）改 `'built-in'` |
| 一概念两名：`ModelEntry`/`AliasEntry` vs `ModelDefinition`/`AliasDefinition`；`RegistryLayerFailureCode` 重抄 `AliasDiagnosticCode` 联合 | **已修**：`ModelDeclaration`/`AliasDeclaration` 为唯一声明，Definition 只加 provenance；failure code 改为 `AliasDiagnosticCode` 的类型别名 |
| `loadFor`（02）≈ 逐行抄 `scanFor`（01），含第二份 `NO_PROJECT_ROOT_KEY` | **已修**：抽出 `src/lazy-load.ts`，两注册表共用；根走查/home 解析同时抽到 `src/roots.ts` |
| `readFields`/`readItems` 骨架与三臂联合重复 | **记录为判断题**：两者读的 schema 不同（映射 vs 序列），合成一个带 mode 的 `readValue` 比两份 15 行更难读，不修 |
| `readAvailable` 的 text `'true'`/`'false'` 分支不可达；`provider ?? ''` 属类型补丁 | **已修**：删不可达分支；改用 `isFilled` 类型守卫 + 早返回（守卫同时收紧类型） |
| `{provider, model}` 松散对（Data Clumps / Primitive Obsession） | **记录为接受偏差**：契约镜像 spec §5.2 的扁平 `provider:`/`model:` 与既有 `AgentModelTarget`，嵌套 `target` 会把 walk 推给 03；已写进 `ModelDeclaration` 注释 |
| `path?`/`synthesized?` 只被测试读 | **记录为接受偏差**：冻结契约是给 05（UI 要显示条目来自哪层）与 06 的 |
| 单元素 `targets` 数组 | 按 CONTEXT.md「v1 单目标数组」抑制（复核方亦据此抑制） |

**Spec 轴**（4 条 + 3 项核验通过）：

| 发现 | 处置 |
|------|------|
| `model` 数组"惰性"：只发逃逸口提示，不与已声明模型做存在性比对 | **记录为意图**：raw `model:` 是 D5 明确允许的逃逸口，按 spec §5.3 直连 provider/model，**不该**做存在性校验；`model` 入参确实参与判定（出 hint）。既有用例已锁「raw 链只出 1 条 hint、不出 error」 |
| 默认对读不到 ⇒ 无内置别名 ⇒ bundled `default` 的链被判错误级 `unknown-alias`（01 的兼容桥被误伤） | **已修**：该 finding 的 message 改为主机归因（「仅当主机暴露可读的 agentDefaultModel 默认对时才存在」），并补端到端用例（无对 + bundled 形状的链）。severity 仍为 error——此时链**确实**断（03 会硬错），但不再是用户无从下手的死路 |
| `unknown-model-target`（别名 → 模型目标）不在 scope 四项清单内 | **记录为增补**：D6 的「别名=纯指针」不变式要成立就得校验目标存在，否则 03 到解析期才发现。已登记进冻结语义 |
| `dsh-default` 保留字连 `models:` 侧也占位，票面只写了别名侧 | **已记录**：Q3「写它 ⇒ 校验错误」的直接推论（避免合成条目与用户条目撞名）；README / CONTEXT / 冻结语义均已写明 |

核验通过（复核方独立确认为真）：跨层校验是**纯函数**（不扫 agent 根、不读 `ctx.agentRegistry`）；dsh-default 是**装载时快照**（每 load 读一次默认对，`invalidate()` 唯一刷新）；**坏层整层弃用**且另一层照常合并、两层全坏只剩内置别名。

## Agent Brief

**Category:** enhancement
**Summary:** 从零实现 registry.yaml 的 schema、加载、覆盖合并与校验 lint，产出 M2 别名注册表，对 03 暴露纯数据。

**Current behavior:**
插件只有票 01 的 agent 注册表：`ctx.agentRegistry` 服务（发现/解析链，`src/types.ts` 冻结契约）。没有任何 registry.yaml 概念——两层路径（`$DSH_HOME/agents/registry.yaml`、workspace `.dsh/agents/registry.yaml`）在磁盘上都不存在，DSH 原生模型路由也无别名机制（spec §3）。内置默认 agent 的链是 `modelOrder: [dsh-default]`（`bundled/default/default.agent.md`），但 `dsh-default` 尚无人能解析。

**Desired behavior:**
- **双轨 schema（D5/D6）**：`models:` 真实模型条目 `{provider, model, sysPrompt, available}`（available v1 手动开关）；`aliases:` 纯指针单目标数组（池化是 08/09 落点，schema 留数组）。
- **dsh-default 内置别名**：装载时快照读默认对（`invalidate()` 重读）；目标 = 与默认对 provider+model 相等的已声明条目，无匹配 ⇒ 隐式合成条目（无 sysPrompt、available: true）；读取面 = `ctx.agentDefaultModel.currentSelection()`，**按用时解析**（照 01 修复轮 resolveFileSystem 模式，勿在 apply() 里一次性快照 ctx）。
- **覆盖合并**：全局层 + workspace 层，同名 workspace 胜；坏层软诊断弃用（另一层照常；两层全坏 ⇒ 空注册表只含 dsh-default）。
- **校验与 lint 全部为 finding 数据**：`dsh-default` 保留字（用户写 = 错误）、多对一 hint、跨层校验纯函数（agent modelOrder/model 入参注入 ⇒ 悬空引用 = 错误级 finding）。不在 02 运行时硬抛。
- **纯数据暴露**：models+aliases+合并结果给 03；服务面与 01 同构（懒装载按项目根记忆化 + invalidate + 诊断读面 + `{cwd, signal}`）。
- **新写最小 YAML 解析器**：registry.yaml 专属子集（布尔、两层块映射、四键流映射），零运行时依赖。

**Key interfaces:**
- 服务键 `aliasRegistry`（原生无占用，已核验 2026-10-15；参照 01 避开 `agents` 的教训）。
- `ctx.agentDefaultModel.currentSelection(): {provider, model, reasoningEffort?}`——默认对读取面（ADR-0001：不可 import 原生包）。
- 跨层校验纯函数入参：`AgentDefinition.modelOrder` / `model`（`src/types.ts:64-66`，01 已交付）。
- 原型领域参照：`agent-control-prototype.html:209`（REAL_MODELS 条目）与 `:266`（aliases 映射）——注意原型别名是字符串单目标，v1 schema 是单目标数组；`resolveModel`（`:282-285`）属 03 的规格参照，不在本票。
- 契约（读面形状 / finding 类型）实施期冻结并回写本票（01 票 Q4 先例）。

**Acceptance criteria:**
- [ ] schema 校验有单测（models 条目形状、aliases 单目标数组）
- [ ] 覆盖合并有单测（同名 workspace 胜）
- [ ] dsh-default 同步有单测：装载时快照；默认对变化 + `invalidate()` 后目标跟随；无匹配条目 ⇒ 隐式合成条目
- [ ] 别名缺失错误有单测（错误级 finding、纯函数入参注入）
- [ ] 多对一 lint（hint）有单测
- [ ] `dsh-default` 保留字（用户写 ⇒ 校验错误）有单测
- [ ] 坏层软诊断有单测（单层坏 ⇒ 另一层照常参与合并；两层全坏 ⇒ 空注册表只含 dsh-default）
- [ ] 未新增运行时依赖；`npm run check` 通过

**Out of scope:**
- 解析引擎与链遍历（03）、组装与通道（04）、UI（05）、目录注入与警告呈现（06）、召唤与替换（07）
- 池化与故障转移语义（08/09 研究票）
- 更多发现根（spec 定死两层；`.agents/agents/registry.yaml` 与 `$DSH_AGENTS_HOME` 不做）
- watcher / 文件监听（明确不做，与 01 一致）
- 修改零依赖守卫或脚手架决定（npm 工具链、服务键命名约定）

**实施注意**（票 10 交接 + 01 修复轮沉淀）：npm（非 pnpm）；相对 import 写 `./x.ts`；改 `src/` 后必须 `npm run build` 再跑 check；ctx 服务一律按用时解析（01 修复轮 Spec 1 教训）；票面 `path:line` 锚点动工前真机复核。
