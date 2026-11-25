# Assembly 装配域

状态：**2026-11-15 落定（包抽象 3）**。源码目录与公共入口已统一为 `src/assembly/`；本页按当前代码写实规划、目录投影与 compat sink。

## 职责

Agent 会话启动时，把「已解析的 agent + 装配配置」变成一份固定的提示词装配计划；再把这组计划的可执行 system 行挂进 Agent 自己的 scoped prompt registry（compat sink）。同一层还持有 agent 目录的纯投影、摘要门与消息渲染：一次 registry 快照进，一份 catalog snapshot 与一条替换消息出。

边界事实：规划是纯函数，不读宿主、不读文件、不读时钟，也不 import hash 实现；SHA-256 与消息 id 由宿主适配器注入。catalog 的 digest 覆盖 canonical catalog 内容（mode / completeness 与 agent / alias 行），不把 alias 目标算进摘要。

## 公共入口

`src/assembly/index.ts` 是唯一跨包入口，re-export 三组面：

- planner：`planAssembly` 与七个 section 名常量（`MODEL_SYSTEM_SECTION`、`PERSONA_PREFIX_SECTION`、`SKILLS_SECTION`、`TOOLS_CHANNEL_SECTION`、`DIGEST_CHANNEL_SECTION`、`FIRST_MESSAGE_CHANNEL_SECTION`、`PRE_STEP_CHANNEL_SECTION`）。
- sink：`createAssemblyService` 与 `AssemblyServiceOptions`；返回宿主契约的 `AgentAssembly`。
- catalog：`projectCatalog`、`catalogCanonicalText`、`catalogDigest`、`digestCatalogSource`、`catalogSourcePayload`、`createCatalogMessage`、`planCatalogPublish`、`renderCatalog`、`readCatalogSource`，以及 `CATALOG_DESCRIPTION_MAX_LENGTH`（500）与 `CATALOG_SOURCE_KIND`（`agents-catalog`）。
- 分段投影（票 84）：`buildPromptSegments`、`promptSegmentParts`、`promptShadowLabel`、`PROMPT_SOURCE_ORDER`、`createPromptLedger` 与 `PromptLedger`；宿主产物镜像 `AssembledSection` / `AssembledContext` / `ToolDeclaration` / `HostPromptAssembly` 与账本记录 `PromptSectionLedgerEntry`。**视图 DTO 不在这里**：`PromptSegmentsView` / `PromptSegment` / `PromptSourceId` 等定义在 `src/contract/prompt-preview.ts`，本层只 re-export（见下「跨层接缝」）。

## 依赖方向

矩阵只允许本层读 `src/contract/index.ts`；node 列表为空，cordis 为 false，也不允许 yaml / catalog / control / dsh。消费方向全部是入向：

