# DSH 连接器域

状态：**骨架：2026-11-12 建立，包抽象 2/3 收口时写实**。本域是 bundle 与 DeepSeek Harness 的唯一接触面：宿主翼是插件行与 wire，浏览器翼是 slots 注册与 chunk-loader。目标口径见 ADR-0008：dsh 只做连接器，泛 UI 拆到 client 包，归包抽象 2。

## 职责

宿主翼负责把领域服务挂到 Cordis 上下文、注册 HTTP 路由、把 DSH 事件折成纯域输入；浏览器翼负责把面板注册进 `ctx.slots` 并懒加载本包 chunk。两翼不共享实现，只共享 contract 的 DTO（wire 是它的投影）。

边界事实：宿主服务与事件形状在 `src/dsh/host/` 里用本地结构化镜像读取，不 vendor / 不运行期 import 宿主包；wire 只校验信封并调用 control core，不实现域规则。dsh 是唯一允许 `@deepseek-ai/cordis` 的包，当前矩阵仍只许 type-only（运行期 Service 基类归 ADR-0004 的 P2）。

## 公共入口

- 宿主入口 `src/dsh/host/index.ts`：插件行 `apply` / `applyCore` / `applyProviders` / `applyAssembly` / `applySummon` / `applyUiHost`，失败台账 `mountFailureLedger`、wire 的 `CONTROL_BASE_PATH` / `CONTROL_ROUTE_PATHS` / `dispatchControlRequest` / `MAX_BODY_BYTES` / `MAX_EDITS`、`handleControlRequest`、`optionalFileSystem`，以及 provider rank 常量与 `BUNDLED_AGENTS_DIR`。
- 浏览器入口 `src/dsh/client/index.ts`：`apply`、`inject`、`AgentControlPage`、`AgentControlIcon`；连接面是 `ctx.slots` 的两个座。chunk 合约与加载器分别是 `src/dsh/client/chunk-contracts.ts` 与 `src/dsh/client/chunk-loader.ts`。
- 包级入口：`src/index.ts` 是兼容 all-in-one 入口；`package.json` 的 `./core`、`./assembly`、`./providers/fs` 子路径挂载 granular 行，根行以 `config.role: 'ui-host'` 只装路由（根名必须可被 client 扫描器看到）。

## 依赖方向

矩阵：

- `src/dsh/host/` entries：`src/contract/index.ts`、`src/yaml/index.ts`、`src/catalog/index.ts`、`src/catalog/ports.ts`、`src/resolve/index.ts`、`src/providers/index.ts`、`src/providers/fs/index.ts`、`src/agent-assembly/index.ts`、`src/control/index.ts`；node 全允许；cordis 只 type-only。
- `src/dsh/client/` entries：`src/contract/index.ts`、`src/catalog/ports.ts`、`src/control/index.ts`、`src/control/client-errors.ts`、`src/control/http-client.ts`；node 为空；cordis false；`react` 作为平台注入 external。

