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

## 测试 seam

- `test/assembly.test.ts`：planner 的固定行集、放置顺序、`sectionOrder` 覆盖、断点；sink 的 compat 注册、同 scope 替换与 dispose。
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
