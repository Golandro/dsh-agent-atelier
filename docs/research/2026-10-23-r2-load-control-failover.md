# R2 findings — 别名内部故障转移语义（ticket #10，旧编号 09）

> 子票：GitHub issue [#10](https://github.com/Golandro/dsh-agent-atelier/issues/10)（R2：别名内部负载控制与故障转移语义，研究）。父图：[#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)。
> 日期：2026-10-23。作者：R2 研究子代理（volcengine-plan/deepseek-v4.1-flash 路由）。
> 一手源：本仓 `src/` 与 `node_modules/.cache/spec.md`（spec 全文，由 Lead 从 git 历史转存）；DSH 安装树 `@deepseek-ai/dsh` 0.2.1-rc.2（**另有源码树** `~/repo/deepseek-harness`，是 `scripts/check.mjs` 的 anchors 回退解析面）。
> 本文件**只读**表达：不改 `src/`、不改 spec、不动 GitHub issue。spec 修订以「草案」形式给出，由 Team Lead 择机套用。

---

## 0. 结论摘要

1. **核心裁决（叠加语义）**：llm-retry 的预算是**按 `(provider, policyKey)` 计的会话级连续预算，永不自然清零**——即「连续 N 次」在 DSH 里被判成**每个路由累计 N 次**。因此转移**不能**依赖「DSH 重试耗尽 = 故障持久」；转移必须由**错误类别**先裁决，再用**跨请求的累计计数**做阈值。裁决：**类别优先 + 单请求同路由上限 1 次转移**，不用「连续 N 次」作主判据。
2. **上限 H = 1** 是唯一与 DSH 语义相容的值：DSH 单请求重试恒等 6 次尝试且首发不计入预算；`H = llm-retry 预算 + 1` ⇒ 另一条路由最多再吃 5 次**尚未计失败**的重试 ⇒ 合计 ≤ 11 次尝试。`H = 2` ⇒ ≤ 16，仍在有界之内（可留作旋钮，默认 1）。
3. **429 默认不转移**成立，并由源码加两条理由：llm-retry 的 `RATE_LIMIT` 重试**忠实采纳 Retry-After**，而 DSH 的 `providerRetryAfterMs > maxDelayMs`（默认 10s）**直接放弃**——超过 10s 的限流根本不吃重试；且转移会破坏 §6 的缓存动力学与 D4 的默认等价性。
4. **v1 的范围**：故障转移实质是 03 引擎**加一个数据入口**——`observations`/台账参数 + 一个纯函数投影 `withAvailability()`，把两轴合流成 `health` 计算口径。**零执行期接线**，因为节点是同一次调用内的重跑，替换原生 `subagent` 不改变行为；首次真正可达在 07。
5. **不设「回退父模型」退路**（票面的 v1 无退路维持）：D4 要求等价性，且回退父模型会把调优人设/`sysPrompt` 静默换成父模型的，与 D6 冲突。

---

## 1. 一手源核实（对照票面陈述）

| # | 事实（已核实） | 位置 |
|---|---------------|------|
| F1 | 默认重试预算 `maxRetries = 5`、`initialDelayMs = 500`、`maxDelayMs = 10_000`、`jitterRatio = 0.1`，默认可重试码 `[EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]` | 源码 `llm/llm/src/retry-policy.ts:14-22`（安装树 dist 对应 `lib/types/retry-policy.js` 同名常量区） |
| F2 | 策略**按 provider 路由**解析：`adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(undefined, …)`，并在路由注册时冻结进 registration | 源码 `llm/llm/src/index.ts:450-451`（安装树 dist 同义） |
| F3 | 执行器挂在 `agent/request-error` waterfall；normal 模式顺序 = **先判码**（`retryableCodes.includes(failure.code)` 否则委派下游）→ 再查预算（`previousRetry >= maxRetries` 则委派下游）→ 算延迟 → 追加 `llm/retry` → 可取消等待 → 追加 `llm/retry-started` → 返回 `{ kind: 'retry' }` | 源码 `llm/llm-retry/src/index.ts:194-252` |
| F4 | 预算是**按 `(provider, policyKey)` 记的连续计数**，只在下一次 `step/start` 或 `turn/end` 由投影清空；**重试成功不复位** | `llm/llm-retry/src/index.ts:66-80`（key 构造）、`:127-135`（投影 `apply`）、`:219-223` |
| F5 | 延迟：有合法 `providerRetryAfterMs` 且 ≤ `maxDelayMs` 用它；**超过时 normal 模式直接 `return next()`**（放弃该次重试）；否则本地指数退避 × 对称抖动（`1-j+2jr`），封顶 `maxDelayMs` | `llm/llm-retry/src/index.ts:227-238`、`:57-61` |
| F6 | adapter 层错误分类（DeepSeek Messages，`providerError`）：`401/403`→`AUTH`；配额文案或 `402`→`QUOTA`；`429`→`RATE_LIMIT`；上下文溢出→`CONTEXT_WINDOW_EXCEEDED`；`400/413`→`INVALID_REQUEST`；`>=500` 或 `api_error`/`overloaded_error`→`SERVER`；**无状态码→`SERVER`**；其余→`HTTP_<status>`；并从 `retry-after` 头算 `providerRetryAfterMs` | 源码 `llm/llm-deepseek/src/transport.ts:22-44` |
| F7 | pi-ai adapter 的错误分类是**正则匹配错误文本**：`401/403`→`AUTH`、配额文案→`QUOTA`、`429`/rate limit→`RATE_LIMIT`、`413/400`→`INVALID_REQUEST`、`5xx`→`SERVER`、超时文案→`TIMEOUT`、流中断/网络→`TRANSPORT`，兜底 `PI_AI_ERROR` | 源码 `llm/llm-pi-ai/src/stream.ts:42-56` |
| F8 | 流空闲看门狗超时（默认 `300_000`ms）抛 `TIMEOUT`；DeepSeek 流建立前的传输失败抛 `TRANSPORT` | 安装树 dist 直读：`dsh-llm-deepseek/lib/index.js` 第 2153、2156 行，`dsh-llm-pi-ai/lib/index.js` 第 2009 行（源码对应 `llm/llm-deepseek/src/messages-api.ts` 与 `llm/llm-pi-ai/src/stream.ts` 的流路径） |
| F9 | llm-retry 在 `dsh-base` 与 `dsh-sdk-minimal` 的 patch 里**都是常驻行**（无配置、无开关）；它**不能**替插件做转移（见 §2.2） | DSH 安装树 `dsh-base/cordis.patch.yml` 第 99–100 行与 `dsh-sdk-minimal/cordis.patch.yml` 第 129–130 行（dist 直读） |
| F10 | **已发出的 chunk 之后的失败不走 waterfall**：`if (!started) throw error`——流一旦开始，错误直接上抛，`agent/request-error` 根本不会被派发 | 源码 `core/agent-loop/src/agent.ts:462-463`（`if (!started) throw error`）与 `core/agent-loop/src/agent.ts:512`（waterfall 派发点） |
| F11 | 白名单 `assertAllowedModelSelection`：无 policy → 放行；**必须 `hasDelegationModelRequest` 为真**才校验；命中 = `policy.routes` 里 `provider` 与 `model` **精确双匹配**；否则 throw | 源码 `subagent/tool-subagent/src/model-selection.ts:139-150`（安装树 dist 同义） |
| F12 | 路由 **preflight**：`preflightChildLlmRoute` 调 `llm.resolveCallConfig` → 会抛 `UNSUPPORTED_REASONING_EFFORT`（模型不支持该 effort）以及注册/模型缺失类错误；**发生在子代理创建之前** | 源码 `subagent/tool-subagent/src/model-selection.ts:176`；`llm/llm/src/index.ts:894` 与 `llm/llm/src/index.ts:915-932`（`UNSUPPORTED_REASONING_EFFORT` 两处抛出） |
| F13 | 子代理默认**继承父的 `reasoningEffort`**；路由变了却没显式给 effort ⇒ 清掉父的 route-owned effort | 源码 `subagent/subagent/src/child-agent.ts:100-120` |
| F14 | `AgentOptions` = `{provider?, model?, reasoningEffort?, maxTokens?}`——**没有 `retryPolicy` 字段**，重试策略只能按 provider 路由配 | 安装树 dist 直读 `dsh-agent/lib/types/runtime-types.d.ts` 第 21–30 行（`AgentOptions`） |
| F15 | 模型的**感知面**只有 `provider/model/reasoningEffort`；模型切换通知是 `modelSwitchNotice`（"[model changed: …]" 用户消息），只在 `modelSelectionSettings` 的 selection 变更路径产生 | 源码 `core/agent/src/model-selection.ts:47`（`modelSwitchNotice`）与同文件的 `agent/request`、`agent/pre-step` 监听 |
| F16 | 账户级限额：`deepseek-account` provider 把 `QUOTA` 重标为 `ACCOUNT_QUOTA`（**只在 `onRequestError` 钩子里**）；401 重标为 `ACCOUNT_TOKEN_INVALID` 并作废 token | 源码 `llm/llm-deepseek-account/src/index.ts:60-70` |
| F17 | **账户级 429 的分类有一个盲区**：base `providerError` 只要见到 `429` 就先判 `RATE_LIMIT`，`isQuotaExceededError` 的正则只认 `quota/balance/credit/budget/usage-limit` 字样，**不认 `AccountRateLimitExceeded`** ⇒ 账户级限流会被当成**可重试的 `RATE_LIMIT`** | 源码 `llm/llm-deepseek/src/transport.ts:29-31`（`429` 先于配额判定）；`llm/llm/src/error.ts` 的 `isQuotaExceededError`；实测死因见 `docs/agents/harness-facts.md` 子代理派发节（`429 AccountRateLimitExceeded`） |
| F18 | `deepseekAccount.rejectToken` 的语义 = 凭证失效（不是「这里限流了」）——**不能被 R2 当作降级路由的信号复用** | 源码 `llm/llm-deepseek-account/src/index.ts:60-70` |

**本仓侧的上游语义（已读，非转述）**

| # | 事实 | 位置 |
|---|------|------|
| W1 | 03 引擎已经落地：候选记录 `{origin: 'alias' | 'raw', route?, modelName?, skipped?}`，同一条流水线依次过「可用性 → 白名单 → 首个幸存者」，链耗尽 = `{ok:false, code:'chain-exhausted', message 回显整链}` | `src/core/resolve/model-chain.ts:63-74`、`:231-286` |
| W2 | 跳过原因只有四种：`unknown-alias` / `unknown-model` / `unavailable` / `not-allowed`，外加报告用的 `not-reached`；**可用性先于白名单判定** | `src/core/resolve/model-chain.ts:135-138`；`src/contract/types.ts:299-307` |
| W3 | `ModelDefinition.available` 是「v1 手动开关」；`synthesized` 只标记内置隐式条目（默认对无匹配时合成，`available: true`）；`dsh-default` 指针**恒指向一个模型条目** | `src/contract/types.ts:146-161`；`src/core/catalog/alias-registry.ts:191-210` |
| W4 | 内置默认 agent 的链是 `modelOrder: [dsh-default]`，`requiredTools: []`、`skills: []` | `bundled/default/default.agent.md` |
| W5 | R1（#9）findings `docs/research/2026-10-23-r1-alias-association.md` **本次核查时不存在**，故 R1 结构按假设处理（见 §2.1） | 本次 `ls docs/research` |

### 1.1 与票面陈述的差异（必须知道）

- 票面（以及 spec §3 事实表、§9 R2、§11）写「llm-retry 同一请求退避重试 5 次」——**措辞不准确，会误导阈值设计**。源码里它叫 `maxRetries`（首发之后的**重试**上限），计数键是 `(provider, policyKey)`、**跨请求**、只在下一次 `step/start`/`turn/end` 复位。一个请求的真实尝试上限 = **6**，且**首发失败不计入预算**（F1/F3/F4）。
- 「同请求」只在「同一个打开的 step 内重跑」这个意义上成立；**预算本身不是请求级的**。§2.2 的 `H = 1` 就是从这个差异推出来的。
- 票面假设「我们的转移发生在解析/preflight 层（选好目标再交 DSH 执行）」——**方向对，但 v1 的触发点根本到不了请求期**（F10/F15 与 §2.7-3：节点是一次调用之内的重跑，替换原生 `subagent` 工具不改变这一点）。
- 票面把 429 的「不转移」归因于「瞬时限流」——原因成立但不完整：**DSH 的 `maxDelayMs` 会让超过 10s 的 `Retry-After` 直接放弃重试**（F5），这才是「原地退避优先」在 DSH 里可能很快让位给转移的**真实机制**，也是 §2.4 阈值的正确形状（按**墙上时间**而不是按「连续 N 次」）。

---

## 2. 语义提案

### 2.1 我对 R1 结构的假设（显式）

R1 findings 尚未落盘，本文按下列结构参数化定义；若 R1 结论不同，本节与 §4 的修订文本按同一映射重述即可：

- **A1**：池（alias 的 `targets`）是**有序数组**，顺序即优先级，**不轮询、不按负载加权**（用户定死的约束）。
- **A2**：池条目是**模型条目名**（`models:` 的 key），池**只**引用模型条目，不直接内联 `{provider, model}`——沿用 02 的不变式「别名是纯指针、调优层挂在真实模型条目上」（D6），也让 `available` 只有一个落点。两级结构（模型 ↔ 供应商）由两个池条目各指一个模型条目表达。
- **A3**：per-target 覆盖（effort 等）**不在池里**，仍由 03 的 `ChainItemEffort` 注入表承担（W1 已如此）。
- **A4**：`dsh-default` 在池化下仍是「指向默认对的那个条目」的**单目标指针**（W3），R2 **不给它加任何特例**。
- **A5**：若 R1 最终改为直接内联 `{provider, model}`：把本文的「池条目」读作「一个 `ModelRoute` 加上它的可用性输入」，其余结论不变；把台账 key 从「模型条目名」换成 `provider/model` 字符串即可。

### 2.2 与 llm-retry 的分层叠加（核心）

**层级事实**

| 层 | 何时运行 | 对什么做决定 | 谁能触发 |
|---|---|---|---|
| 解析层（03 引擎，v1 纯函数） | **调用之前**：读文档 + 注册表快照，选一个路由 | 选谁（静态） | 03 自己，依据配置 + 台账 |
| DSH 预检（`assertAllowedModelSelection` + `preflightChildLlmRoute`） | **子代理创建之前** | 拒 / 放行（白名单、effort 可支持性） | 宿主，同步抛出 |
| 请求骨架（`agent/request` waterfall） | **每次请求之前** | 选哪个 provider/model（可中途变更） | 宿主（`installModelSelection` 一类，F15） |
| 重试层（llm-retry） | **单次请求内、重跑失败的 step** | 同一 provider 再试 / 委派下游 | 是 `agent/request-error` **骨架的唯一消费者** |
| 工具层（`summon_agent`，07） | 一次调用 | 重跑节点 / 回显链 | 本插件 |

**次序** 解析 → 白名单 → preflight → 骨架 → 请求 → 重试 →（失败后）工具层重跑。三层互不知情，且都**只能在同一会话、同一路由**内工作。

**裁决：错误类别优先，阈值只做升级器。**

- **类别优先**：`transfer: 'never'` 的类别（`RATE_LIMIT`/`AUTH`/`QUOTA`/`ACCOUNT_QUOTA`/`INVALID_REQUEST`/`CONTEXT_WINDOW_EXCEEDED`，见 §2.3）**无论积累多少次都不触发转移**。理由：只有分类能表达「换个供应商能不能救」；计数不能。
- **阈值**：只用两类**跨请求累计**计数：
  - `routeFailures[route]`（路由级累计，5xx/超时/传输）——当 `≥ 2` 时，把该路由从**首选**降为**末选**（池内排序用，不越过更优项），直到人工恢复（§2.5）。
  - `providerFailures[provider]`（供应商级累计，`configured-*` 类别）——当 `≥ 2` 时，把该供应商的**全部**路由降为末选（两级结构：供应商病 ≠ 模型病）。
  - 两者都**不做硬禁用**：台账只影响**排序**与**是否当故障转移目标**，不做全局否决（否则一次抖动会让某个模型在整个会话里不可选）。
- **不做「连续 N 次」主判据**，因为它在 DSH 里已经被 llm-retry 吃掉（F4）。
- **上限**：单请求最多 `H = 1` 次跨路由转移（`H = 0` 即纯「向后走」的静态链，`H = 1` 是可以回环的后备转移）。`H` 是旋钮，建议 `1 ≤ H ≤ maxRetries`。

**为什么 `H = 1` 才是对的（源码推算）**

- DSH 单请求（同一路径、同一 step）的尝试上限 = `1 + maxRetries` = **6**；且首发失败后的 `retry` 从 **0** 起算（F3/F4）。
- 若在 `H = 1` 的情况下允许「转移到另一条路由再跑」：另一条路由若 provider 不同 ⇒ **另一套 `(provider, policyKey)` 计数**，可再吃满 `maxRetries = 5` 次 ⇒ 合计 ≤ **11** 次尝试。
- 若 `H = 2`：≤ **16** 次。仍在有界范围内，故可作旋钮，但**默认必须是 1**。
- 这是「每多一次转移 ≈ 多一次 6 次尝试的账单」的量化依据：转移要花**秒级到十几秒级**的墙钟（500ms→10s 指数退避 × 5 次）再加上失败判定时间，**读者的耐心比账单价高**。§2.4 的「墙上时间预算」就是把这条折算成人能理解的阈值。

**关键边界（必须写进语义）**

1. **转移只在「确定性失败」后发生，重试层会吃掉所有可重试失败**：因此**单个请求的转移只会由 `failure.code` 不在 `retryableCodes` 里的错误触发**（`AUTH`、`QUOTA`、`ACCOUNT_QUOTA`、`INVALID_REQUEST`、`CONTEXT_WINDOW_EXCEEDED`、`PI_AI_ERROR`、`HTTP_<status>`），或由**工具层的判定**触发（「本节点已在本路由上吃过一次完整的重试预算且仍失败」）。**5xx/超时/传输/空响应在单请求内到不了转移层**——它们只累计进台账，影响**下一次调用**的排序。
2. **账户级 429 是 `RATE_LIMIT` 而不是 `QUOTA`**（F17）：账户级限流**最先**出现时，会走「原地重试」那条路径；如果 `Retry-After > 10s` 就立刻放弃 → 本次调用失败。这是**预期行为**：它保护的是「不因限流去打断缓存、不因限流去换人设」，代价是这一回合失败；台账会把这记一次限流，**仍然不给转移**。
3. **本仓只能看见 failure 的 `code`/`status`，看不见供应商原始文案**（见 §6 的观测盲区），所以 R2 只能按 `code` 分类，**不能**按提供商措辞区分「这家限流」与「这家欠费」。

### 2.3 故障分类学（触发转移的错误类别表）

**设计对象**：不是「DSH 的失败码」，而是「**一次请求结束后，我们允许对池做什么**」。

| 类别 | 可能的 `code`（来源） | 触发转移？ | 理由 |
|---|---|---|---|
| **`transient-server`** | `SERVER`（`>=500`、`api_error`、`overloaded_error`、**无状态码兜底**）、`HTTP_5xx` | **单请求：否**（llm-retry 已吃）；**台账：是**（累计 → 降为末选，≥2 次） | 可重试；原地重试**天然命中 provider 缓存**（llm-retry README「Model Experience / KV Cache effect」：重试不改变缓存身份）；转移会同时打断缓存与人设连续性。**必须是「重试预算耗尽后仍失败」才升级**。 |
| **`transient-timeout`** | `TIMEOUT`（含流空闲看门狗 300s） | **单请求：否**；**台账：是**（同上） | 同上；且 300s 看门狗意味着「超时」本身已吃掉大量墙钟，再转移的边际价值低于账单。 |
| **`transient-transport`** | `TRANSPORT`（网络/ECONN/流中断）、`PI_AI_ERROR` | **单请求：否**；**台账：是** | 同上；`PI_AI_ERROR` 是 pi-ai 兜底，归「暂不可判定」，**默认不转移**（失败关闭原则：宁可报错，不要猜）。 |
| **`empty-response`** | `EMPTY_RESPONSE` | **单请求：否**；**台账：是**（轻量） | 提供商偶发退化；重试已覆盖；计入台账但不因它单独降级。 |
| **`rate-limit`** | `RATE_LIMIT`（`429`、`rate_limit_error`；**含账户级 429**） | **单请求：否（默认）**；**台账：记时、按 §2.4 条件转移** | 瞬时限流 + 原地退避命中缓存 + 保住人设连续性；且 `Retry-After` 超过 `maxDelayMs` 时 DSH 自己就放弃——那正是限流「被尊重」的时刻，**不该**让插件用换供应商来绕过限流（绕过限流通常触发更重的账户级惩罚）。 |
| **`auth`** | `AUTH`（`401/403`、`authentication_error`、`permission_error`）、`ACCOUNT_TOKEN_INVALID` | **单请求：否**；**台账：是（`'configured-auth'`）；若 `validated=true` 则可转移** | 鉴权失败是**配置**错误**或凭证过期**（`ACCOUNT_TOKEN_INVALID` 时宿主已作废 token）——两者都与模型无关，换路由没用。只有**该路由在 preflight 被验证可用之后**才出现的 `AUTH`，才可能是运行时凭证问题，**允许**转移。 |
| **`quota`** | `QUOTA`（`402`、配额文案）、`ACCOUNT_QUOTA` | **单请求：否**；**台账：是（`'configured-quota'`，供应商级）；可转移** | 配额耗尽**就是**「这家供不了了」的最强信号——一个真·可恢复但**不是本会话能修**的状态。**唯一**明确需要「换供应商」的类别；但因为 `QUOTA` 也可能是「欠费」，所以**只转移、不硬禁用**，且**供应商级**。 |
| **`invalid-request`** | `INVALID_REQUEST`（`400/413`） | **否**；**不记** | 请求本身的问题，换谁都会 400（换供应商甚至更差：请求是 DeepSeek 语形）。**绝不能**因此把用户推去重试另一个人设。 |
| **`context-overflow`** | `CONTEXT_WINDOW_EXCEEDED` | **否**；**不记** | 换模型可能「救」但那是**改语义**（换了个上下文窗口），不属故障转移；这是 compaction 的活（llm-retry README 同款判断）。 |
| **`no-route`** | 解析/预检阶段：白名单拒绝、`UNSUPPORTED_REASONING_EFFORT`、provider 未注册 | **不适用**（在请求前） | **静态**可判定错误：`not-allowed` 已在 03 里 Skip；effort 不可支持应在 03 里**也变成 Skip**（§2.7-2），**不需要**运行时转移。 |

守卫边界：**转移 = 「还有下一条候选」才有意义**。若池只有一条且无 raw 兜底，转移语义退化为「链耗尽硬错」（§8 的既有硬错误）。

### 2.4 429 策略（精确到数字）

1. **第一优先：原地退避**。llm-retry 的 `RATE_LIMIT` 重试：失败带合法 `Retry-After ≤ maxDelayMs(10s)` 时按服务器指示等；否则 500ms 起指数退避、封顶 10s、对称抖动 10%（F1/F5）。
2. **`Retry-After > 10s` 时 DSH 自己放弃**（F5）。此时本插件**仍然不转移**——本次调用失败，向用户报「限流中，稍后重试」。这不是缺陷，是**让限流生效**：换成另一个供应商是在**绕过**限流，会让账户级惩罚更重。
3. **触发转移的条件：`rateLimitStreak(route) ≥ RL_STREAK` 且 `elapsedSinceFirst429 ≥ RL_WINDOW`**，默认 `RL_STREAK = 3`、`RL_WINDOW = 60s`。含义：同一路由在 60s 内被限流 3 次——这不是「一次高峰」，是「持续限流」，**此时下一条候选允许**当**本会话的当前主选**（只影响**新召唤**，不迁在途会话）。
4. **但「持续限流」也只降到「次选」**：**不停用**路由，也不覆盖「用户手动 `available`」——下一会话/下一次 `invalidate()` 后重新评估。
5. **不对账户级 429 做特殊分支**：源码里它就是 `RATE_LIMIT`（F17），而且「账户级」意味着**同一供应商下的多个模型会同时被限**——池的两级结构里，同一供应商的所有路由会一起记限流，因此当 `rateLimitStreak` 达阈值时，**转移到不同供应商**才是有意义的。这正是两级结构（R1）对 R2 的直接用处。

### 2.5 恢复语义

**三态**（每条**候选路由**）：`active` / `degraded`（被降为末选，仍可选中）/ `disabled`（仅来自配置）。

**v1（必须做）：手动开关**

- 唯一可用性开关 = 注册表里的配置：`available: false` ⇒ `disabled`（W2 现况）；`available: true` ⇒ `active`。
- 生效时机 = **下次 `invalidate()`**（02 的 `invalidate` 是唯一重载触发点，装载时快照、无 watcher）；因此 v1 的「手动恢复」= 用户改 `registry.yaml` → 触发 `invalidate` → 重新解析。
- **UI 要显示台账**（05/14 的职责）：每条路由一行「最近失败次数 / 最近失败码 / 最近失败时间 / 是否被降级」。**没有台账的降级是不可接受的**——用户看到「为什么不好使了」比「让它好使」更重要。

**v2（延后）：半开探测**

- **探测者：主会话**，**不是**子代理。成本理由（直接来自 DSH 事实）：半开探测 = 一次**精灵请求**（单条 1–2 token 的 user 消息、`maxTokens: 1`）；若交给子代理，要付**整个上下文的输入 token**（子代理的 system 提示词 + 工具 schema + 指令，见 F13/F14 的继承语义），比主会话的精灵请求贵一到两个数量级；而且子代理本身要**继承**路由，失败会污染父会话的台账。
- **触发时机**：`degraded` 持续 `PROBE_AFTER = 120s` 后允许一次探测；探测走**同一路由**、**同一 llm-retry 语义**；结论 = `code` 属 `transient-*` 且重试后成功 ⇒ `active`；否则继续 `degraded`，**指数退避**下次探测（`120s → 240s → 480s`，封顶 30 分钟）。
- **不探测 `disabled` 的路由**（`available: false` 是用户意志，探测它等于违反用户意图）。
- **探测会消耗配额**。**账户级 429 在场时**（**典型**：volcengine 免费层），探测会**再付一次 429** 并**重置** `RL_STREAK` 判断 → **探测失败必须不重试、不记一次「转移」**。这就是「v2 才做」的实际原因：v1 的台账比探测便宜，而探测在限流账户上**有害**（每次探测都是一次新的限流）。

### 2.6 池序语义

- **池 = 有序数组，顺序即优先级**（A1）。**转移 = 向后走一条**（`H = 1`）。**恢复 = 降级项回到它原本的位置**（不是「回到队首」，因为「队首」是**未降级**的默认语义）。用户手动 `available: false` 的路由**不参与**队序（`disabled`）。
  有效队序 = `active…` → `degraded…` →（`disabled` 不入列）。同层内保持声明顺序。
- **「回队首」只在人工恢复后发生**：人工把 `available` 改回 `true` + `invalidate` ⇒ 该路由的台账清零（若仍保留跨会话持久台账则需 UI 显式清除）⇒ 恢复默认队序。
- **在途会话要不要迁回？= 不迁回。** 会话的人设/系统提示词/缓存/历史都是**按路由**粘住的；会话中途换路由 = §6 的「切换模型在此断」，并且已建立的前缀**无法复用**（不同 provider 有各自的缓存前缀与 KV 布局）。**迁移只发生在「下一次召唤」**。v2 也不做「会话中途迁移」；若将来要做只能是独立特性并显式标注缓存代价。
- **`dsh-default` 池化 = 不变**：它是指向默认对的单目标指针（A4）；`default` agent 的链因此永远是一条路由，**不会**转移，行为是「链耗尽硬错」。**「回退父模型」的 v1 退路：无**（见 §0-5）。

### 2.7 与 DSH 既有语义的三处**必须处理**的碰撞

1. **白名单**：`assertAllowedModelSelection` 在 `policy.routes` 缺省时**全放行**（F11），03 的 `isAllowed` 同构（无 policy ⇒ true）。台账降级发生在「所有路由都被允许」之后，因此**不冲突**；`disabled`/`degraded` 都不能改变「是否被白名单允许」这个**静态**判定。**结论**：R2 不碰白名单，只影响「在允许的候选里先试谁」。
2. **`reasoningEffort` 必须在转移时按目标重新解析**：DSH 对「路由变了但没给 effort」会**清掉父的 route-owned effort**（F13），而 03 的 effort 解析是「链项覆盖 > agent 默认」（W1）。若转移目标不支持首选路由的 effort，DSH 会在 **preflight** 抛 `UNSUPPORTED_REASONING_EFFORT`（F12），那时**已经来不及**转回。**03 变更**：在候选流水线里让 effort 与白名单同级成为「可跳过」判定（`skipped: 'unsupported-effort'`），把「这个目标不支持这个 effort」在**选之前**排除；**不**在 03 的返回里凭猜测改 effort。
3. **v1 的触发点只存在于 07 的工具层**：因为「节点重跑」是同一次调用内的重跑（`agent/request-error` 只能被 llm-retry 消费，F3/F9/F10）。**03 的引擎本身不需要、也无法**在请求期转移。03 的职责 = **提供一个能表达「按台账排序」的纯投影**；07 的职责 = **在每次 summon 调用里按这个投影 + 重跑节点执行转移**。**03 决定「能不能转」，07 决定「怎么转」**。

---

## 3. M3 接入点（03 引擎）

### 3.1 新增的纯数据形状（建议进 `src/contract/types.ts`）

```ts
/** 故障台账：一条候选路由的运行时观测（纯数据，03 只读不写）。 */
export interface RouteObservation {
  readonly route: ModelRoute
  /** 最近一次失败的 DSH 失败码（SERVER/AUTH/RATE_LIMIT…）；由记录方维护。 */
  readonly lastFailureCode?: string | undefined
  readonly lastFailureAt?: number | undefined   // epoch ms
  /** 连续失败 / 连续限流，由记录方维护（见 §2.2）。 */
  readonly failures?: number | undefined
  readonly rateLimitStreak?: number | undefined
  readonly rateLimitSince?: number | undefined
}

/** 03 的第二个可选输入：v1 恒为 undefined（纯函数、纯静态）；v2 由 07 注入。 */
export interface ChainObservations {
  readonly routes: readonly RouteObservation[]
  readonly providers?: readonly ProviderObservation[] | undefined
}

/** 新增 SkipReason：目标模型不支持首选 effort（DSH 预检会在子代理创建前抛）。 */
export type ChainSkipReason = /* 既有四种 */ | 'unsupported-effort'
```

### 3.2 新增／调整的纯函数

1. **`withAvailability(snapshot, observations)`**（纯，`src/core/resolve/` 下的新模块 `observations.ts`）
   - 输入：`AliasRegistrySnapshot` + 可选 `ChainObservations`；输出：带投影字段的模型列表：

```ts
export type RouteHealth = 'active' | 'degraded' | 'disabled'
export interface ProjectedModel extends ModelDefinition {
  readonly health: RouteHealth
  readonly healthReason?: 'server' | 'timeout' | 'transport' | 'rate-limit' | 'auth' | 'quota'
}
```

   - 规则：`available: false` ⇒ `disabled`；台账同类失败 `≥ 2` ⇒ `degraded`；`rateLimitStreak ≥ 3` 且 `now - rateLimitSince ≤ 60s` ⇒ `degraded`；否则 `active`。
   - **不改 `available` 字段本身**：`available` 是配置的、持久的、用户的；`health` 是运行时的、易失的。**两轴分开**是本题最重要的一条接入点语义（v1 里 `available` 一个字都不动）。
2. **`resolveModelChain` 增加两个可选字段**：`observations?: ChainObservations` 与 `now?: number`（纯函数里不读 `Date.now()`，时间注入；保持 03 现有的全函数无 I/O 风格）。排序 = **先按 `modelOrder` 展开顺序，再把每个别名池内的 `degraded` 项后置**（同层保持声明顺序）；`disabled` 仍 `skipped: 'unavailable'`。
3. **`ChainResolutionReport.candidates`** 中每个候选带 `health`（新字段）——05 的顾问面板与 06 的目录警告都消费它。

**为什么这样接入 07**：07 拿到候选列表后，**每次 summon 有一个可重跑节点**：`attempt(candidate)` → 成功返回；失败（且 `candidate.health !== 'disabled'`、`H < maxAttempts`）⇒ **把刚失败的路由记入台账，重新投影**（`withAvailability` + `resolveModelChain`），选下一条**有效**候选再 `ctx.subagents.start`。第二次调用就是**另一个子代理**（DSH 的 `subagents.start` 本来就没有「同一子代理换模型」的概念）。**v1 只需要 03 做 3.1–3.2 的形状 + 单测；07 才是接线。**

### 3.3 v1 内 03 票的最小接入 vs v2 延后项

| 项目 | v1（03 票现在做） | v2（延后） |
|---|---|---|
| `RouteObservation` / `ChainObservations` 类型 | ✅ 加契约类型 | — |
| `withAvailability` 纯函数 + 单测 | ✅ **做**（即便暂无消费方，作为 03 的可测面与 07 的输入） | — |
| `resolveModelChain` 的 `observations`/`now` 参数 | ✅ 做（不传 ⇒ 行为**与今天一字不差**的向后兼容） | — |
| `'unsupported-effort'` SkipReason | ✅ 做（§2.7-2，v1 就能挡住预检硬错） | — |
| 台账**写入**（谁记失败） | ❌ 不在 03（纯函数、不持状态） | v2 由 07 的会话级台账持有 |
| 半开探测 / 自动恢复 | ❌ | v2 |
| 跨会话持久台账 | ❌ | v2（需要新存储面 + UI 清除） |

**给 03 实现者的一条硬口径**：`withAvailability` 返回的是**投影**，**不是**新快照；`resolveModelChain` 必须能接受「投影过的模型列表」而不破坏「同一份快照进、同一份快照出」的幂等性——即 `resolveModelChain(ctx)` 与 `resolveModelChain({...ctx, snapshot: project(snapshot)})` 必须给出**结构相同的** `report`（除 `health` 字段外）。**加单测**：无 `observations` 时新旧行为逐字段相等。

---

## 4. 「spec 修订草案」

> 以下引用块可由 Team Lead **原样套用**到 spec §9-R2 / §5.3 / §11 / §3 事实表。**不要**改「用户定死的三条约束」的措辞（不均衡、只故障转移、429 默认不转移）。

### 4.1 §9-R2 修订文本

> **R2 别名内部负载控制（结论，2026-10-23 落定）**
>
> 约束（用户定死，不可再议）：**负载不均衡（主备不轮询）、只做故障转移、429 默认不转移**。
>
> - **池序**：别名池 = 有序数组，声明顺序即优先级；转移 = **向后走**，恢复 = **回默认队序**。v1 的可用性开关 = 配置层 `available`（持久、用户意志）；`health`（`active`/`degraded`/`disabled`）是运行时投影，两轴分开，`available` 在 v1 不被台账改写。
> - **故障分类学**：单请求内**默认不转移**所有「可重试」类别（`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE`/`RATE_LIMIT`）——它们由 llm-retry 原地重试；台账累计 `≥ 2` 才把该路由降为末选（`degraded`）。`AUTH` 仅在「preflight 已验证可用」后出现时允许转移；`QUOTA`/`ACCOUNT_QUOTA` 可转移（供应商级降级）；`INVALID_REQUEST`/`CONTEXT_WINDOW_EXCEEDED` **永不**转移。
> - **与 llm-retry 的叠加**：llm-retry 的 `maxRetries` 预算**按 `(provider, policyKey)` 跨请求累计、只在下一次 `step/start`/`turn/end` 复位**——因此 DSH 的「5 次」**不是**「同请求连续 5 次」。转移**由错误类别先裁决**，阈值只作排序升级器；单请求最多 `H = 1` 次跨路由转移（DSH 至多 6 次尝试 + 第二路由至多 5 次重试，合计 ≤ 11 次）。**不得**以「连续 N 次失败」作为主判据。
> - **429 策略**：原地退避优先。llm-retry 忠实采纳 `Retry-After`；`Retry-After > maxDelayMs`（默认 10s）时 DSH **自行放弃**，本插件**仍不转移**（不绕过限流）。仅当同一路由 **60s 内被限流 3 次**（持续限流）时，允许把下一候选用于**新召唤**；在途会话不迁。
> - **恢复**：v1 = UI 手动 `available` 开关 + **台账可见**（显示每路由最近失败码/次数/时间）；v2 = 半开探测，**探测者是主会话的精灵请求**（不是子代理——子代理要付整个上下文的输入 token，且探测失败会污染父会话台账）；探测只对 `degraded`、不对 `disabled`、不重试。
> - **回退**：**不设「回退父模型」**。`default` agent（`dsh-default`）池是单目标指针，**不做转移**；链耗尽仍是**硬错误并回显链**（§8）。

### 4.2 §5.3 修订文本（解析语义）

> 5.3-1 原文「展开池（v1 单目标）跳过 `available:false`」→ **改为**：
>
> > 1. 遍历 `modelOrder`（别名名数组）：展开池（**有序数组，声明顺序即优先级**，R1 定案）——跳过 `available:false`（`health: 'disabled'`）；带**观测台账**时，`health: 'degraded'` 的项**后置**但在 `disabled` 之前（同层保持声明顺序）。`modelOrder` 耗尽后接 `model` raw 数组直连（显式逃逸口，lint 警告）。
> 5.3-2 白名单判定**不变**（台账不改变「是否允许」，只改变「先试谁」）。
> 5.3-3 新增：**候选在选之前还要通过 effort 可支持性判定**（目标模型不支持首选 `reasoningEffort` ⇒ `skipped: 'unsupported-effort'`），避免 DSH 在子代理创建前的 preflight 抛硬错（`UNSUPPORTED_REASONING_EFFORT`）。
> 5.3-4 命中返回 `{provider, model, reasoningEffort, persona, toolFilter, flavor}`，并**在 `report.candidates` 上附 `health`**；链耗尽 = 硬错误回显整链。
> 5.3-5 effort 取值顺序：链项覆盖 > agent 级默认 > 无（**不变**）。

### 4.3 §11 v2 展望 修订

> 「运行时故障台账（R2 产出）：429/5xx 记录驱动半自动可用性」→ **改为**：「运行时故障台账（R2 产出）：按 `RouteObservation` 记录失败码与连续计数，投影为 `health` 两轴驱动排序（**不改** `available`）；半开探测（主会话精灵请求，只对 `degraded`）与跨会话持久台账延后 v3。」

### 4.4 §3 事实表 修订（票面措辞纠正）

> 「重试=llm-retry 同请求退避（默认5次：…）」→ **改为**：「重试=llm-retry 在 `agent/request-error` waterfall 上重跑失败 step；`maxRetries` 预算按 `(provider, policyKey)` **跨请求累计**、`step/start`/`turn/end` 复位，默认 5 次重试（首发不计入，单请求 ≤ 6 次尝试），退避 500ms→10s + 10% 抖动，`Retry-After` 优先且 `> maxDelayMs` 时放弃」。

---

## 5. 后续票建议

| # | 票 | 类型 | 阻塞关系 | 要点 |
|---|----|------|---------|------|
| S1 | **03 增强：台账投影与 effort 可跳过**（并入 03 或紧接 03 之后） | task | 无（可并入 03） | `withAvailability` + `ChainObservations` + `'unsupported-effort'` + `now` 注入；单测保证无观测时行为逐字段不变。 |
| S2 | **07 的转移执行器** | task | 03、04、06 | 每次 summon 一个「可重跑节点」；失败 ⇒ 喂台账 ⇒ 重投影 ⇒ 下一候选；`H = 1`；在途会话不迁；明示「第二次是另一个子代理」。 |
| S3 | **R2-obs：失败码观测面**（建议立） | research/spike | 无 | 插件能否在**运行时**看到 `LlmFailure.code/status`？现有读面只有 `agent/request-error`（骨架被 llm-retry 占用）与 session 事件（`assistant/attempt` 只有 `stream`）。§2.3 的分类学若**看不见 code**，只能退化为「工具层超时 + 重跑」的粗粒度台账——**R2 落地前必须钉死**（见 §6）。 |
| S4 | **账户级限流文案识别**（上游 issue） | upstream | 无 | `isQuotaExceededError` 不识别 `AccountRateLimitExceeded`（F17）；建议上游把账户级限流归入 `ACCOUNT_QUOTA` 或新增 `ACCOUNT_RATE_LIMIT`。同页记：**流已开始后的失败不走 `agent/request-error`**（F10）。 |
| S5 | **UI 台账可见**（并入 14/15） | task | 05 | 面板显示每路由 `health` + 最近失败码/次数/时间 + 一键「重置台账」；这是 v1 恢复语义可操作的**前提**。 |

**不立票（明确不做）**：轮询/负载均衡（违反约束）、429 自动转移（违反约束）、「回退父模型」退路（违反 D4 + D6）、`available` 被台账自动改写（违反「用户意志」）。

---

## 6. 研究边界与残余不确定性

- **未核实**：插件在**运行时**读取 `LlmFailure.code` 的可用观察面（见 S3）。本文分类学基于「可见 code」的假设；若不可见，§2.3 退化为「可重试/不可重试」两分，阈值侧重会向台账偏。
- **未核实**：`preflightChildLlmRoute` 的 `UNSUPPORTED_REASONING_EFFORT` 真机可达性（`resolveCallWithInfo` 会抛，但需要「目标模型不支持该 effort」的组合）；来自源码阅读，未做真机实验。
- **未做**：真机 429/5xx 复现实验（account 限流会让实验本身污染台账，且**并行会话在跑**）。本文件全部结论来自源码与安装树阅读，§1 已给逐条锚点。
- **R1 对齐**：`docs/research/2026-10-23-r1-alias-association.md` 在本次核查时**尚不存在**；§2.1 的 A1–A5 是**假设**，若 R1 落地结论不同，按 A5 的映射机械重述即可（结论不依赖 R1 的条目形状）。

## 7. 实现期回注（2026-10-23，S1 / #33 落地后，Lead）

- §3.3 的「投影快照等价」硬口径**不成立**：投影列表不带台账，`resolveModelChain` 无法从快照得知谁该后置。实际实现：等价性只承诺「无 `observations` 时新旧报告逐字段相同」（有回归测试）；`withAvailability` 只承担展示投影，排序由显式 `observations` 入参承担。
- §3.2 的「传投影列表」不实现；排序范围 = **池内** degraded 后置（同层保声明序），不跨别名（与「转移只在池内」一致）。
- `supportedEfforts` 输入按 `provider/model` 精确对建键（`routeKeyOf`）；表缺失 = 能力未知不判定。