宿主只经领域入口读实现，不深路径取；浏览器翼不能读 host、不能用 node，也不能共享宿主实现。目标布局下 dsh/client 只剩 slots / chunk-loader / 宿主服务读取，泛 UI 进 client 包。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/dsh/host/plugin.ts` | `apply`、`AgentManagerPluginConfig`。`role: 'all'` 依序挂 core / assembly / summon / providers；`role: 'ui-host'` 只挂控制路由；all-in-one 把 core 刚造的 `providers` 实例直接交给 provider 半，避开同 tick `ctx.get` 不可见。 |
| `src/dsh/host/core.ts` | `applyCore`。provide `agentProviders`（plain object）、`agentRegistry` / `aliasRegistry` 与 `agentControl`；安装 pre-step catalog 监听器；`resolveFileSystem` 每次用时读 `optionalFileSystem(ctx)`，不捕获早期服务。 |
| `src/dsh/host/providers.ts` | `applyProviders`。注册四个根 + bundled 根；rank 由 contract 的 `AGENT_SOURCE_RANK` 派生：`PROJECT_DSH_RANK` 100 / `PROJECT_AGENTS_RANK` 200 / `CUSTOM_RANK` 300（v1 未用，200 与 400 之间的保留槽）/ `USER_DSH_RANK` 400 / `USER_AGENTS_RANK` 500 / `BUNDLED_AGENT_RANK` 600；根在本行解析，provider 不读环境。 |
| `src/dsh/host/assembly.ts` | `applyAssembly`。把 `createAssemblyService` 的挂载登记为 `ctx.effect`，provide `agentAssembly`；`./assembly` 子路径与 `apply` 同义。 |
| `src/dsh/host/summon.ts` | `applySummon`、`SUMMON_TOOL_NAME = 'summon_agent'`、`DEFAULT_NATIVE_SUBAGENT_TOOLS`。模型侧 summon 工具 + `agent/created` 子上下文装配钩子；用 `tools.restrict()` 隐藏原生委托入口；挂失败台账。 |
| `src/dsh/host/failures.ts` | `mountFailureLedger`。腿 A（`agent/request-error`）先 `await next()` 再记录，返回原 action；腿 B（`llm/stream`）只记 attempt 级。路由从 `session.requestContext()` 读，绝不从下一次选择反推。 |
| `src/dsh/host/catalog.ts` | `installAgentCatalog`。pre-step waterfall 监听器；structurally 读 registry 与宿主能力面，注入 SHA-256 / 消息 id，失败探测只降级为 warning，不阻断 turn。 |
| `src/dsh/host/ui-host.ts` | `applyUiHost`、`handleControlRequest`。在 `ctx.webServer` 注册一组 exact 路由；补 origin / host fence、请求大小上限、response-close → AbortController；缺服务时 warning 且不挂路由。 |
| `src/dsh/host/wire.ts` | `dispatchControlRequest`、`CONTROL_BASE_PATH = '/agent-atelier'`、`CONTROL_ROUTE_PATHS`。固定路由（state / compose / chain / plan / commit / registry / invalidate）；mutation 要 JSON content-type + `x-dsh-agent-atelier: 1`；cwd 缺失/坏值退用户全局，非字符串才是 400。 |
| `src/dsh/host/fs.ts` | `optionalFileSystem`：没有宿主 `fs` 服务时返回 `undefined`，发现回退 Node。 |
| `src/dsh/client/index.ts` | `apply` / `inject`。两个 slots 注册（`sidebar.panellist` 行 + `main` 面板）；页面单 HTTP client 实例与快照状态机。 |
| `src/dsh/client/chunk-loader.ts` | 三个 `load*Chunk`：构建态由 `scripts/build-client.mjs` 换成 `require.async`；源码体只给类型与构建形状，未构建即抛。 |

## 测试 seam

- `test/host-*.test.ts`：`host-failures`（07b 在真实 host 上的两条腿）、`host-llm-events`（07a 探针，失败台账的可观测量在此覆盖；仓内没有名为 observability 的测试文件）、`host-summon`（AgentLoop + subagent）、`host-system-prompt`（prompt registry + assembly sink）、`host-tools`（tool registry + summon 行）。
- `test/host-wiring.test.ts`：wire dispatcher 的校验 / 状态映射与 cwd 作用域回退；证明 HTTP 入口不另造域规则。
- `test/failures-wiring.test.ts`：两条腿的 delegating / attempt-only 与卸载生命周期。
- 领域行为（compose / plan / commit / chain）由 `test/control-*.test.ts` 覆盖，本页不复制。

## 不做的事

- 宿主不解析 frontmatter、不判层、不重算链：这些由 catalog / resolve / control 的公共入口完成。
- wire 不实现编辑语义：它只校验信封、调 `ControlClient` / control core 的公共面并序列化结果。
- 宿主包不运行期 import：DSH 的服务 / 事件形状用本地结构化镜像；`@deepseek-ai/cordis` 目前只 type-only。
- 浏览器翼不 import host、不碰 `node:*`、不共享宿主实现；两翼只共享 contract DTO。
- 迁移完成后 dsh 不再承载泛 UI 组件：那是 client 包的职责（包抽象 2）；当前泛 UI 仍在 dsh/client，属于待收口债务。

## 待收口项

- TODO（包抽象 2）：把泛 UI 从 `src/dsh/client/` 拆到 client 包，dsh/client 只留 slots 注册、chunk-loader 与宿主服务读取面；迁移后重指本页路径与矩阵 entries。
- TODO（包抽象 2）：三个根 chunk 目录（`client-editor/`、`client-list/`、`client-registry/`）是否随迁移收进 client 包，按 ADR-0008 与构建脚本裁决；构建根变化要同步 `scripts/build-chunks.mjs` 与 `test/client-build.test.ts`。
- TODO（包抽象 3 / ADR-0004）：Cordis 运行期 Service 基类仍属 P2；矩阵现在只放行 type-only，落地时要同时改矩阵、self-test 与 `package.json` peer 面。
- TODO（docs 收口）：本页状态转「落定」，与包抽象 2 的验收和 docs 全量刷新同批。
