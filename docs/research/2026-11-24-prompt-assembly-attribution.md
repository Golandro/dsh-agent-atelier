# 研究：宿主装配事件链的可分离边界与来源归因（issue #81）

> 票：[#81](https://github.com/Golandro/dsh-agent-atelier/issues/81)（wayfinder:research）。
> 日期：2026-11-24。作者：research-host-assembly 研究子代理。
> 一手源：**DSH 源码树 `.vendor/deepseek-harness/`，commit `66491b05e3`（dsh-v0.2.2-rc.1）**。下文 `packages/...` 行号均为该 pin 现场读到的行号；本仓路径以 `src/` 起头。
> **基线告警**：仓库守卫 `scripts/checklist/anchors.mjs` 的 `DSH_SOURCE` 缺省指向 `~/repo/deepseek-harness`（当前 rc.3，`39163dd30f`），与本文的 pin **不是同一份代码**。逐文件 diff 结果：`scope/src/store.ts`、`preset/persona/src/index.ts`、`tests/scoped.spec.ts` 完全一致；`system-prompt/src/index.ts` 仅差两个 `SECTION_ORDERS`/`CONTEXT_ORDERS` 条目（`TOOL_PTY_PANEL`、`TEAM_IDENTITY`），行号不变；`agent-loop/src/agent.ts`、`llm/src/message.ts`、`session/src/types.ts`、`tests/system-prompt.spec.ts` 有若干行偏移。**本文一律按 pin 取行号**，引用前请按 pin 复核。
> Cordis 内核在 `vendor/cordis/`，不在 `packages/` 下，守卫的锚点解析器扫不到它，故按本仓既有惯例（`2026-10-23-r2-obs-observability.md` §前言）把它的行号写作**非锚点**形式：`vendor/cordis/src/events.ts` 第 N–M 行。
> 边界：纯源码阅读，未跑测试、未改宿主、未提交宿主。

---

## 0. 结论（一句话）

**waterfall 之后「按来源分段」在一般情况下不可能**：`PromptPresentation` 只带 `{name, text, interpolate}`，没有贡献者身份；handler 可任意增删改且无任何记录；`complete` 节还会把结果压成单节。
**但「装配前后差分归因」可行**：在 waterfall 最外层（`prepend: true`）抓一份装配前快照，`await next()` 后对比，按 `name` 把未变动的节归给注册者，变动/新增/消失的标记为「被 waterfall 改写」。代价是观测者必须是最外层且必须 `next()`，且**被遮蔽的 scoped 覆盖者仍看不到**。

---

## 1. waterfall 入参可变性与 transformed 的权威性

| # | 事实 | 位置 |
|---|------|------|
| W1 | waterfall 收到的 `assembly` 是一个**普通可变对象** `{ sections, contexts, variables }`，直接由注册表构造，未冻结、未拷贝 | `packages/core/system-prompt/src/index.ts:676-683` |
| W2 | 派发：`ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))` —— 末参 `inner` 原样返回同一对象 | `packages/core/system-prompt/src/index.ts:684-687` |
| W3 | 返回值被采纳：`return { ...transformed, tools }`（无 complete、无抑制时）；有 complete/抑制时同样以 `...transformed` 为底 | `packages/core/system-prompt/src/index.ts:688`、`:690-695` |
| W4 | **tools 永远来自 provider**，waterfall 拿不到也改不了（`PromptPresentation` 无 `tools` 字段） | `packages/core/system-prompt/src/index.ts:125-134`、`:675` |
| W5 | handler 可以原地 push 且后续 handler 看得见；也可不调 `next()` 直接短路返回一个全新对象（测试用空 sections 短路） | `packages/core/system-prompt/tests/system-prompt.spec.ts:458-482`（A push、B 看见）、`:484-495`（短路） |
| W6 | waterfall 通用语义：监听者按注册顺序包成外层，**不调 `next()` 即裁掉余下全部（含 inner）**；`next()` 只能调一次 | `vendor/cordis/src/events.ts` 第 250–264 行 |
| W7 | 返回值**没有任何校验**：handler 可改名、删节、加无名节、把 `variables` 换成新对象；`AssembledSection`/`AssembledContext` 只是 `{name, text, interpolate?}` | `packages/core/system-prompt/src/index.ts:93-110`、`:676-695` |

**⇒ `transformed` 是唯一真相**（sections/contexts/variables 三者），但它是**黑箱产物**：没有任何字段记录「谁改了什么」。

## 2. `complete` 节的恢复语义

| # | 事实 | 位置 |
|---|------|------|
| C1 | `completeSection` 在 **waterfall 之前**从注册表快照：`sectionDefinitions.filter(s => s.complete === true)`；>1 个直接 throw | `packages/core/system-prompt/src/index.ts:660-663` |
| C2 | 快照是**浅拷贝且在水之前**：`if (section.complete === true) completeSection = { ...assembled }`（`assembled` 在 `:667-671` 构造） | `packages/core/system-prompt/src/index.ts:672` |
| C3 | 生效条件：`completeSection !== undefined` ⇒ `sections: [completeSection]`，**waterfall 对 sections 的全部增删改被整体丢弃**；contexts 与 variables 仍取 `transformed` | `packages/core/system-prompt/src/index.ts:693-694` |
| C4 | 测试坐实：handler 把 complete 节文本改成 `'mutated'` 并 push `'late'`，结果仍是 `[{name:'complete', text:'Exact prompt.'}]` | `packages/core/system-prompt/tests/system-prompt.spec.ts:497-513` |
| C5 | handler **不能自己引入 complete**：判定只读注册表，waterfall 期间新加的节即使带 `complete: true` 也不生效 | 由 C1+C2 推出；`packages/core/system-prompt/src/index.ts:660-672` |
| C6 | 生产里唯一会置 `complete` 的是 persona 行（`config.complete`） | `packages/preset/persona/src/index.ts:42-43`、`:62-68` |

**⇒ 一旦 complete 生效，装配结果只剩一节，任何「按来源分段」都退化为单段**；此时 `name` 仍是注册名（`PERSONA_PREFIX_SECTION` = `deployment:persona-prefix`，`packages/core/system-prompt/src/index.ts:197`），所以还能说「这整份来自 persona」，但**看不出被它压掉的其余贡献**。

## 3. 变换的可观测性：没有

| # | 事实 | 位置 |
|---|------|------|
| O1 | 本包**没有任何日志**：`system-prompt` 源码里 `logger`/`ctx.log`/`debug` 命中数为 0 | `packages/core/system-prompt/src/index.ts`（全文 grep 无命中） |
| O2 | 唯一的变更事件 `system-prompt/change` 是 `emit`、**无 payload**，只在**注册/注销**时触发，不在装配时触发 | `packages/core/system-prompt/src/index.ts:32-37`、`:446-449`；`packages/core/scope/src/store.ts:257-262` |
| O3 | 没有任何 session 事件记录节级装配：`system/message` 只存**渲染后的整段文本**，source 恒为 `{kind:'system-prompt'}` | `packages/core/session/src/types.ts:324-338`；`packages/llm/llm/src/message.ts:34-37`、`:150-154` |
| O4 | 唯一带**逐贡献者身份**的持久面是 **contexts**（`ContextSnapshotSection{name,text}`），sections 没有对应物 | `packages/llm/llm/src/message.ts:69-75`；`packages/core/system-prompt/src/index.ts:337-344`；`packages/core/agent-loop/src/agent.ts:299-300`、`:449-450` |
| O5 | `internal/dispatch` 在公开事件派发**之前**给出 `(mode, name, args)`，args 里含 assembly 引用；但只在**派发开始**触发，没有 per-listener 回调、没有结束后状态 | `vendor/cordis/src/events.ts` 第 162–172 行；生产用例 `packages/terminal/terminal-bash/src/index.ts:48-58` |
| O6 | `ctx.events._hooks[name]` 能枚举 `{ctx, callback, options}`（inspector 就这么做），但那是**私有字段**，非契约 | `vendor/cordis/src/events.ts` 第 119–122、131 行；`packages/experimental/inspector/src/shared/cordis/collector.ts:157-159` |

**⇒ 「哪个 handler 改了哪一节」查无此面。** 唯一可行的观测手段是**自己在最外层做前后差分**（见 §6），而不是读宿主记录。

## 4. `sections[].name` 与注册名的一一对应

| # | 事实 | 位置 |
|---|------|------|
| N1 | 注册以 `name` 为键存入 `NamedEntries`，同层重名 throw | `packages/core/scope/src/store.ts:43-54`；`packages/core/system-prompt/src/index.ts:485-494` |
| N2 | 合并 = 按名 `Map.set` 覆盖：先全局，再 scope 链**由远及近**，近者赢 | `packages/core/scope/src/store.ts:208-217` |
| N3 | 装配只做排序（order 后 name 码位序），`name` **原样抄进** `AssembledSection` | `packages/core/system-prompt/src/index.ts:659`、`:667-671`；排序 `:255-257` |
| N4 | **没有重命名、没有文本合并**：合并只发生在 N2 的按名遮蔽 | `packages/core/system-prompt/src/index.ts:637-638` |

**⇒ 到 waterfall 入口为止严格一一对应**（每节对应「某个 scope 层里该名的最新注册」）。**waterfall 之后不再成立**（W5/W7 允许任意改写），**complete 时更是 N:1**（C3）。

## 5. scoped 遮蔽后，「被遮蔽者」是否还留得下

| # | 事实 | 位置 |
|---|------|------|
| S1 | `merge()` 用 `Map.set` 覆盖，**被遮蔽的全局条目直接不可达**，不保留任何记录 | `packages/core/scope/src/store.ts:208-217` |
| S2 | 更狠的是：遮蔽在**求值前**生效，被遮蔽者的 text provider **根本不会被调用** —— 测试断言 `globalText` 调用次数为 0 | `packages/core/system-prompt/tests/scoped.spec.ts:66-79` |
| S3 | 因此被覆盖者的**文本从未被生产出来**，不是「丢弃」而是「未发生」 | 由 S1+S2 推出；`packages/core/system-prompt/src/index.ts:638`、`:659-674` |
| S4 | 想还原遮蔽关系只能读分层注册表本身，而它是 `private readonly layers` | `packages/core/system-prompt/src/index.ts:446-449` |
| S5 | 本插件确实依赖遮蔽语义：persona 行沿用原生节名去覆盖部署级前缀 | `src/assembly/sink.ts:117-133`；`src/contract/assembly.ts:143-151` |

**⇒ 「被覆盖」在装配结果里留不下。** 预览要展示它，只能由**注册方自己**（知道自己注册了什么，如 `src/assembly/sink.ts:76`）或在**合并前**读层（不可达），不能从 `PromptPresentation` 反推。

## 6. 可行的归因方案与代价

**方案：最外层前后差分。** 以 `prepend: true` 注册一个 `system-prompt/assemble` 监听者：

1. 进入时 `structuredClone(assembly)` 得 `before`（此时是纯净的注册表产物，name 与注册名一一对应，见 §4）；
2. `const after = await next()`；
3. 逐 `name` 比对：未变动 → 归给该名注册者；文本变动 → 标「被 waterfall 改写」；新增 → 「waterfall 注入（来源未知）」；消失 → 「被 waterfall 删除」。

**代价与边界：**

| 代价 | 证据 |
|------|------|
| 必须是最外层（`prepend`）且**必须 `next()`**；否则看不到最终结果，或自己被短路裁掉 | `vendor/cordis/src/events.ts` 第 250–264 行；`packages/core/system-prompt/src/index.ts:684-687` |
| 与其他同样 `prepend` 的监听者**顺序不确定**，差分基线可能已被别人改过 | `vendor/cordis/src/events.ts` 第 267–272 行（`unshift` 追加到最前，后 prepend 者更外层） |
| 看到的是 **waterfall 返回、complete 恢复之前**的状态；要预测最终 sections 需自己重放 `complete` 规则 | `packages/core/system-prompt/src/index.ts:688-695` |
| 归因只到 **name 粒度**；handler 若改名或把两节文本合并进一节，原贡献者身份**永久丢失** | W5/W7；§4 N4 |
| **scoped 遮蔽者仍不可见**（§5），要展示「被覆盖」必须另建注册侧账本 | S1-S4 |
| 每次装配多一次深拷贝（sections+contexts+variables 全文），逐步执行 | `packages/core/agent-loop/src/agent.ts:294`（每 step 一次 assemble） |
| 只能归因 **sections**；contexts 另有原生 `ContextSnapshotSection` 通道，variables 只能按名 | O4；`packages/core/system-prompt/src/index.ts:337-344` |

## 7. 未找到

- **未找到**任何「per-handler 变换审计」的 hook / 事件 / 日志 / 持久面（§3 全部证否）。
- **未找到** sections 的 `ContextSnapshotSection` 等价物（即带贡献者名的 section 快照）；持久面只有渲染后整段文本。
- **未找到**被遮蔽 scoped 覆盖者的保留记录或查询接口（§5）。
- **未找到**宿主提供的「装配前快照」公共 API；`assemble()` 直接返回 waterfall 之后的结果，注册表 `layers` 为 private。
- **未找到** `complete` 场景下任何「其余节被压掉」的日志或事件；只有最终单节。

## 8. 对预览的直接含义

- **按来源分段 = 不可能在 waterfall 之后凭空做到**；能做的是「注册名 + 差分标签」的分段，其中被 waterfall 改写的段只能标成「来源不明/已改写」。
- **要展示「被覆盖」必须自带账本**：注册时记下 `{name, order, scope, 贡献者}`，装配后用同一份快照对账；宿主不提供这条。
- **contexts 是唯一可以「直接」按来源分段的部分**（`renderContextSections` 已按名返回），预览若想先做出可用形态，应从 contexts 起步。
