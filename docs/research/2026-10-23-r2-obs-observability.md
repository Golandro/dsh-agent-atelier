# R2-obs findings — 运行时失败码观测面（ticket #34，map #1 子票）

> 子票：[#34](https://github.com/Golandro/dsh-agent-atelier/issues/34)。父图：[#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)。
> 日期：2026-10-23。作者：R2-obs 研究子代理（volcengine-plan/deepseek-v4.1-flash）。
> 喂给：R2 故障分类学（[R2 findings](2026-10-23-r2-load-control-failover.md) §2.3）的落地粒度；消费方 = 03 增强 S1（`RouteObservation` 投影，已落地）与 07 执行器（S2，记录方）。
> 一手源：DSH 源码树 `~/repo/deepseek-harness/`（路径相对该目录；行号为 2026-10-23 现场读到的行号）。Cordis 内核在 `vendor/cordis/`（**不在** `packages/` 下，`scripts/check.mjs` 的锚点解析器只扫 `packages/`，故本文把它的行号写作**非锚点**形式：`events.ts` 第 234–243 / 165–175 行，文件为 `~/repo/deepseek-harness/vendor/cordis/src/events.ts`）；本仓 `src/`。**纯源码阅读，未做真机 429/5xx 实验**（并行会话在跑，实验会污染台账 —— 同 R2 findings §6）。
> 边界：只读；未改 `src/`、`spec/`、`CONTEXT/GLOSSARY`、`docs/agents/harness-facts.md`，未动 GitHub。

---

## 0. 结论（三选一：**部分可观测**）

**能看见 `LlmFailure{code, status?, providerRetryAfterMs?, requestId?}`（每次失败的完整现场），也能看见「llm-retry 是否已放弃本次请求」（= `next()` 的返回值）；看不见的只有：llm-retry 的内部尝试计数/退避状态，以及票面 `rateLimitStreak` 所假设的「请求级」计数口径——后者必须改写（§3.2/§3.3）。**

三条证据链：

1. `agent/request-error` 是 **waterfall**，不是「llm-retry 独占」的 socket —— waterfall 给**每一个**监听者同一份 `{…, provider, failure: LlmFailure, retryPolicy, signal}` 与其后的 `next()`；任何监听者都可以**只观察再 `next()`**（不消费）。llm-retry 只是「唯一可能返回 `{kind:'retry'}`」的那一个（`packages/core/agent/src/runtime-types.ts:347-353`；Cordis `vendor/cordis/src/events.ts` 第 234–243 行）。
2. **第二份同质观察面**：每次模型调用都过 `llm/stream` waterfall；适配器/迭代错误**不会 throw**，被翻译成终端 `StreamChunk{type:'finish', reason:{kind:'error', failure: LlmFailure}}`（`packages/llm/llm/src/index.ts:75`、`:1173-1180`、`:1183-1191`、`:1119-1122`、`:1134-1137`）。这正好弥补 `agent/request-error` 的盲区：**流开始之后的失败不进 waterfall**（E7）。
3. **持久面**：`turn/end.reason.error` 就是同一个 `LlmFailure`（`packages/core/session/src/types.ts:207-213`、`:298`；`packages/core/agent-loop/src/agent.ts:377-384`）。`assistant/attempt.stream` **不含失败码**（只存文本/推理/tool-call 时间包与 usage；`finish` chunk 被 assembler 收进私有 `_finish`，不进 `stream` 记录）—— 票面「session 事件只有 `assistant/attempt` 的 stream」应更正为「attempt 的 stream 不含码，码在 `turn/end.reason`」。

**对分类学的影响**：§2.3 的细化**成立**——可区分 `SERVER` / `TIMEOUT` / `TRANSPORT` / `EMPTY_RESPONSE` / `RATE_LIMIT`（含 `ACCOUNT_*` 变体）/ `HTTP_<status>` / `INVALID_REQUEST` / `CONTEXT_WINDOW_EXCEEDED` / `PI_AI_ERROR`，并可用 `status` 与 `providerRetryAfterMs` 再把 `RATE_LIMIT` 分档。**「可重试/不可重试」两分退化不必要**；但「每请求几次」这一轴必须换成「**事件级 + next() 返回值判终局**」。

---

## 1. 证据（逐条，源码 path:line）

### 1.1 Cordis 事件面

| # | 事实 | 位置 |
|---|------|------|
| E1 | `agent/request` 与 `agent/request-error` 的 `@mode` 都是 **waterfall**；签名 `(payload, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>`；payload = `{agent, turn, step, provider, failure: LlmFailure, retryPolicy, signal}` | `packages/core/agent/src/runtime-types.ts:337`（agent/request）、`:338-353`（request-error，声明在 :353） |
| E2 | waterfall **通用语义**：监听者按注册顺序被包成外层；**不调 `next()` 就裁掉余下全部（含内置 `inner`）**；调 `next()` 即委派；返回最外层结果。⇒ 「多监听者」靠**组合**，不是广播：**观察者必须 `await next()` 并原样返回其结果**，否则会吃掉 llm-retry 的 `{kind:'retry'}` | Cordis `vendor/cordis/src/events.ts` 第 234–243 行 |
| E3 | 派发入口不做「消费者独占」判断：`dispatch('waterfall', args)` 只按 hook 顺序 + scope filter 取回调列表 | Cordis `vendor/cordis/src/events.ts` 第 165–175 行 |
| E4 | llm-retry 的监听者本体：`ctx.on('agent/request-error', (payload, next) => track(recover(payload, next)))`；`recover` 在「policy 缺省 / 码不可重试 / 预算耗尽 / `providerRetryAfterMs > maxDelayMs`」四种情况**全部 `return next()`**，只有真重试时返回 `{kind:'retry'}` | `packages/llm/llm-retry/src/index.ts:194-241`（`recover` 起 :194；`next()` 分支 :198、:215、:223、:231）；注册点 `:243-252` |
| E5 | llm-retry 的注册挂在其**自身 fiber**（apply 内 `ctx.on`），bundle patch 里是**常驻行、无配置** ⇒ 恒有监听者（R2 findings F9 已证）。观察者位于其**外层**（后注册/后插入）时看到的是「重试前」的失败现场 | `packages/llm/llm-retry/src/index.ts:243-252`；`cordis.patch.yml` 装配顺序 |
| E6 | 失败派发点：`finish.kind === 'error'\|'aborted'` ⇒ **先**持久化 `assistant/attempt`，**再** `dispatch.waterfall('agent/request-error', …)`；非 `retry` 则 `throw new LlmError(failure.message, failure.code, failure)`（**原样带上整份 failure**）。该点位于 `while(true)` 重跑循环内 ⇒ **每次尝试都派发一次** | `packages/core/agent-loop/src/agent.ts:505-524` |
| E7 | **流开始之后**的异步抛错**不经 `agent/request-error`**：`if (!started) throw error`；之后只落 `assistant/attempt` 再上抛（→ `turn/end.reason.error = {message: errorChain(e), code:'UNKNOWN'}`，见 S2）。复核 ticket #10 F10 | `packages/core/agent-loop/src/agent.ts:462-463`、`:474-489`、`:377-384` |
| E8 | `agent/error`（`emit`，payload `error: unknown`）在每次 `throwError` 时派发 —— 对未结构化错误只是 `unknown`，不能替代 E1 | `packages/core/agent/src/runtime-types.ts:393`；`packages/core/agent-loop/src/agent.ts:244-249` |
| E9 | `llm/*` 的 Cordis 事件只有 `llm/stream`（waterfall）、`llm/adapters-updated`、`llm/model-discovery-rejected`；**没有** `llm/request-error` 一类事件 | `packages/llm/llm/src/index.ts:75`、`:1173-1180`；`packages/llm/llm/src/types.ts:23`、`:322` |
| E10 | `step/*`、`turn/*` 是 **session 事件**（`step/start|end`、`turn/end`），不是 Cordis 事件 | `packages/core/session/src/types.ts:298-302` |

**⇒ 裁决「llm-retry 独占」：不独占。** 它是「唯一会返回 `retry` 的消费者」，waterfall 允许任意多个监听者共存；唯一真实风险是**顺序**（E2/E5），而顺序还决定「观察者拿到的 `next()` 是谁」——这一点在 §3.2 变成可利用的信息（`next()` 返回值 = llm-retry 的终局判定）。

### 1.2 session 事件面

| # | 事实 | 位置 |
|---|------|------|
| S1 | `turn/end` payload = `{ turn, reason: TurnEndReason }`；`error: { kind:'error', error: LlmFailure }`，文档明写「`LlmError` facts verbatim, or `{message, code:'UNKNOWN'}` flattened」 | `packages/core/session/src/types.ts:298`；`TurnEndReasonMap` 在 `:202-230`（error 行 :213） |
| S2 | `agent.ts` 构造 `turn/end.error`：`error instanceof LlmError ? error.failure : { message: errorChain(error), code: 'UNKNOWN' }` —— **结构化失败原样进持久日志** | `packages/core/agent-loop/src/agent.ts:377-384` |
| S3 | `assistant/attempt` payload = `{ turn, step, stream: AssistantStreamRecord[] }` —— **没有** failure 字段 | `packages/core/session/src/types.ts:356` |
| S4 | `AssistantStreamRecord` 只有 `text-chunks` / `reasoning-chunks` / `tool-call-chunks` / `chunk(time, chunk)`；``finish`` chunk 在 assembler 里只存 `_finish = chunk.reason`（不进 `stream` 的 public 形状） | `packages/llm/llm/src/assistant-stream.ts:20-44`；`packages/llm/llm/src/assembler.ts:89-92`、`:186-188` |
| S5 | 每个尝试都 `live.settle('assistant/attempt', …)`（失败、重试、取消、流错误都落一条）；**成功**的落 `assistant/message` | `packages/core/agent-loop/src/agent.ts:488-496`、`:500-512` |
| S6 | session 事件的插件观察入口 = `ctx.on('session/event', (session, event) => …)`（`emit`，post-commit，**逐监听者隔离**，不 veto、不 wait） | `packages/core/session/src/index.ts:64-74`、`:876-891` |
| S7 | **但**：本插件当前**既没 inject `subagents`/`sessions`/`agents`，apply 里也没拿过任何 session** —— 在 07 之前，「session 事件面」对插件**不可达** | 本仓 `cordis.patch.yml:12-19`；`src/dsh/host/core.ts`（applyCore 无 session 依赖） |

**⇒ 裁决「`assistant/attempt` 的 stream 是否暴露失败原因」：不暴露。** attempt 的 `stream` 是**内容流**。失败码在 **`turn/end.reason.error`**（每 turn 一条，**只在 turn 终止时**）与 **`agent/request-error` 的 payload**（每次尝试一条，**live**）。

### 1.3 服务/钩子

| # | 事实 | 位置 |
|---|------|------|
| F1 | `LlmFailure = { message, code, status?, providerRetryAfterMs?, requestId?, offloadImages? }` —— 分类学需要的三个字段全在 | `packages/llm/llm/src/types.ts:41-59` |
| F2 | `retryPolicy` 在 payload 中可读（V 解析后的 `ResolvedRetryPolicy`），但 llm-retry 的**内部尝试计数**不在 payload 里，只在 session 事件 `llm/retry.retry` 里，且投影状态 `llmRetry` 由 `sessionProjections.stateOf` 读取 —— **插件没有这条面** | `packages/core/agent/src/runtime-types.ts:353`；`packages/llm/llm-retry/src/index.ts:128-136`、`:186-190` |
| F3 | `LlmRuntime.stream()` 经 `ctx.waterfall(this, 'llm/stream', options, () => this.adapterStream(...))` —— **每次**模型调用（含 llm-retry 重跑的 step）都过这里；`options.provider/model` 可读 | `packages/llm/llm/src/index.ts:1173-1180` |
| F4 | `adapterStream`：适配器/迭代**任何 throw** 都被 `adapterFailureChunk(error, signal)` 转成 `{type:'finish', reason: signal.aborted ? {kind:'aborted',failure} : {kind:'error',failure}}` **yield 而不是抛**（两处：迭代器建立失败 :1119-1122、迭代中途失败 :1134-1137）；中间件/消费方错误仍按原样抛 | `packages/llm/llm/src/index.ts:1183-1191` |
| F5 | ⇒ **包装 `llm/stream` 的监听者能在流里看见失败码**，且这是**唯一**能覆盖 E7「流已开始后失败」的运行时面 | 由 F3+F4+E7 推出 |
| F6 | `AgentOptions` 不带 retry 策略；策略只能按 provider 路由配，并在注册时冻结 | ticket #10 findings F14；`packages/llm/llm/src/index.ts:450-451` |
| F7 | 预检/解析期抛错（`UNSUPPORTED_REASONING_EFFORT` 等）是**请求前**的 `LlmError`，**不进** `agent/request-error` —— #33 已在 03 里前置跳过，runtime 台账不需要它 | ticket #10 F12；本仓 `src/core/resolve/model-chain.ts` 的 `unsupported-effort` |

### 1.4 包边界与运行期可达性

| # | 事实 | 位置 |
|---|------|------|
| P1 | 本插件是**独立 npm 包**、经 bundle patch 装配；运行期依赖里**没有** `@deepseek-ai/dsh-agent` / `dsh-session`，只有 `peer`/`@deepseek-ai/cordis` | 本仓 `package.json` |
| P2 | ⇒ 插件**不能**用模块 augmentation 让 `ctx.on('agent/request-error', …)` 拿到**类型**；运行期仍可注册（E3：按字符串名查 hooks），只是要**本地声明 payload 形状**或窄收窄——实现形状问题，不是能力缺口 | E3 |

---

## 2. 残余不确定（逐条）

1. **未做真机实验**：全部为源码阅读。要钉死「每次尝试都派发一次 `agent/request-error`」，建议在隔离 profile 用 `dsh-llm-replay` 造假失败（不碰真实 provider / 不污染他人在跑的会话台账）。
2. **观察者相对 llm-retry 的位置**：取决于加载顺序（bundle 行的 patch 插入序 vs `install_bundle` 追到 profile patch 末尾）。默认（插件后装 → 外层）语义最好：能看见**每一次尝试**，且 `next()` 返回值就是 llm-retry 的决策。但**这个位置不是 API 承诺**（Cordis 只承诺注册序）；上游若调序会静默翻转语义 —— 建议加一个运行时自检：在 07 里断言「`agent/request-error` 派发次数 ≥ 1 且 `next()` 曾返回过 `{kind:'retry'}`」，否则**降级为只记终局**。
3. **`turn/end` 的 `code: 'UNKNOWN'` 兜底**：只在「非 `LlmError` 上抛」时出现（E7/S2）。本仓应把 `UNKNOWN` 当「不可判定」而不是「不可重试」——记录方**不入账**。
4. **`providerRetryAfterMs` 的跨 provider 不可比**：DeepSeek adapter 从 `retry-after` 头算（ticket #10 F6）；pi-ai adapter 是正则分类，通常**不产生**该字段（ticket #10 F7）。按它分档限流时须先判 provider。
5. **子代理会话的事件面**：`session/event` 对 agent-scoped 监听者只收到「经该 agent context 进入的 session」（`packages/core/session/src/index.ts:68-73` 摘文档行）。07 要通过 `subagents.start` 拿到 child 才能在 child 上挂 `session/event` —— 这是 07 的接线，不在本票范围，但**决定 `turn/end` 兜底腿是否可用**。
6. **`llm/stream` 的 scope 过滤**：声明是 `this: LlmRuntime` 的 waterfall（`packages/llm/llm/src/index.ts:70-76`），派发以 runtime 为 `thisArg`；非 `LlmRuntime` 作用域的插件行是否能收到，未核实。若被滤掉，这条腿退回「只有 `agent/request-error`」。**spike 时优先验证这条**（也是唯一一条需要真机才能定论的面）。

---

## 3. 实现建议

### 3.1 接口形状（记录方：`FailureSignal` → `RouteObservation`）

三层全在 **07 执行器**内，不碰 03（03 只读纯数据，`withAvailability` 已就位）：

```ts
// src/runtime/observe.ts（07 新建；纯逻辑 + 一个薄接线器）
/** 一次模型失败的结构化镜像（不 import 运行期；形状与 LlmFailure 字段相容）。 */
export interface FailureSignal {
  readonly route: { readonly provider: string; readonly model: string }
  readonly code: string                       // LlmFailure.code；'UNKNOWN' 表示不可判定
  readonly status?: number | undefined
  readonly providerRetryAfterMs?: number | undefined
  readonly at: number                         // epoch ms（注入 Date.now，保持可测）
  readonly terminal: boolean                  // llm-retry 已放弃（next() 返回 undefined）
  readonly source: 'request-error' | 'llm-stream' | 'turn-end'
}

/** R2 §2.3 的码 → 类；未知码 ⇒ 'transient-unknown'（默认不转移、不入账降级）。 */
export type FailureClass =
  | 'transient-server' | 'transient-timeout' | 'transient-transport' | 'empty-response'
  | 'rate-limit' | 'auth' | 'quota' | 'invalid-request' | 'context-overflow' | 'transient-unknown'
export function classify(s: Pick<FailureSignal, 'code' | 'status'>): FailureClass

/** 记录方（07 持有；内存，会话级）。 */
export interface FailureRecorder {
  record(signal: FailureSignal): void                        // 折叠进 Map<routeKey, RouteObservation>
  observations(now: number): readonly RouteObservation[]     // 喂 03 的 ChainObservations.routes
  reset(route?: { provider: string; model: string }): void   // UI「重置台账」（S5）
}
```

**接线（07 的两条腿）**

```ts
// A. Cordis 观察者（live，主腿）：必须委派，绝不消费
ctx.on('agent/request-error', async (payload, next) => {
  // ⚠️ 先原样委派：记录失败绝不能影响重试语义
  const action = await next()
  try {
    recorder.record({
      route: { provider: payload.provider, model: modelOf(payload) }, // model：07 已知的本次路由
      code: payload.failure.code,
      status: payload.failure.status,
      providerRetryAfterMs: payload.failure.providerRetryAfterMs,
      at: now(),
      terminal: action === undefined,   // ← llm-retry 没有接住 ⇒ 本次请求终局失败
      source: 'request-error',
    })
  } catch (error) { ctx.logger.warn('atelier ledger: record failed: %o', error) }
  return action                        // ← 原样返回，{kind:'retry'} 不能被吃掉
})

// B. llm/stream 包装（补 E7 盲区）：包一层，看见终局 finish，也看见「没走 waterfall」的失败
ctx.on('llm/stream', (options, next) => wrap(next(), (chunk) => {
  if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
    /* 记录 chunk.reason.failure；一条 (source:'llm-stream', terminal:true) 信号 */
  }
}))
```

**要点**（每条对应证据）：
1. **委派优先**（E2）：观察者必须 `await next()` 且原样返回；记录放在 `next()` **之后**（避免记录代码 throw 断掉重试链）。
2. **`next()` 的返回值是免费信息**（F2 的反面）：外层观察者拿到的 `next()` 就是「llm-retry 的决策函数」，因此 `action === undefined` ⇒ 终局失败。不需要读 llm-retry 的内部计数。
3. **`llm/stream` 包装不可省**：E7 的流中失败不进 `agent/request-error`，只有 `finish` chunk 能拿到码（F4）。若 §2 残差 6 证实 scope 挡住了，退化为「只靠腿 A + `turn/end` 兜底」。
4. **`turn/end` 只作兜底**：一次 turn 一条、且可能 `UNKNOWN`（S1/S2）；07 拿到 child 后 `child.session.on('session/event', …)` 可选接。

### 3.2 「一次请求算几条」——本票最重要的口径修正

`agent/request-error` **每次尝试**派发一次（E6 在 `while(true)` 内）。一次请求 = `1 + maxRetries` 次尝试（默认 ≤ 6，ticket #10 F3/F4）。因此：

- `RouteObservation.failures` 的口径应是「**本请求终局失败**记 1 次」，不是「每次派发」；中间重试不计入 `failures`（可选另记 `attempts`，不入 `health` 投影）。
- 判定终局 = **`terminal: action === undefined`**（§3.1）。这就保住了 `DEGRADED_FAILURES = 2` 的原义（「同一路由两次**请求**失败」，见 `src/core/resolve/observations.ts:26-27`）。
- **副作用与护栏**：若 observer 意外落在 llm-retry **内层**，`next()` 恒 `undefined`（cbs 为空 ⇒ inner 默认 `undefined`），每次重试都会被记成终局。护栏 = §2 残差 2 的运行时自检 + 「同 `(turn,step)` 只记一次终局」去抖。

### 3.3 `rateLimitStreak` 的退化口径（票面指标不可达）

§2.4 要求「同一路由 60s 内被限流 **3 次**」。llm-retry 对 `RATE_LIMIT` 只要 `Retry-After ≤ 10s`（或无头）就**立即** `{kind:'retry'}`（E4 的 :231 之外分支），所以**单请求就能产生 3+ 次 `RATE_LIMIT` 派发** —— 直接按派发计数会把「一次限流被重试 3 次」误判成「持续限流」。**建议**：

- `rateLimitStreak` = 「按 `(turn, step)`（= 请求）去重后的**终局** `RATE_LIMIT` 次数」（与 §3.2 同一过滤）；
- 或把它解释为「**不同请求**被限流」而非「不同尝试」—— 文档与测试写明，`src/core/resolve/observations.ts:81-95` 的分支逻辑**不用改**，只改喂入方。

### 3.4 给 03（S1）的两条只读提醒

1. `src/core/resolve/observations.ts` 的 `rateLimitStreak` 分支本身没错，但**注释与测试**要标明「这是请求级 streak，不是尝试级」——否则 07 一按派发计数喂就会把 `degraded` 提前触发。
2. `lastFailureCode: 'UNKNOWN'` 是**不可判定**，记录方**不入账**（不写 `failures`、不回写 `rateLimitStreak`）；03 无需改动（它只读计数）。

---

## 4. 回到票面研究问题

| 票面问题 | 答案 |
|---------|------|
| `agent/request-error` waterfall 是否允许多监听者？llm-retry 是否独占？ | **允许；不独占**（E1-E5）。观察者 `next()` 委派即可。顺序风险见 §2 残差 2；`next()` 返回值可判定终局。 |
| `llm/*`、`step/*`、`turn/*` 事件 payload 是否带失败码？ | `llm/stream` 的终端 `finish` chunk **带**（F3/F4）；`step/*` **不带**；`turn/end.reason.error` **带** `LlmFailure`（S1/S2）。 |
| `assistant/attempt` 与 `turn/end`？ | attempt **不带**（S3/S4）；turn/end **带**（S1/S2），但每 turn 一条、可能 `UNKNOWN`。 |
| `AgentOptions` / adapter 元数据 / `llm.resolveCallConfig` / `providerRetryAfterMs`？ | 与**运行时**失败码无关（F6/F7）；`providerRetryAfterMs` 在 `LlmFailure` 里，随 E1/F3 两条面都可达；`retryPolicy` 在 payload 里可读（F2），内部计数不可读。 |
| 是否存在可注入的中间件而仍能拿到 `{code,status,providerRetryAfterMs}`？ | **是**：外层 `agent/request-error` 观察者 + `llm/stream` 包装器，两者都拿到完整 `LlmFailure`。 |
| 结论 | **部分可观测**：码/status/providerRetryAfterMs 可读；**尝试级计数**需用 `next()` 返回值改写口径；另有两条面（`llm/stream` scope、子会话 `session/event`）待真机确认。 |
