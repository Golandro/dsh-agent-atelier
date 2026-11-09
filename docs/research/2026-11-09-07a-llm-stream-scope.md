# 07a findings — 失败台账两条腿与失败路由来源（ticket #55）

> 子票：[#55](https://github.com/Golandro/dsh-agent-atelier/issues/55)（07a：llm/stream scope 与失败路由来源，spike）。父图：[#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)。上游设计：[#34](https://github.com/Golandro/dsh-agent-atelier/issues/34) findings（`docs/research/2026-10-23-r2-obs-observability.md`，§3.1 两条腿、§3.2 请求级口径、§3.4 UNKNOWN 不入账）。
> 日期：2026-11-09。执行：Lead 会话（wayfinder research）。
> 一手源：**已安装 DSH 0.2.2-rc.1**（`~/.local/share/pnpm/store/v11/links/@deepseek-ai/…` 下的 `lib/*.js` 与 `lib/types/*.d.ts`）＋ **本进程真机探针** `test/host-llm-events.test.ts`（真实 `LlmRuntime` + 真实 `AgentLoop` + 真实 Session/JSONL，假 adapter 只产终端 error finish）。
> 源码树 `~/repo/deepseek-harness` 是 rc.1 tag 之后 811 个提交的 master，**本文件不使用它**。
> 本文件只记证据与结论：**不实现记录器**（实现归 #56）。

---

## 0. 结论摘要

1. **腿 B（`llm/stream` 包装）可用**：本 bundle 的插件行 ctx **不是** `LlmRuntime` 作用域，但事件照常到达行监听者——因为在 Cordis 里 `this: LlmRuntime` 只是**类型位**，真正的运行期过滤只发生在 emitter 自带 `Context.filter` 时；`LlmRuntime` 是普通 Service，它的 filter 只比较 **`llm` 服务的隔离标签**，行 ctx 与 runtime 同属一个隔离域 ⇒ 放行。真机探针在行 ctx 收到 `llm/stream`，并拿到 `options.provider` / `options.model`（逐尝试权威）。
2. **腿 A（`agent/request-error`）可用，且是`唯一`的「终局判定」来源**：其 dispatch carrier 带 `dsh-scope` 的 scope filter，规则是「**未打 scope 标签的 ctx 全局放行**，打了标签的 ctx 只在同键或其祖先键放行」。bundle 行 ctx 未打标签 ⇒ 收到所有 Agent 的失败；`next()` 的返回值仍给出 `{kind:'retry'}` 或 `undefined`。
3. **失败请求的 model 取 `session.requestContext()`**（最近一条 `request/context` 折叠，含 `provider` + `model`；该事件在**流开始之前**由请求准备阶段追加）。`agent.model.current()` 是「**下一步**的选择」（实现 `pending ?? lastUsed`），在步骤进行中被改选时会给出后来者，**不能当失败路由**；`turn/end.reason.error` 只有 `LlmFailure`，没有 route。
4. **腿 B 可省掉对 requestContext() 的依赖**：`llm/stream` 的 `GenerateOptions` 自带本次尝试的 provider/model，且 waterfall 也包住 `preparedCall.stream`（预解析调用）路径——真机验证，不是只看直连路径。
5. **退化方案不需要启用**；但保留「腿 A 判终局 + `turn/end.reason.error` 兜底」作为冗余描述（见 §4）。
6. **对 `rateLimitStreak` 口径无新影响**：#34 已裁决「按 `(turn, step)` 去重后的**终局** `RATE_LIMIT` 次数」。腿 B 只是更早看到每次尝试的失败现场，喂入方仍须按请求去重（§4.3）。

---

## 1. 两条腿的机制证据

### 1.1 Cordis 的事件过滤只认 emitter 的 `Context.filter`

```ts
// @deepseek-ai/cordis@4.1.0 src/events.ts:162-171
private _resolve(type: string, args: any[]) {
  const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null
  const name = args.shift()
  …
  const filter = thisArg?.[Context.filter]
  return [thisArg, (this._hooks[name] || [])
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
    .map(hook => hook.callback)] as const
}
```

- 没有 `filter` ⇒ **所有监听者都收**；有 `filter` ⇒ 逐个监听者的 ctx 过筛。
- 因此「`this: LlmRuntime` 会不会把插件行滤掉」取决于 `LlmRuntime` 有没有 `Context.filter`、以及它的规则是什么。

### 1.2 `llm/stream` 的 emitter 是 Service，filter 只比隔离标签

```ts
// @deepseek-ai/dsh-llm@0.2.2-rc.1 lib/types/index.js:2402
return this.ctx.waterfall(this, 'llm/stream', options, () => this.adapterStream(options, prepared))
```

```ts
// @deepseek-ai/cordis@4.1.0 src/service.ts:42-63（Service 基类）
constructor(protected ctx: Context, name: string) { … }
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

⇒ 仅当某个插件用 `ctx.isolate('llm')` 另供一份 llm 时，跨隔离域的监听者才被滤掉。**已安装的所有 DSH 包都没有 `isolate('llm')`**；bundle 行与 runtime 同在根隔离域（`isolate['llm']` 皆为 undefined）⇒ 相等 ⇒ 放行。探针实证：行 ctx 的监听者在真实 loop 调用中进入，并包住 `next()`。

### 1.3 Agent 事件是 scope 过滤，但未打标签的行 ctx 全局放行

```ts
// @deepseek-ai/dsh-agent@0.2.2-rc.1 lib/types/dispatch.js:19-42（carrier 与融合 payload）
export function agentCarrier(agent) { return scopeTarget(agent, agent) }
export function agentEvents(ctx, agent, carrier = agentCarrier(agent)) { … }
// @deepseek-ai/dsh-agent-loop@0.2.2-rc.1 lib/index.js:929
const action = await this.dispatch.waterfall('agent/request-error', { turn, step, provider: request.provider, failure: finish.failure, retryPolicy, signal }, () => Promise.resolve(undefined))
```

```ts
// @deepseek-ai/dsh-scope@0.2.2-rc.1 lib/types/index.js:327-335（scopeTarget 的 filter）
const tag = scopeOf(ctx)
if (tag === void 0) return true                       // 未打标签 ⇒ 全局放行
for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor))
  if (cursor === tag) return true                      // 同键或祖先键 ⇒ 放行
