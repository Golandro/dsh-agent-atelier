# R1 findings — 别名与 provider/model 的关联结构（ticket #9，旧编号 08）

> 子票：GitHub issue [#9](https://github.com/Golandro/dsh-agent-atelier/issues/9)（R1：别名↔provider/model 关联方案，研究）。父图：[#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)。
> 日期：2026-10-23。作者：R1 研究子代理（volcengine-plan/deepseek-v4.1-flash 路由；前序 codebuddy 会话三次 idleTimeout 无产物）。
> 一手源：本仓 `src/` 与 `node_modules/.cache/spec.md`（spec 全文 24,691 B，由 Lead 从 git 历史 `f0e5719` 前转存，与删除前一致）；GitHub 票 #1/#2/#3/#31（REST 读；`gh issue view` 本轮报 502）；R2 findings `docs/research/2026-10-23-r2-load-control-failover.md`（已提交 `d8ef3fb`）；DSH 源码树 `~/repo/deepseek-harness/packages`（= `.vendor/deepseek-harness` 软链）。
> **Lead 给的安装树路径** `/home/gg/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/` **在本机不存在**（nvm 目录下无 `lib/node_modules`，pnpm 全局 bin 为 `~/.local/share/pnpm/bin/dsh`）⇒ 本轮宿主事实一律以源码树为准。
> 本文件**只读**表达：不改 `src/`、不改 spec/CONTEXT/GLOSSARY、不动 GitHub issue、不 commit。spec 修订以「草案」形式给出（§7），由 Team Lead 择机套用。

---

## 0. 结论摘要

1. **别名 = 有序池（v1 的单目标数组就是池长 1 的特例）**。池内条目的两类用途**不混用**：同一模型经多条供应商线路 = **路由冗余**；不同模型 = **能力梯度**。梯度不放进池，而由 agent 的 `modelOrder` 多别名表达。一个别名 = 「一个意图 → 一组可互换的线路」。
2. **两级故障结构 = 模型条目（`models:`，调优层）↔ 线路（同一 `model` 的不同 `provider`）**。别名池只引用**模型条目名**；「供应商故障 ≠ 模型故障」用两层**配置轴**表达：**线路级 `available`**（这条供应线）与**模型级 `modelGroup`**（同一组任一条目关 ⇒ 整组不可用）。引擎既有的「`available:false` ⇒ `unavailable` 跳过」逐条目判定，天然就是第一层；第二层只需在装载时做一次组汇总。
3. **池条目 schema = 裸模型条目名（字符串）**，与 v1 完全同形，`targets` 只是从「恰好 1 个」放开为「≥ 1 个有序」。**不引入 YAML 新语法形状**：现有读器 `readItems`（流式 `[a, b]` / 块式 `- a`）直接可用。**per-target 覆盖不进池**（§5）。
4. **`dsh-default` 裁决：永远是单目标指针**——指向与 DSH 默认对 `provider+model` 精确相等的已声明模型条目（无匹配则合成隐式条目），**不是池、不参与转移**、两处保留字不变。它要的「备份线」由 D4 别名（`modelOrder: [dsh-default, <自家别名>]`）表达。
5. **向后兼容**：`aliases: {smart: [ds-reasoner]}` 原样合法，零迁移、无版本号字段；只需放开读器一处校验 + 修下游三处「池长 1」假设。
6. **给 R2 的输入结构**：R2 的 A1–A5 **全部确认**（A3 补 effort 落点、A5 不适用），池条目形状不变，R2 可直接把 §2.1 的「假设」升级为「已确认」。

---

## 1. 一手源核实（对照票面与 R2 的陈述）

### 1.1 本仓侧（已读，非转述）

| # | 事实 | 位置 |
|---|------|------|
| W1 | 读器顶层只认 `models`/`aliases` 两键；`readFields`（流式映射 / **一层**块映射）与 `readItems`（流式数组 / **一层**块序列）两种形状，字段值只能是标量——`field "x" ... must hold an inline value` 是硬拒绝 | `src/core/catalog/registry-file.ts:95-98`、`:230-268`、`:259-262` |
| W2 | 别名校验 = **恰好 1 个非空目标**；形状错误文案写死 `alias "x" must be an inline single-target array, e.g. x: [ds-chat]`；`[]` 与池 `[a, b]` 都按 `invalid-registry` **弃整层** | `src/core/catalog/registry-file.ts:216-225` |
| W3 | 读器模块头自承「v1 is a single-target array, so the pool form is R1/R2 work, not a schema change」 | `src/core/catalog/registry-file.ts:1-23` |
| W4 | `readItems` 的**块序列分支已存在**并接受多行 `- item`；流式分支用 `flowInner('[')` 取内层再 `splitTopLevel` ⇒ 池「≥1 个字符串」今天就可读 | `src/core/catalog/registry-file.ts:271-303` |
| W5 | `ModelDeclaration` = `{modelName, provider, model, sysPrompt?, available}`；**无 provider 分组概念、无 effort 列**；契约注释「Provider and model stay flat … consumers never walk a nested pair」 | `src/contract/types.ts:139-155` |
| W6 | `AliasDeclaration.targets: readonly string[]`，注释「v1 holds exactly one model entry name; the pool form is R1/R2 work (D18)」——**契约形状已是数组** | `src/contract/types.ts:166-178` |
| W7 | `AliasChainStep.modelName` 的选取是「`winner.orderIndex === step.orderIndex` 时取 winner」，池内先跳过后胜出时会**指向先出现但被跳过的那条** | `src/contract/types.ts:347-362`、`src/core/resolve/model-chain.ts:245-249` |
| W8 | 引擎候选流水线：`available` 先于白名单；胜者 = **第一个无 skipped 的候选**（声明序） | `src/core/resolve/model-chain.ts:109-142`、`:238` |
| W9 | effort：`itemEffort[winner.modelName] ?? agent.reasoningEffort`；`ChainItemEffort` 是**注入表**，注释承认「A `models:` entry has no effort column in spec §5.2, so the override table is injected」 | `src/core/resolve/model-chain.ts:49-55`、`:269-274` |
| W10 | 内置 `dsh-default`：读默认对 → 找 `provider+model` 精确相等的已声明条目，找到则指向它，否则**合成隐式条目**（`synthesized: true`、`available: true`、无 sysPrompt）；别名侧恒 `targets: [一个名字]` | `src/core/catalog/alias-registry.ts:183-210` |
| W11 | `dsh-default` 在 `models:` 与 `aliases:` **两处都是保留字**（用户写 = schema 错误） | `src/core/catalog/registry-file.ts:148-151`、`:207-210` |
| W12 | `inspectAliasRegistry` 逐 target 校验存在性（`unknown-model-target`）；fan-in 按**每个 target** 计数 | `src/core/catalog/alias-registry.ts:230-257` |
| W13 | 写面：`remapAlias` 收**单个 target 字符串并整条重写**为 `alias: [target]`；`addAlias` 同样单目标；无池类编辑 | `src/control/types.ts:143-165`、`src/control/registry-edit.ts:186-198`、`:218-230` |
| W14 | UI 只读 `targets[0]`：顾问面板 `currentTarget` / `setTargetDraft` | `src/dsh/client/advisor.tsx:114`、`:219` |
| W15 | 读器单测把「池」写死为**拒绝**：`smart: [ds-reasoner, ds-chat]` 的错误里必须含 `single` | `test/registry-file.test.ts:122-128` |
| W16 | 层语义 = 层内同名先声明生效、层间 workspace 胜；**本名粒度、不崩溃合并** | `src/core/catalog/alias-registry.ts:120-152` |
| W17 | frontmatter 字段编译器只认字符串数组（`ARRAY_FIELDS`），`modelOrder` 无法携带对象（影响 §5 的 effort 落点论证） | `src/control/frontmatter-edit.ts:18` |

### 1.2 DSH 宿主侧（源码树直读）

| # | 事实 | 位置 |
|---|------|------|
| H1 | provider 是**注册期命名空间**：同一 provider id 只能挂一个 adapter（`DUPLICATE_ADAPTER`），provider id 必须与注册名一致（`INVALID_ADAPTER`）⇒ 「同一 provider、不同 key/网关」在 DSH 里**必须已经是两个 provider id** | `llm/llm/src/index.ts:435-460` |
| H2 | 路由注册/替换会广播 `llm/adapters-updated`——插件未来订阅供应商可用性的合法入口 | `llm/llm/src/index.ts:371`、`:465`；`llm/llm/src/types.ts:23` |
| H3 | 默认模型 = 配置里的**单个** `{provider, model, reasoningEffort?}`（Volatile），`currentSelection()` 同步返回；**默认只有一个对，没有池** | `core/agent-default-model/src/index.ts:17-30`、`:66-75` |
| H4 | 子代理默认继承父的 provider/model/effort；**路由变了却没显式给 effort ⇒ 清掉父的 route-owned effort** | `subagent/subagent/src/child-agent.ts:99-121` |
| H5 | effort 可支持性按**精确 (provider, model)** 查 adapter 元数据，不支持则 preflight 抛 `UNSUPPORTED_REASONING_EFFORT`，**不夹取不别名化** ⇒ 同一 model 经不同 provider，effort 支持面可能不同 | `llm/llm/src/index.ts:915-935` |
| H6 | 既有双供应商共存的真实形态：`deepseek-official`（API key）与 `deepseek-account`（账户 token，把 `QUOTA`/`401` 重标为 `ACCOUNT_*`）——同批模型 id、两条线路、不同错误指纹 | `llm/llm-deepseek-api-key/src/index.ts:15`；`llm/llm-deepseek-account/src/index.ts:22`、`:58-76` |

### 1.3 与票面 / 规格 / R2 的漂移（逐条）

| # | 漂移 | 处理 |
|---|------|------|
| D-1 | 票面第 2 问的示例形如 `model: ds-chat` + `routes: [official, mirror]`——**两级嵌套形状**，与 D6「别名=纯指针、调优层挂模型条目」冲突 | 不采纳嵌套；改为「模型条目 × provider 线路」在**扁平的两层 `available` + `modelGroup`** 上表达（§2.2、§3），并给出读器/UI 代价论证 |
| D-2 | spec §5.2 注释「池化 = R1/R2 落点」与 GLOSSARY「模型条目…provider/model 对」未说清池目标能否是同一模型的另一条线路 | §7.1 给出 §5.2 修订文本 |
| D-3 | R2 A2「池只引用模型条目、不内联 `{provider, model}`」——**成立** | 升级为正式裁决，补理由与代价 |
| D-4 | R2 A3「per-target 覆盖不在池里」——**成立但不完整**：没说 effort 该在哪；现状 `ChainItemEffort` **无声明来源**（W9，票 #31 待决） | 补落点建议：`models:` 条目加可选 `effort` 列，交 #31（§5.1） |
| D-5 | R2 §2.6 措辞「`dsh-default` 池化 = 不变」，易读成池化后它也参与 | 澄清：`dsh-default` **不参与池化**（§4） |
| D-6 | Lead 给的 DSH 安装树路径不存在（见文件头）；R2 findings 引用的「安装树 dist 行号」本轮无法复核 | 改以源码树为锚点；R2 的 F11/F12/F13 抽查与源码一致 |
| D-7 | 票面产出要求「追加 `## Answer`、Status → resolved、map.md 记一行」——Lead 已接管 GitHub 协议操作 | 本轮只落本文件，`## Answer` 由 Lead 摘要补入 |
| D-8 | 用户 `aliases:` 两个目标是**同一 provider+model 对**（不同条目名）时，现有 fan-in 提示看不到（按条目名而非线路去重）；池化后这种「等价冗余」会变常见 | 记入 §8 后续票 |

---

## 2. 推荐方案与理由（逐条回答开放问题）

### 2.1 Q1：单目标还是池？池内是什么？

**裁决：v1 的「单目标数组」就是池长 1；池 = 有序模型条目名数组，顺序即优先级、不轮询。池内两类目标语义不同，必须分开用：**

| 用途 | 写法 | 表达什么 | 例子 |
|------|------|---------|------|
| **路由冗余**（同模型、不同线路） | 池内放多个 `models:` 条目，`model` 相同、`provider` 不同（或因凭证/配置不同而**必须**是不同 provider id，H1） | 「这个意图，换条线路还能跑」 | `smart: [reasoner-official, reasoner-account]` |
| **能力梯度**（不同模型、从强到弱） | **不放池**，写进 agent 的 `modelOrder` 多别名 | 「这个专家，先强模型，不行再退档」 | `modelOrder: [smart, fast]`，`smart`/`fast` 各自是池 |

**理由**

1. **梯度不属于别名的内部结构**：D6 把别名定义为「意图名」，一个意图对应一个能力档位。把 `ds-chat` 与 `ds-reasoner` 塞进同一个池，把 agent 的**意图声明**降格成一条**故障排序**；一旦转移发生就静默换能力档位，而人设（正文）、sysPrompt（挂模型条目，D6）与 effort 支持（H5）会一起变。梯度本来就是 `modelOrder` 在表达（spec §5.3-1），重复表达 = 两处真相。
2. **冗余必须能在别名内部表达**：故障转移发生在「别名内部」（R2 的题目），而 agent 文档是**静态的**、不随运行台账变化。池内加几条线路**不改 agent 文档一个字**——这正是「注入名稳定」（D6 + §6 digest 门控）要的。
3. **一别名多模型会掏空 §8 的「多对一」语义**：现在的 fan-in 说「多个别名指同一模型 = 意图重叠」；若池内也能堆不同模型，「意图」就失效，UI 也无法把一个池渲染成可解释的排序。

**明确不做**：`smart: [ds-reasoner, ds-chat]` 这种「强→弱」池。要做梯度写 `modelOrder: [smart, fast]`。池内跨模型**不是语法错误**（引擎能解析），但应出 lint hint（§7.4）。

### 2.2 Q2：两级故障结构（供应商故障 ≠ 模型故障）

**裁决：分两层表达，用既有 schema 的「两层 `available`」，不用新的嵌套 `routes:` 块。**

- **线路层（供应线）**：一条 `models:` 条目 = 「模型 id × 一个 provider 线路」。它的 `available` 管「**这条供应线**」：`reasoner-account` 欠费 ⇒ 只关它，`reasoner-official` 照常。
- **模型层（能力）**：同一 `model` id 的所有线路 = 「**这个模型**」。全部线路不可用 = 模型不可用；引擎**逐条目的 `unavailable` 跳过**天然让整个模型退出池，**零新代码**。
- **唯一新增语义 = 模型级开关**：不想在每条线路条目上各写一遍 `available: false`（D14 要 UI 与配置 1:1，重复真相会在回写时打架）。做法**不是**嵌套块，而是模型条目加一列可选 **`modelGroup`**（缺省 = 自己的条目名）：

```yaml
models:
  reasoner-official: { provider: deepseek-official, model: deepseek-reasoner, available: true }
  reasoner-account:  { provider: deepseek-account,  model: deepseek-reasoner, available: false, modelGroup: reasoner }
  reasoner-mirror:   { provider: my-mirror,        model: deepseek-reasoner, available: true,  modelGroup: reasoner }
```

规则：**同一 `modelGroup` 下任一条目 `available: false` ⇒ 整组不可用**（任一线路宣布模型级不可用，就足以代表模型故障）。于是：关一条线 = 改那一条；关整个模型 = 改任一条并打同组标记（UI 提供「整组关闭」一键，落地为多条编辑）；**不需要嵌套 YAML**，现有读器照读（W1/W4）；R2 台账也能直接用 `modelGroup` 作**模型级聚合键**（§6.2）。

**为什么不采纳票面的 `model: ds-chat` + `routes: [official, mirror]`**：它把「模型」变成有名字的中间层，而 registry 的模型名**已经**是 `models:` 的 key。嵌套会造出第三个名字空间（别名 → 模型条目 → 线路），UI（D14 的 1:1）、写面（W13 的 line-splice 编辑器）、读器（W1 只支持一层块映射）三处都要重写，换来的只是把同一件事写成两种结构。若某条线路真需要不同的 sysPrompt，那本来就是**两个模型条目**（§5）。

### 2.3 Q3：池条目 schema——`{provider, model}` 对够不够？

**裁决：池条目 = 字符串（模型条目名），不是 `{provider, model}` 对，也不内联对象。**

- **对不够**：`{provider, model}` 已是 `models:` 条目的字段（W5），池再写一遍就是**重复真相**——换线路要改两处，UI 的 1:1 也破。
- **内联也不行**：内联条目让「调优层（sysPrompt / available / effort）」无处可挂（D6 要求挂模型条目），要么退化为匿名模型条目（破坏「一切皆注册表」D4），要么禁止调优（自相矛盾）。
- **sysPrompt 的 per-target 差异**：不是覆盖，而是**两个模型条目**，池里放两个名字。
- **effort 的 per-target 差异**：**不进池**（R2 A3 确认）；落点建议在 `models:` 条目（§5.1，交 #31）。

### 2.4 Q4：`dsh-default` 在池化下的语义

**裁决：保持单目标指针，永不池化、不参与转移**（§4 详解）。

### 2.5 Q5：v1 单目标数组的向后兼容

**裁决：不需要版本号、不需要迁移、不需要双读器。**`aliases: {smart: [ds-reasoner]}` 就是「池长 1」，与今天逐字一致（引擎取第一个可用目标）。只改**校验放开 + 三处下游假设**（§3.2）。

---

## 3. registry.yaml v2 池 schema 提案

### 3.1 形状

```yaml
models:                                    # 真实模型条目：调优层挂这里（D6，不变）
  reasoner-official:                       # 线路条目：同一 model id，一条 provider 线路
    provider: deepseek-official
    model: deepseek-reasoner
    sysPrompt: "推理档位：优先结构化拆解。"
    available: true
    modelGroup: reasoner                   # 新增（可选）：模型级开关 / 台账聚合键；缺省 = 自身条目名
  reasoner-account:
    provider: deepseek-account
    model: deepseek-reasoner
    available: true
    modelGroup: reasoner
  chat-official: { provider: deepseek-official, model: deepseek-chat, available: true }
  chat-fast:     { provider: my-mirror,        model: deepseek-chat, available: true }

aliases:                                   # 有序池：模型条目名，顺序即优先级（不轮询）
  smart: [reasoner-official, reasoner-account]   # 池长 2：路由冗余（同模型两线路）
  fast:  [chat-official, chat-fast]              # 池长 2：同上
  solo:  [chat-official]                         # 池长 1：v1 形态，原样合法
  solo-block:                                    # 块式写法（v1 读器已支持，W4）
    - chat-official
```

**schema 规则（相对 v1 的增量）**

| 规则 | v1 | v2 |
|------|----|----|
| alias 值形状 | 单目标数组 `[a]` | **非空**有序字符串数组（`[a]`、`[a, b]`、块式 `- a`） |
| 目标必须是模型条目名 | 是（`unknown-model-target` finding） | 不变 |
| 重复目标 | — | `[a, a]` = schema 错误（重复只会让台账两轴失真） |
| 跨模型混池 | — | 合法但 **lint hint**（`pool-mixed-models`） |
| `dsh-default` | 保留字 | 不变（两处保留字，W11） |
| `models:` 字段 | `provider/model/sysPrompt/available` | + `modelGroup`（可选）；+ `effort`（**建议**，待 #31，§5.1） |
| 同一 model 多条目 | 自由（线路冗余） | 不变 |

### 3.2 读器兼容评估与代码影响面

| 读器能力 | 池需要吗 | 现状 | 结论 |
|---------|---------|------|------|
| 流式数组 `[a, b]` | 是 | `readItems` 已支持（W1/W4） | **无需扩展** |
| 块式数组（多行 `- a`） | 可选 | 已支持（W4） | **无需扩展** |
| 一层块映射（字段值 = 标量） | 是 | `readFields` 的 `nested` 分支（W1） | **无需扩展** |
| 嵌套映射 | **不需要**（池条目是字符串） | 硬拒绝 `must hold an inline value` | **不需要**（这正是拒绝 `routes:` 嵌套的实际理由） |
| 新标量类型 | 不需要 | 布尔已有；数值按 text | 不需要 |

**需要动的代码（本票不实施，列为实施票输入）**

| 文件 | 改动 |
|------|------|
| `src/core/catalog/registry-file.ts:216-225` | 「必须恰好 1 个」→「≥ 1 个、无重复、无空串」；`shapeProblem` 文案改为「a list of model entry names」 |
| `src/core/catalog/registry-file.ts:96` `MODEL_FIELDS` + `mapModelEntry` | 加 `modelGroup`（+ 可选 `effort`）读取 |
| `src/contract/types.ts:146-155` | `ModelDeclaration` 加 `modelGroup?: string`（+ 可选 `effort?: string`）；`AliasDeclaration.targets` **类型不变** |
| `src/core/catalog/alias-registry.ts:191-210` | 装载时做组级可用性汇总；`withBuiltInAlias` 的单目标结论不变 |
| `src/core/resolve/model-chain.ts:245-249` | `AliasChainStep.modelName` 改取「本 step **胜出**的候选」而非第一个同 `orderIndex` 的候选（W7 的既有小 bug，池 >1 时才暴露） |
| `src/control/registry-edit.ts:186-198`、`:218-230` | `remapAlias` / `addAlias` 放开为多目标，或新增 `setAliasTargets`；避免「整条重写」静默清空池 |
| `src/dsh/client/advisor.tsx:114`、`:219` | `targets[0]` → 渲染整个池 |
| `test/registry-file.test.ts:122-128` | 「拒绝池」翻转为「接受池、拒绝空数组/重复」 |

> **R1-A 落地回注（ticket #35，2026-10-23）**：上表前三行与末行已实施，池语义写入读器与装载；其余行按票面边界留给 R1-B/C/D。
>
> - **读器**（`registry-file.ts`）：池 = ≥1 个非空、无重复的模型条目名，流式与块式同形；形状文案「a list of model entry names」，重复目标单独报错（台账按条目计数，重复会重复计）。`MODEL_FIELDS` 增 `modelGroup`/`effort` 两列标量，**读器不给缺省**（`modelGroup` 缺省 = 自身名的读法属于消费方）。
> - **组级可用性落点**：`alias-registry.ts` 的 `foldModelGroups` 在**合并 + 内置指针之后**把组开关折进每条目的 `available`（同组任一条目 `false` ⇒ 全组读 `false`）。引擎因此保持「逐条目判 `available`」的单一流水线，零新分支；换层覆盖改变的是「生效集合」，折叠看的就是它。折叠**不改**条目的 `modelGroup` 字段，也不删条目。
> - **fan-in 口径**（D-8）：按**线路键 `provider/model`** 计数，非条目名；同一别名在一个线路上只计一次；内置指针仍排除。**R1-F 的同池等价冗余**（两条目同名不同线路、同一池）因此**不产生**独立 hint——fan-in 按线路判之，两条同线路条目不会互增——留给 R1-F 决定是否单列一条信息性 hint。
> - **两条新 hint**：`pool-mixed-models`（池内 `model` 不同，文案指向 agent 的 `modelOrder`）与 `pool-mixed-groups`（池内 `modelGroup ?? modelName` 不一致）。注意：`modelGroup` 是可选的，**视而不见地混池**（两条目都不写组）同样报 `pool-mixed-groups`，这与 §7.4「同池异组 ⇒ 组级开关失效」一致。
> - **锚点**：本文与 R2 findings 中指向这三个源文件的 `path:line` 经核对**仍落在原语句上**（W1/W2/W3/W5/W10/W11/W16；W4 自 `271` 起现落 `readFields` 的块分支，`readItems` 现自 `301` 起）；`src/contract/types.ts:347-362`（W7）与 `:299-307`（R2 W2）随契约注释增行而下移，内容本身未变。

### 3.3 迁移示例（三档，全部「不改也行」）

**A. 零迁移（今天的文件原样合法）**

```yaml
aliases:
  smart: [ds-reasoner]
```

**B. 加一条同模型冗余线路（只新增）**

```yaml
models:
  ds-reasoner: { provider: deepseek-official, model: deepseek-reasoner, available: true, modelGroup: ds-reasoner }
  ds-reasoner-account:                          # 新增：同一 model id 的第二条线
    provider: deepseek-account
    model: deepseek-reasoner
    available: true
    modelGroup: ds-reasoner                     # 与主条目同组：整模型关、台账聚合都看它
aliases:
  smart: [ds-reasoner, ds-reasoner-account]     # 1 个 → 2 个，顺序即优先级
```

**C. 从「梯度藏在池里」改回「梯度在 modelOrder 里」**

```yaml
# 已有的错写（v2 语法合法、lint hint：pool-mixed-models）
#   smart: [ds-reasoner, ds-chat]
aliases:
  smart: [ds-reasoner, ds-reasoner-account]
  fast: [ds-chat]
```

```yaml
# agent.md
modelOrder: [smart, fast]    # 梯度由链表达；smart 内部是冗余，fast 是退档
```

---

## 4. `dsh-default` 语义裁决

| 问题 | 裁决 | 依据 |
|------|------|------|
| 能否成为池？ | **不能**，恒为单目标指针（`targets` 恒长 1） | D4「零特例代码/一切皆注册表」；H3 默认对本身就是一个对；W10 |
| 指向谁？ | 与默认对 `provider+model` **精确相等**的已声明模型条目（多条匹配取最高优先层/文件序第一个）；无匹配 ⇒ 合成隐式条目（`synthesized`、无 sysPrompt、`available: true`） | W10；#3 Answer 的 Q2 |
| 是否参与故障转移？ | **不**。`default` agent 的链恒为一条，耗尽 = `chain-exhausted` 硬错 | R2 §2.6「不设回退父模型」；D4 等价性 |
| 用户能声明吗？ | **不能**（`models:`/`aliases:` 两处保留字） | W11 |
| 能否指向池里的某条线路条目？ | **能**：指向与默认对精确匹配的**那一条**，其余线路对它不可见 | 精确双匹配 |
| 默认模型属于某个 `modelGroup` 时？ | 可以；**组级关闭不改 `dsh-default` 的指向**（它是配置快照，不是健康状态），只影响经过别名池的解析 | 两轴分开（R2 §3.2） |
| 想要「默认也有备份线」？ | 写**自家别名**，`modelOrder: [dsh-default, <自家别名>]`（或只用自家别名）；**不要**给 `dsh-default` 加池 | D4 兼容桥：`summon_agent(default)` ≡ 原生调用 |

**一句话**：`dsh-default` 是**宿主默认对的镜像**，不是**用户意图的池**；池化是用户别名的事，桥本身保持单点。

---

## 5. per-target 覆盖字段取舍

| 候选字段 | 进池条目？ | 进 `models:` 条目？ | 理由 |
|---------|----------|-------------------|------|
| `provider` / `model` | **否** | 是（已有） | 池条目只是名字，重复写 = 双真相（§2.3） |
| `available`（线路级） | **否** | 是（已有） | 可用性是**供应线**的属性，不是「别名里的位置」的属性（§2.2） |
| `modelGroup` | **否** | 是（新增，§2.2） | 模型级开关/聚合键 |
| `sysPrompt` | **否** | 是（已有，D6/D12） | 同模型不同 sysPrompt = 两个模型条目 |
| `effort` | **否** | **建议落这里（可选列）**，交 #31 裁决 | 见 §5.1 |
| `weight` / `timeout` / `retry` | **否** | **否**（v1 明令） | 用户定死「不均衡、只故障转移」；这些是 R2 语义不是结构 |
| `maxTokens` | 否 | 否（v2 再议） | 与 effort 同族但无现状需求，不扩大本票 |

### 5.1 effort 落点建议（喂给 #31）

**现状**：引擎 effort 顺序 = 「链项覆盖 > agent 默认 > 无」（W9），而**链项覆盖无声明来源**——`ChainItemEffort` 是注入表；`models:` 无 effort 列；`modelOrder` 是裸别名名；DSH 侧 effort 按精确 `(provider, model)` 查能力（H5），且子代理「路由变了不显式给 effort ⇒ 清掉父的」（H4）。

**建议裁决（R1 立场，不代 #31 做最终决定）**：

1. **effort 落 `models:` 模型条目**（`effort: high`，可选）。理由：它是**能力属性**，而 `models:` 条目本就是一个 `(provider, model)` 对 → **精确同域**（H5）；它让「链项覆盖」有了唯一落点；注入表 `ChainItemEffort` 可退化为「快照 `models[].effort` 的投影」，引擎签名不变（先取快照，再让注入表覆盖 = 调用方仍能临时覆盖）。
2. **不落别名牌 / 池条目**：同池不同线路的 effort 支持面可能不同（H5），落在别名牌会让「选中的线路不支持该 effort」变成**转移期才发现的 preflight 硬错**（R2 §2.7-2）。落在模型条目，03 就能**在选之前** skip（R2 的 `skipped: 'unsupported-effort'` 正好可用）。
3. **不落 `modelOrder`**：要带 effort 就得把别名数组升级成对象数组，**破坏 frontmatter 数组字段与 UI 的 1:1 编辑面**（`ARRAY_FIELDS` 只收字符串数组，W17）。
4. **agent 级统一 effort 仍留 `agent.md` 的 `reasoningEffort`**（D7 不变），只在某模型条目需要**覆盖**时才写 `effort`。

> 若 #31 最终判「不落 schema、保持注入」，R1 结构**不受影响**（池条目仍是字符串）；只是「谁能声明链项 effort」这个洞留着，UI 无法表达，D14 的 1:1 破一格。

---

## 6. 交给 R2 的接口

### 6.1 对 R2 假设 A1–A5 的逐条回应

| R2 假设 | R1 裁决 | 差异 / 补充 |
|--------|--------|------------|
| **A1** 池 = 有序数组、顺序即优先级、不轮询 | **确认** | 补：池内也可写块式（等价形状）；同池不跨模型（lint）；池长 1 合法 |
| **A2** 池条目 = 模型条目名，不内联 `{provider, model}` | **确认**（升级为正式裁决） | 补理由（§2.3）与代价：不引入新 YAML 形状 |
| **A3** per-target 覆盖不在池里，由 `ChainItemEffort` 承担 | **确认「不在池里」**，改为「落 `models:` 条目（建议），`ChainItemEffort` 退为覆盖层」 | §5.1；交 #31 |
| **A4** `dsh-default` 单目标指针，不加特例 | **确认**（升级为正式裁决） | 补：永不池化、不转移、保留字（§4） |
| **A5** 若 R1 改内联 `{provider, model}`，台账 key 换 `provider/model` | **不适用**（R1 没有内联） | R2 可按 A2 + A3（新）定稿，不需要 A5 映射 |

### 6.2 R2 基于的输入结构（冻结给 R2 读）

R2 定义选择/转移语义时，输入 = **别名注册表快照**（`AliasRegistrySnapshot`）+ **agent 链**（`modelOrder`/`model`）+（可选）**观测台账**。R1 对快照的**结构承诺**：

```ts
// —— R1 冻结的结构承诺（R2 据此定义排序与转移）——
interface AliasDefinition {
  readonly alias: string
  readonly targets: readonly string[]      // ≥1；有序池；元素是 models[].modelName；dsh-default 恒长度 1
  readonly source: AliasRegistrySource
  readonly path?: string
}

interface ModelDefinition {
  readonly modelName: string
  readonly provider: string                // 线路身份（一条供应线）
  readonly model: string                   // 能力身份（同一 model 多条目 = 多线路）
  readonly sysPrompt?: string
  readonly available: boolean              // 线路级开关（配置轴，持久，用户意志）
  readonly modelGroup?: string             // R1 新增：可选；缺省 = 自身 modelName（组级开关/台账聚合键）
  readonly effort?: string                 // R1 建议（待 #31）：该 (provider, model) 的 effort
  readonly source: AliasRegistrySource
  readonly synthesized?: boolean
  readonly path?: string
}

// —— 派生（R2 需要但不必改快照的两个键）——
// 路由键（routeFailures）：`${provider}/${model}`  = 一条供应线
// 模型/组键（模型级聚合）：modelGroup ?? modelName
```

**给 R2 的语义约束（一句话）**：**池内顺序 = 用户意图的优先级；R2 的 `health`/`degraded` 只能重排池内顺序与决定转移落点，不能改变池的成员、不能改 `available`、不能跨池**（跨别名的退档是 agent `modelOrder` 的职责）。

**两条具体输入**：

1. **两级聚合键**：`routeFailures` 用 `provider/model`；供应商级用 `provider`；**模型级**用 `modelGroup ?? modelName`（R1 新增，R2 可选，不必 v1 就用）。
2. **effort 跳过**：若 #31 采纳 §5.1，03 在选之前就能拿到 `ModelDefinition.effort`，`skipped: 'unsupported-effort'` 不再依赖注入；R2 的 `H = 1` 与类别表**不受影响**。

**另一件 R2 需要知道的边界**：R2 §2.2「转移 = 向后走一条」在 R1 结构下**只在同一个别名池内**；池耗尽后接 `model:` raw 数组仍是 D5 的逃逸口（lint 警告），**不是** R2 的转移语义。

---

## 7. 「spec 修订草案」

> 以下引用块可由 Team Lead **原样套用**到 spec。**不改**「用户定死」的措辞（不均衡、只故障转移、429 默认不转移）。

### 7.1 §5.2 修订文本

> **§5.2 registry.yaml（`$DSH_HOME/agents/registry.yaml`，workspace `.dsh/agents/registry.yaml` 覆盖合并）**
>
> ```yaml
> models:                        # 真实模型条目：调优层挂这里（D6）；同一 model id 可有多条目 = 多条供应线
>   ds-reasoner:                 # 线路条目：一条供应线 = 一个 (provider, model) 对
>     provider: deepseek
>     model: deepseek-reasoner
>     sysPrompt: "推理档位：…"
>     available: true            # 线路级开关（配置轴，持久；运行时故障台账 = R2 落点）
>     modelGroup: ds-reasoner    # 可选（R1）：模型级开关与台账聚合键；缺省 = 自身条目名
>   ds-reasoner-account: { provider: deepseek-account, model: deepseek-reasoner, available: true, modelGroup: ds-reasoner }
> aliases:                       # 纯指针（意图层）：有序池，元素 = 模型条目名，顺序即优先级、不轮询（R1）
>   smart: [ds-reasoner, ds-reasoner-account]   # 池：同模型多线路 = 路由冗余
>   fast: [ds-chat]                             # 池长 1 = v1 单目标形态，原样合法
>   dsh-default: [<默认对条目>]                   # 保留字；恒单目标，永不池化（R1）
> ```
>
> - **池语义（R1 定结构）**：池 = **有序非空**模型条目名数组；**同池只表达「同一意图的冗余线路」**，能力梯度由 agent 的 `modelOrder` 多别名表达（跨模型混池 = lint hint，不是语法错误）。池只引用模型条目名，**不内联** `{provider, model}`。
> - **两级结构（R1）**：「模型可用」与「供应线可用」分两层——线路级 = 模型条目的 `available`；模型级 = 同一 `modelGroup` 下任一条目 `available: false` ⇒ 整组不可用。引擎逐条目跳过 `available:false`，组级汇总在装载时完成。
> - **向后兼容**：v1 的 `aliases: {x: [a]}` 就是池长 1；无版本号、无迁移。

### 7.2 §9-R1 修订文本

> **R1 别名↔provider/model 关联（结论，2026-10-23 落定）**
>
> - **别名 = 有序池**（v1 单目标数组 = 池长 1）。池内是**同一意图的冗余线路**；能力梯度由 `modelOrder` 多别名表达。**不轮询、不加权**（用户约束）。
> - **池条目 = 模型条目名**（字符串），不内联 `{provider, model}`，不带 per-target 覆盖：调优层（sysPrompt / available / effort）一律挂 `models:` 的真实条目（D6）。
> - **两级故障**：线路级 `available`（一条供应线）× 模型级 `modelGroup`（同一组任一条目关 ⇒ 整组不可用）。**不引入嵌套 `routes:` 块**（读器只有一层块映射，UI 1:1 也需要它）。
> - **`dsh-default`**：恒为**单目标指针**（镜像宿主默认对，匹配已声明条目否则合成）；**永不池化、不参与转移**；想要默认的备份线就写自家别名并让 `modelOrder` 排后。
> - **v1 兼容**：`aliases: {x: [a]}` 原样合法；池化只放开读器的「恰好 1 个」校验。
> - 注入目录**永远只含别名名**（D6 不变）：池化不改主 Agent 看到的目录文本，因此不改 §6 的 digest 门控。

### 7.3 §9-R2 的补充一句（R2 已起草，R1 只补前提）

> 池序语义的前提由 R1 冻结：**池条目 = 模型条目名，顺序即优先级**；R2 的台账与转移**只在池内重排/向后走，不改变池的成员**；「模型级」聚合键 = `modelGroup ?? modelName`。

### 7.4 §8 警告表新增两行

> | 警告 | 触发 | 呈现 |
> |------|------|------|
> | 池内跨模型 | 同一别名的 `targets` 含 `model` 不同的模型条目（能力梯度应写进 `modelOrder`） | lint hint（顾问面板） |
> | 同池异组 | 池内某条目的 `modelGroup` 与其余条目不同（「冗余」被拆成两组，组级开关失效） | UI 检查项（hint） |

### 7.5 §13 票据清单补充

> R1 落地 → 实施票（读器放开池 / 组级可用性 / 写面池编辑 / UI 池呈现 / `AliasChainStep.modelName` 修正）与 #31（effort 落点）。详见 `docs/research/2026-10-23-r1-alias-association.md` §8。

---

## 8. 后续票建议

| # | 票（建议） | 类型 | 阻塞 | 要点 |
|---|-----------|------|------|------|
| R1-A | **池 schema 落地（M2）**：读器放开 ≥1、重复/空串校验、`modelGroup` 列、组级可用性汇总、`inspectAliasRegistry` 的 target 存在性/fan-in 按线路去重 + 两条新 hint | task | #9 resolved | 见 §3.2 代码清单；**先改契约 `ModelDeclaration.modelGroup?`**，再改读器与测试（`test/registry-file.test.ts:122-128` 翻转） |
| R1-B | **写面池编辑（ControlCore/RegistryEdit）**：`remapAlias` 放开为多目标或新增 `setAliasTargets`；`addAlias` 可带多目标；顾问面板渲染整个池 | task | R1-A | D14「UI 与配置 1:1」在当前池语义下**不成立**（UI 只能写 1 个目标），是 #14/#15 的前置 |
| R1-C | **`AliasChainStep.modelName` 修正**：池内先跳过时报告选错条目（W7） | bug | 无（可并入 #33） | 单目标下不可达，池化后立刻暴露；也影响 `not-reached` 的报告一致性 |
| R1-D | **模型级开关的 UI（组）**：「整模型关闭」一键 = 对同组条目多条编辑 | task | R1-A、#15 | 组是派生概念（缺省 = 自身），UI 需显示组成员 |
| R1-E | **链项 effort 的 frontmatter 表达**（若 #31 判定需要链级覆盖） | 裁决（并入 #31） | #31 | §5.1：对象数组会破坏 1:1 |
| R1-F | **同池等价冗余 hint**：池内两条目 provider+model 完全相同（不同条目名）提示无收益 | lint | R1-A | D-8 |

**不立票（明确不做）**：别名内嵌套 `routes:`/`model:` 两级块（读器与 UI 代价，§2.2）；池内加权/轮询（用户约束）；池内跨模型作为「能力梯度」的推荐用法（只提示，不禁止）；内联 `{provider, model}` 池条目（§2.3）；`dsh-default` 池化（§4）。

---

## 9. 研究边界与残余不确定性

- **未核实**：`modelGroup` 的「组级关闭」是否真需要（真实场景里「整模型关」频率低，可能一条 UI 便利即可）——产品取舍，留给实施票 triage。
- **未核实**：R2 findings 的「安装树 dist」行号（D-6）；本轮以源码树为准，未逐行复核 dist。
- **未做**：真机实验（池化任何改动都要先改 `src/`，本票是只读研究）；无 429/5xx 复现（并行会话在跑，账户级限流会污染台账）。
- **依赖**：#31 的 effort 落点未决；R1 的结构结论**不依赖**它（§5.1 只是建议）。
- **R2 对齐**：R2 已提交（`d8ef3fb`），§6.1 对其 A1–A5 全部确认（A3 带补充、A5 不适用），R2 可据此把 §2.1 的「假设」改为「已确认」。