- dsh/host 的 `src/dsh/host/assembly.ts` 用 `createAssemblyService` provide `agentAssembly`，把每次挂载登记成宿主 effect。
- dsh/host 的 `src/dsh/host/catalog.ts` 用 catalog 投影、摘要门与消息渲染实现 pre-step 监听器，并注入 SHA-256。
- control 的 snapshot 通过注入的 `resolveAssembly` 读 `projectAssemblies`，把 `assemblies` 作为数据交给 UI；UI 不自行规划。
- dsh/client 的顾问面板只渲染 snapshot 的规划结果，不重新推导通道 / 断点 / lint。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/assembly/planner.ts` | `planAssembly`。行集固定，仅 per-model system 行按 `sysPrompt` 是否缺席条件出现；行序按推荐缓存层级（per-model system → tools → persona → skills → digest → first message → pre-step）。只有 system 行带宿主落点顺序；其余通道是 06/07 或 DSH 的锚点。 |
| `src/assembly/sink.ts` | `createAssemblyService`。按 scope 挂载，同一 scope 的第二次挂载先 dispose 旧挂载再整组注册；并发挂载串行化，慢的早期调用不能覆盖后来的；`onMount` 交给宿主 `ctx.effect`，`dispose()` 幂等。 |
| `src/assembly/catalog.ts` | `projectCatalog` 产出按 registry 顺序的 agent / alias 行；描述折空白并截到 500；`catalogDigest` 对 canonical JSON 元组取注入 hash，registry 不变则字节相同，变化恰产出一条替换消息。alias 目标不进 digest。 |
| `src/assembly/segments.ts` | `buildPromptSegments(assembly, ledger)`：宿主装配产物 + 注册侧账本 → 按 7 条来源分组的纯投影。固定组序、组内按宿主装配名 code-unit 升序、诊断按 (code, name) 升序；同一输入两次求值逐字节相同。认不出来源的段进 `unattributed`，不猜。另有两个纯函数：`promptSegmentParts`（多块才可展开，单块或没记都整段给出，内容不丢）与 `promptShadowLabel`（`opaque` 如实说「遮蔽关系不可见」）。 |
| `src/assembly/ledger.ts` | `createPromptLedger`：按 scope 分桶的注册侧账本（`WeakMap` 语义，scope 注销记录即消失）。只记**真进了宿主注册表**的节（`executable: false` 的规划行不记），也不记 waterfall 改写 / 遮蔽 / 配置文件——注册时还不知道，缺席就是缺席。 |

## 跨层接缝（票 84）

投影函数在本层，视图 DTO 在 `src/contract/prompt-preview.ts`。原因是矩阵事实：chunk 只准读 `control` 与 `chunk-contracts`（`scripts/checklist/matrix.mjs` 的 `CHUNK_ENTRIES`），而 `chunk-contracts` 所在层只准读 contract / control / client。视图类型若定义在本层，它的消费者（registry chunk）根本读不到——形状会够不着自己的类型。

- 本层 `src/assembly/index.ts` re-export 视图 DTO，读者在本层仍找得到投影的输出形状；**定义只有契约层一份**。
- `src/dsh/client/chunk-contracts.ts` 从 contract 做 type-only re-export，是 chunk 的唯一入口；不搬运任何运行期代码（`buildPromptSegments` 留在本层）。
- 宿主结构镜像（`HostPromptAssembly` 等）留在本层且带 `Host` 前缀：镜像是入参形状，不是契约。
- 守卫：`test/prompt-preview-seam.test.ts` 钉住「定义唯一」「镜像不带 Host 前缀以外的不撞名」「接缝 type-only」三条。

## 测试 seam

- `test/agent-assembly.test.ts`：planner 的固定行集、放置顺序、`sectionOrder` 覆盖、断点；sink 的 compat 注册、同 scope 替换与 dispose。
- `test/prompt-preview-segments/`：票 84 的三片——`segments.test.ts`（来源分组与四种标注）、`ledger.test.ts`（账本记录范围与 sink 接线）、`purity.test.ts`（无 React / 无 IO / 不改输入 / 命名与 GLOSSARY 一致）。
- `test/prompt-preview-seam.test.ts`：视图 DTO 的跨层接缝（定义唯一、镜像不撞名、chunk 可达且 type-only）。
- `test/control-assemblies.test.ts`：`ControlSnapshot.assemblies` 的投影口径——没有装配服务时为空，不伪造计划。
- 宿主侧端到端（dsh/host 的装配行与 pre-step）不在本层单测里复制，由 `test/host-system-prompt.test.ts` 与 `test/host-wiring.test.ts` 的宿主侧用例承担。

## 不做的事

- 不做宿主注册：本层不 import Cordis、不碰 `ctx`，只返回 / 接受描述对象。
- 不做 I/O、不读文件、不扫 registry：会话与 registry 的输入都由调用方注入。
- 不做 hash 与时钟：digest 的 SHA-256、消息 id、时间都由宿主适配器提供。
- 不做模式开关或能力探测：replacement 模式通过 wide subtype 换实现，本层不加 `mode` 字段、不做 probe（ADR-0006）。
- 不创建 Agent、不启动会话、不写文件。

## 收口边界

- 旧 agent-assembly 源码目录已更名为 `src/assembly/`；矩阵、dsh/host、测试 import 与文档锚点同步更新，不保留兼容转发层。包级 `./assembly` exports 仍指向既有 dsh/host 行，没有变化。
- planner 的固定行集、缓存断点与顺序 lint 以 `src/assembly/planner.ts` 为实现真相；只有 planner 标记为可执行的 system 节由 compat sink 注册，通道锚点不被执行。
- catalog 描述上限保持 500，alias 目标继续排除在 digest 之外；这些是当前行为契约，不是待实现事项。
- replacement 模式与未来通道执行仍由各自票据裁决，不在包抽象 3 顺带实现。
