# Control 写作核心

状态：**骨架：2026-11-12 建立，包抽象 2/3 收口时写实**。面向维护者与实现者：读这一页知道一次编辑从 compose 到落盘经过哪里，以及哪些入口是公共契约、哪些只是内部 seam。

## 职责

control 是写作核心域：把一份 agent 文档的原始字节组成编辑器可读的块（compose），把编辑计划成逐文件写入并原子落盘（plan / commit），并承载 frontmatter 与 `registry.yaml` 的行级编辑、列表查询求值、会话启动的模型链投影、summon 启动决策与运行时失败台账折叠。它只回答「怎么读、怎么写、怎么解释快照」，不注册 HTTP 路由，也不持有 UI 状态。

边界事实：原始文本是唯一真相源，任何字段编辑最终都编译成行拼接，不得在 control 里另建一份 frontmatter 数据模型；一次 commit 要么整文件成功、要么整文件拒绝，绝不半写。

## 公共入口

- `src/control/index.ts`：唯一跨包公共入口，re-export control core、session / summon / resolve 的纯决策、failure recorder、两种 client 适配器、query 求值器与全部域类型。跨包读取只准落在这里。
- `src/control/client-errors.ts`：窄子入口。wire 形状的错误类（`ControlClientError`、`UnknownAgentError`）、写入报告到 HTTP 状态的映射、abort 判据与 mutation 标记头；浏览器安全，不 import `node:*`。dsh/client 与 host wire 共享同一份标记和状态语义。
- `src/control/http-client.ts`：窄子入口。`ControlClient` 的 HTTP 适配器，面向固定路由（state / compose / chain / plan / commit / registry / invalidate），把非 2xx body 映射成同一个 `ControlClientError`；不 import `node:*`，浏览器与测试共用。
- 内部 seam 不扩大公共面：`src/control/memory.ts` 的 `createInMemoryControlCore`、`src/control/writes.ts` 的纯计划函数、`src/control/compose.ts` 的块切分仍由 core 组装，测试直接 import 模块。

## 依赖方向

矩阵（`scripts/checklist/matrix.mjs`）给 control 的 entries：`src/contract/index.ts`、`src/yaml/index.ts`、`src/catalog/index.ts`、`src/catalog/ports.ts`、`src/resolve/index.ts`、`src/providers/index.ts`、`src/providers/fs/index.ts`；node 只准 `node:path`，不许 `node:fs`，不许 Cordis。I/O 一律经 `ControlFileSystem` 端口注入。

