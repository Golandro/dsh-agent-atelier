# Resolve：纯模型链与观测投影

状态：**写实**（2026-11-12 按包抽象 1 布局核对）。这一页写给要改「agent 的模型怎么被选中」「失败台账怎么影响选择」的人；所有输入都是注入数据，所有输出都是纯结果。

本域只有一件职责：**用纯函数把静态度量（文档 + registry 快照 + 策略）与可选的运行时台账，折成一条可解析的模型路由或一个携带整条链的错误**。它不读文件、不读环境、不读时钟、不碰宿主，也不记录失败。

## 模块与入口

公开入口是 `src/resolve/index.ts`，只 re-export 两个模块：

| 文件 | 职责 |
| --- | --- |
| `src/resolve/model-chain.ts` | 模型链解析引擎：候选展开、可用性 / 白名单 / effort 门、胜者与报告 |
| `src/resolve/observations.ts` | 失败台账投影：把每路由的观测折成 `health`，阈值与窗口的唯一来源 |

深模块内的辅助函数（候选展开、报告构造）不跨域暴露；跨域只准经公共入口。

## 依赖方向

矩阵给 resolve 的允许面只有 `src/contract/index.ts`；没有 `node:*`，没有 Cordis，没有第三方包，也没有 catalog / providers / control / dsh 的 import。代价是它看不到文件与注册表：快照、策略、台账都由调用方读好再注入。

消费方只有 control（经 `src/resolve/index.ts`）：

| 消费者 | 用法 |
| --- | --- |
| `src/control/resolve.ts` | 把快照里的 `effort` 投影成 `itemEffort`、把宿主能力表投影成 `supportedEfforts`，组装成引擎上下文；调用方把它与文档、快照一起喂给引擎，不重排、不改失败 |
| `src/control/core.ts` | `composeSession` 的会话路径调用 `resolveModelChain`，拿到路由与 persona / tool filter / flavor |
| `src/control/failures.ts` | 失败记录器用 `routeKey` 作为台账键、用 `RATE_LIMIT_WINDOW_MS` 判断窗口，与投影共享同一编码与阈值 |

dsh/host 不直接 import resolve；它经 control 的会话面消费。任何反向 import 都是层违规。

## 关键符号与落点

| 符号 | 落点 | 契约 |
| --- | --- | --- |
| `resolveModelChain` | `src/resolve/model-chain.ts` | 引擎唯一入口：`ChainResolutionContext` → `ChainResolution`；确定性、全函数、永不 throw |
| `routeKeyOf` | `src/resolve/model-chain.ts` | 路由能力表的键；实现与台账的 `routeKey` 相同，两侧不会漂 |
| `withAvailability` | `src/resolve/observations.ts` | 快照 + 台账 + now → `ProjectedModel` 列表；只加 `health`，不改其他字段 |
| `routeKey` | `src/resolve/observations.ts` | 路由键，用 `[provider, model]` 的 JSON 编码，避免 provider / model 含 `/` 时碰撞 |
| `DEGRADED_FAILURES` | `src/resolve/observations.ts` | `2`：同类失败达到两次记为 degraded（一次已是 llm-retry 的噪音） |
| `RATE_LIMIT_STREAK` | `src/resolve/observations.ts` | `3`：窗口内连续限流达到三次才算 sustained |
| `RATE_LIMIT_WINDOW_MS` | `src/resolve/observations.ts` | `60000`：限流窗口，记录器与投影共用 |
| `ChainItemEffort` | `src/resolve/model-chain.ts` | 按 model entry 名索引的 effort 覆盖表；缺项不发明值 |
| `ChainResolutionContext` | `src/resolve/model-chain.ts` | 引擎的全部注入输入：agent、snapshot、policy、flavor、itemEffort、observations、now、supportedEfforts |
| `SupportedEfforts` | `src/resolve/model-chain.ts` | 按 `routeKeyOf` 索引的 effort 能力表；路由缺行 = 未知，不是不支持 |
| `ProjectedModel` | `src/resolve/observations.ts` | `ModelDefinition` 加 `health` 的投影行；不复制也不替换原快照 |

## 解析语义