return false
```

⇒ 插件行的监听者没有 `kScope` 标签 ⇒ 收到所有 Agent 的 `agent/request-error`；若把记录器挂在某个 Agent 的 scope 下，则只收该 Agent 及其派生（这正是「每 Agent 一条台账」的可选实现方式）。探针实证：行 ctx 的监听者进入，`payload.provider` 与失败尝试一致。

### 1.4 失败路由在哪条受支持读面

```ts
// @deepseek-ai/dsh-agent-loop@0.2.2-rc.1 lib/index.js:1049-1075（流开始之前）
const requestContext = { provider: config.provider, model: config.model, … }
const previousContext = session.requestContext()
if (… differs …) session.append('request/context', requestContext)
```

```ts
// @deepseek-ai/dsh-session@0.2.2-rc.1 lib/types/types.d.ts:236-245
export interface RequestContext { provider: string; model: string; contextWindow?: number; systemPromptUpdate?: SystemPromptUpdate }
// @deepseek-ai/dsh-session@0.2.2-rc.1 lib/types/index.d.ts:315-320
requestContext(): RequestContext | undefined   // 折叠最近一条 request/context
```

对比两个候选：

| 读面 | 语义 | 在失败时刻是否等于失败请求的路由 |
|---|---|---|
| `session.requestContext()` | 最近一条已追加的 `request/context`（= 当前在飞请求） | **是**（探针实测 `{provider:'probe', model:'probe-small'}`；该事件在 stream 之前追加） |
| `agent.model.current()` | 「下一步」的选择，实现 `pending ?? lastUsed`（`dsh-agent` 的 `lib/types/model-selection.js` 第 81–96 行） | **不保证**：步骤进行中出现更新的 `model/selection` 时返回后来者；文档明说「This read neither starts a step nor changes an already-prepared step」 |
| `turn/end.reason.error` | `LlmFailure`（`dsh-session types.d.ts:188-191`） | 无 route，仅失败码 |

`request/context` 只在路由**变化**时追加，但折叠值永远是最新路由，因此同一路由的重复请求也读得对。

---

## 2. 真机探针（可复现）

`test/host-llm-events.test.ts`：`mountAgentLoopTestDependencies` + 真实 `AgentLoop` harness + JSONL 持久化 + 假 adapter（每次调用只 yield `{type:'finish', reason:{kind:'error', failure:{code:'RATE_LIMIT'}}}`）；监听者挂在**单独的插件行 ctx**（`ctx.plugin({ apply })`），与生产 `agent-atelier-summon` 行同形。

观测结果（两例全绿）：

1. `llm/stream` 监听者进入，`options.provider='probe'`、`options.model='probe-small'`；包装后的迭代器收到 `finish.error`，`failure.code='RATE_LIMIT'`；同一时刻 `agent.session.requestContext()` 等于该路由。
2. `agent/request-error` 监听者进入；`payload.provider='probe'`；`payload.agent.session.requestContext()` 等于失败路由；`payload.agent.model.current()` 在无并发改选时也一致（简单路径重合，不能据此推翻 §1.4 的语义结论）。

命令：`pnpm exec vitest run test/host-llm-events.test.ts --reporter=verbose`（基线：2 passed，~0.4s）。

---

## 3. 回到票面研究问题

| 问题 | 一句话结论 | 证据 |
|---|---|---|
| 腿 B（`llm/stream`）在本 profile 能否被 bundle 行收到 | **能**。`this: LlmRuntime` 不产生 scope 过滤；Service 级 filter 只比 `llm` 隔离标签，行与 runtime 同域 | `cordis src/events.ts:162-171`、`src/service.ts:61`；`dsh-llm lib/types/index.js:2402`；探针 §2.1 |
| 若被滤掉怎么办 | 不适用；若要保留冗余，退化为「腿 A 判终局 + `turn/end.reason.error` 兜底」，代价是丢失非 Agent 调用（compaction/title 等）的失败与逐尝试路由 | `dsh-agent-loop lib/index.js:929`、`dsh-session types.d.ts:188-191` |
| 失败请求的 model 从哪取 | **`session.requestContext()`**（腿 A 场景）；腿 B 直接用 `options.provider/model` | `dsh-agent-loop lib/index.js:1075`、`dsh-session index.d.ts:320`；探针 §2 |
| `agent.model.current()` 可用吗 | **不可作失败路由**；它是下一步选择（`pending ?? lastUsed`） | `dsh-agent` 的 `lib/types/model-selection.js` 与 `model-selection.d.ts` |
| `turn/end.reason` 可用吗 | 只作失败码兜底，**无 route** | `dsh-session types.d.ts:170-191` |
| 对 `rateLimitStreak` 口径的影响 | 无新影响：仍按 `(turn,step)` 请求级去重；腿 B 只是更早看见逐尝试现场 | `docs/research/2026-10-23-r2-obs-observability.md` §3.2-§3.3 |

---

## 4. 给 07b（#56）的实现约束

1. **终局判定只归腿 A**：`await next()` 原样返回；`action === undefined` ⇒ 本请求终局失败。**先委派、后记录**，记录异常只 warn。（腿 B 无法知道 llm-retry 是否会重试。）
2. **route 归腿 B（首选）或 `requestContext()`（腿 A 兜底）**：腿 B 的 `options` 含逐尝试 route；腿 A 在监听器里同步读 `payload.agent.session.requestContext()`，`undefined` 时按 #34 §3.4 「不可判定不入账」。
3. **去重键**：`(sessionId, turn, step)`。腿 A 每次尝试派发一次，腿 B 每次尝试一条 finish；两者合流时同一键只记一条终局。中间重试可另记 `attempts`，不进 `health`。
4. **不要用 `agent.model.current()` 写失败路由**；也不要用它做「当前模型」展示——除非展示的是下一步选择。
5. **监听者挂在 bundle 行 ctx（无 scope 标签）**；若改成 per-Agent 监听，挂到该 Agent 的 scope 内即可自动只收本 Agent。
6. **腿 B 覆盖非 Agent 调用**：compaction / 标题生成等直接调 `ctx.llm.stream` 的路径也会进 waterfall；这些没有 session/turn/step，记录时不要伪造归属，route 仍可从 options 取。

---

## 5. 边界与风险

- **隔离域漂移**：若未来某插件 `ctx.isolate('llm')` 另供 runtime，bundle 行收不到那份实例的 `llm/stream`；当前安装树无此用法，探针覆盖的是标准拓扑。
- **scope 归属**：bundle 行若被装进某个 Agent scope（非本 profile 形态），腿 A 将只收该 Agent 及其子；这是特性而非缺陷，但实现时要知道。
- **腿 B 的失败可见性边界**：adapter 自己 throw 会被 `LlmRuntime.stream` 归一成终端 error/aborted finish（`dsh-llm types.d.ts:450-470` 的 `StreamChunk` 契约），因此包装器看得到；但 `llm/stream` 的**监听者自身** throw 属于消费者失败，不属于 provider 失败，不能入账。
- **无真机 profile 冒烟**：探针是「真实宿主服务 + 真实 loop + 假 adapter」的进程内真机，未在 GUI profile 上跑 429；按 #55 的隔离纪律，故意不用真实限流污染他人在跑的会话。