消费者方向：dsh/host 的 wire 与 ui-host 只读 `src/control/index.ts` 的公共面；dsh/client 只经 `src/control/index.ts` 的公共面与 `src/control/client-errors.ts`、`src/control/http-client.ts` 两个浏览器子入口；`src/index.ts` 兼容入口从 control 入口取既有导出名。control 反向不 import dsh、host 包或 UI。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/control/compose.ts` | `composeAgentDocument`、`assembleAgentDocument`。fence 内 frontmatter 与 body 都按原始字节成块；无 fence 的文档合成单 prose 块，字段编辑时才由 assemble 合成 fence（D14）。 |
| `src/control/core.ts` | `createControlCore`、`ControlCore`、`ControlDependencies`、`planDirtyEdits`、`createAgentDocPort`、`AgentDocPort`。票 11 的六成员（snapshot / compose / plan / commit / applyRegistryEdit / invalidate）加票 19/58 的 `composeSession` / `chainReport`；作用域解析与 registry 编辑都收在这里。 |
| `src/control/writes.ts` | `planDocumentEdits` 是纯函数（同输入同计划，逐编辑拒绝）；`commitPlan` / `commitEntry` / `atomicWriteFile` 走目录内临时文件、rename、写后重读，返回逐文件报告且不抛。 |
| `src/control/frontmatter-edit.ts` | `applyFrontmatterField` 一次只替换 / 插入 / 删除一条顶层键行及其缩进块；`serializeFrontmatterScalar` / `serializeFrontmatterArray` 只生成读器可读回的形状，空数组即删除。 |
| `src/control/registry-edit.ts` | `applyRegistryEdit` 先经 alias registry 解析生效模型定义再选层；built-in / synthesized 条目只读；写前用 `readRegistryLayer` 校验，坏层整体拒绝。 |
| `src/control/session.ts`、`src/control/session-agent.ts` | 会话启动形状（`SessionStartParameters`、`ComposedAgentSession`、`AgentChainReport`）与 `ChainExhaustedError`、`chainInputOf`、`composeSessionOf`。chain 跑空是硬错误，message / report 原样透传。 |
| `src/control/summon.ts` | `planSummonStart`、`readSummonArguments`、`summonRestriction`、`isDefaultBridge`、`missingRequiredTools`。纯决策，不碰宿主；默认桥不加 persona、不覆盖父路由（D4）。 |
| `src/control/query.ts` | `evaluateAgentQuery`：列表筛选与排序的唯一解释者；问题权重与稳定并列由它决定，视图与测试不得各写一份。 |
| `src/control/failures.ts` | `classify`、`createFailureRecorder`。请求终态失败记 `failures`，attempt 级只更新展示字段；rate-limit 按 `(session, turn, step)` 去重；不读时钟，`observations(now)` 用注入时刻。 |
| `src/control/resolve.ts` | `sessionChainContext`、`projectItemEffort`、`routeNotAllowed`。把文档与已读快照投影进纯链引擎，本身不重排、不改写失败。 |
| `src/control/client.ts`、`src/control/memory.ts` | `ControlClient` / `createMemoryControlClient` 是两个适配器的共同端口；memory 用 `Map<string, string>` 跑真实的 provider、registry 与写算法，不复制 merge / serialization。 |
| `src/control/types.ts` | 域形状：composed document、edit、write plan / report、registry edit、snapshot / query。不引入字符偏移或编辑器状态。 |

## 测试 seam

- `test/control-*.test.ts` 覆盖本域：`control-compose`（fence 与逐字节往返）、`control-core`（内存适配器上的完整读写）、`control-frontmatter-edit`、`control-node-write`（临时文件 / rename）、`control-scope`（工作空间作用域与 registry 编辑）、`control-session`（链解析与 allowlist）、`control-failures`、`control-client`（两种适配器同一契约）、`control-assemblies`（snapshot 的装配投影）。
- `test/host-wiring.test.ts`：wire 路由只做信封校验再调 control core，字段编辑与冲突 / 只读映射不另造规则。
- `test/failures-wiring.test.ts`：两条宿主腿「先 delegate 再记录」与 attempt-only 的语义。

## 不做的事

- 不注册路线、不读请求体、不做 CSRF / origin 校验：HTTP 入口归 `src/dsh/host/wire.ts` 与 `src/dsh/host/ui-host.ts`。
- 不定义 host 服务生命周期、不 import Cordis；control 只通过注入的 registries 与文件端口工作。
- 不解析整份 YAML、不持有独立 registry schema：行 / 标量规则归 yaml，schema 与层语义归 catalog。
- 不把 chain 解析、列表查询或写计划复制到 UI；所有视图消费 control 的投影或公共函数。

## 待收口项

- TODO（包抽象 3）：按票面确认 `src/control/index.ts` 的公共面是否最终冻结为当前导出集合；任何新增 / 收窄先改矩阵与 self-test，禁止用深路径兼容。
- TODO（包抽象 3）：复核 `src/control/memory.ts`、`src/control/compose.ts`、`src/control/writes.ts` 等内部 seam 的「测试直读」边界，写实本页并补齐与 dsh/host 的职责表。
- TODO（包抽象 3）：确认 `src/control/types.ts` 对 `FrontmatterField` 的 re-export 是否仍需要（类型唯一真相在 `src/contract/types.ts`），保持单一类型来源、不复制定义。
- TODO（docs 收口）：本页状态转「落定」，与包抽象 3 的 docs 全量刷新同批；届时把上表的事实与 ADR-0008 的最终布局对齐。