- **两条来源汇入同一候选管线**：`modelOrder` 的 alias 展开与 legacy `model:` 数组都变成同一种候选记录；`origin` 只留作报告里的 provenance，解析逻辑不按来源分叉。
- **候选门顺序**：先看条目自身的 `available`（false ⇒ `unavailable`，不再问白名单与 effort），再看策略白名单（`not-allowed`），最后看 effort 能力（`unsupported-effort`）。第一顺序保持 spec 的语义；白名单不是台账，健康度不改变它。
- **胜者与报告**：按声明顺序取第一个幸存候选；胜者之后的候选标 `not-reached`，不假装它们输在规则上。报告带 `aliasChain`、`candidates`、`selectedBy`、`effortSource`，可用性 / 跳过原因都在数据里。
- **链耗尽不是 throw**：返回 `{ ok: false, code: 'chain-exhausted' }`，message 回显整条链（含 unknown alias / 无 target / 每个候选的 reason），供 summon 工具转成 `isError`。
- **effort 优先级**：链项覆盖（按 model entry）优先，其次 agent 默认；两者都没有就不发明。能力表里没有该路由的行 ⇒ 不判；有行但不含该 effort ⇒ 跳过该候选，绝不静默改写 effort。
- **健康度两轴不混**：`available` 是用户的持久配置，`health` 是运行时临时视图；投影从不写回 `available`，也不丢行、不重排。不注入台账时引擎不写 `health`，报告逐字段与 R2 之前一致；独立调用 `withAvailability` 时，`available: false` 仍读 `disabled`，其余读 `active`。
- **池内顺序**：同一 alias 池里，`active` 候选保持在声明顺序，`degraded` 候选整体靠后；raw fallback 是逃生门，不参与池排序，保持声明顺序。
- **degraded 判定**：`failures >= 2`，或 `rateLimitStreak >= 3` 且 `now - rateLimitSince <= 60s`；`now` 不注入时限流不判（不知道多久以前，猜会错）。`disabled` 先于一切，台账不再被查询。

## 报告怎么读

`ChainResolutionReport` 是 UI 与 catalog 警告共同渲染的数据，不要把结论从字段名猜出来：

| 字段 | 读法 |
| --- | --- |
| `aliasChain` | `modelOrder` 的每一步：该 alias 的 targets、胜出的 modelName，或 `unknown-alias` |
| `candidates` | 引擎考虑过的每个候选；胜者没有 `skipped`，其余带跳过原因或 `not-reached` |
| `selectedBy` | `alias` / `raw` / `none`；失败链只会是 `none` |
| `effortSource` | `chain` / `agent` / `none`，对应 effort 的最终来源 |
| `rawFallbackUsed` | raw `model:` 候选是否存在；用于 escape-hatch 警告，不表示一定被选中 |

成功结果额外带 `provider` / `model` / `reasoningEffort` / `persona` / `toolFilter` / `flavor`，失败结果只带 `code` / `message` / `report`。

## 测试 seam

- `test/resolve-model-chain.test.ts`：声明顺序、可用性、白名单、effort 能力、degraded 池内降级、raw fallback、`not-reached`、失败消息回显、确定性。
- `test/observations.test.ts`：`routeKey` 无拼接歧义、两个阈值与时间窗、disabled 优先、不修改 / 不重排 / 不丢行、无台账时只由 `available` 决定 disabled / active。
- `test/control-failures.test.ts`：记录器产出的台账真正改变会话路径的选择；同一快照在阈值到达后改选 sibling。
- `test/failures.test.ts`：记录器自身的 fold（分类、request vs attempt、限流规则、去重与重置），钉住它与 resolve 共享的常量与键编码。

## 不做的事

- **不做 I/O**：不读文件、不读环境、不读宿主、不读时钟；`now` 由调用方注入。
- **不做记录**：失败记录器在 control；本域只读台账，不写台账、不改 `available`。
- **不发明阈值**：不从原始错误文本推阈值，不改写错误分类；分类与计数归记录器。
- **不做路由发现**：不扫描 provider、不解析 registry.yaml、不查模型能力；这些由 catalog / host 注入。
- **不做缓存**：纯函数、同步返回；没有 memo、没有在途共享。
- **不重写语义**：不为了「能用」改写 effort、不越过白名单、不把不可用路由重新试一次。
- **不拥有会话**：不创建 Agent、不发请求；它只回答「该用哪条路由」与「为什么」。
