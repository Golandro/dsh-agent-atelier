# Client 界面翼

状态：**骨架：2026-11-12 建立，包抽象 2/3 收口时写实**。现状：面板壳、页面与三个 chunk 的加载 / 挂载器都在 `src/dsh/client/`，chunk 源码在仓库根的 `client-editor/`、`client-list/`、`client-registry/`。目标布局是 ADR-0008 的 client 包（ui-core / ui-react / features / chunks），迁移归包抽象 2；本页不把尚不存在的目标目录写成路径锚点。

## 职责

浏览器界面翼，负责「智能体工坊」面板：注册侧栏行与 `main` 面板、持有唯一 HTTP control client、展示快照四页签（智能体 / 模型关联 / 系统提示词 / 操作历史）、懒加载编辑器与列表 / registry chunk、把草稿走 `/plan` → `/commit` 的写管线，并维护工作空间范围与操作历史。

边界事实：界面翼只消费 control 的线形契约与纯数据；它不实现 compose / resolve / 查询求值，也不访问 `node:*` 或宿主包。chunk 是自包含浏览器产物，唯一外部依赖是平台注入的 React（编辑器 chunk 甚至不依赖 React）。

## 公共入口

- 面板入口 `src/dsh/client/index.ts`：导出 `apply`、`inject`（`['slots']`）、`AgentControlPage`、`AgentControlIcon` 与 `ClientContext` 类型（`ClientSlots` 是入口内部形状）。`apply` 经 `ctx.slots.inject` 占 `sidebar.panellist` 行（id `agent-atelier`，order 5）与同 id 的 `main` 面板；页面持有一个 `createHttpControlClient()` 实例，壳只跑 loading / error / retry 状态机。
- 跨翼共享形状 `src/dsh/client/chunk-contracts.ts`：`ChunkSpecifier`、`EditorChunk` / `ListChunk` / `RegistryChunk`、`PanelFocus` 等。这是主 bundle 与三个 chunk 的唯一共享面；chunk 不反向 import 主 bundle。
- chunk 加载缝 `src/dsh/client/chunk-loader.ts`：`loadEditorChunk` / `loadListChunk` / `loadRegistryChunk`。源码体在构建态由 `scripts/build-client.mjs` 换成 `require.async` 转发；未构建时抛「只在成品 bundle 可用」。
- 三个发布 chunk：`client-editor/index.ts`（`createDocumentEditor`，CodeMirror，无 React）、`client-list/index.tsx`（`AgentListView`，TanStack + `evaluateAgentQuery`）、`client-registry/index.tsx`（`ModelRegistryView` / `PromptRegistryView`）。

## 依赖方向

矩阵给 `src/dsh/client/` 的 entries：`src/contract/index.ts`、`src/catalog/ports.ts`、`src/control/index.ts`、`src/control/client-errors.ts`、`src/control/http-client.ts`；node 为空，cordis 为 false；`react` 是平台注入的 external，不得打包宿主包。三个 chunk 根只准读 `src/control/index.ts` 与 `src/dsh/client/chunk-contracts.ts`，第三方库随 chunk 自带 vendor，但 `@deepseek-ai/*` 与 `node:*` 不许进入。

消费方向：面板读 control 的公共类型、`client-errors` 与 HTTP 子入口；宿主的 slots / 工作区 / 会话服务按形状读取（`observableOf`），不 import 宿主包。目标布局下 dsh/client 只保留 slots / chunk-loader / 宿主服务读取，泛 UI 进 client 包；两翼只共享 contract 的 DTO。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/dsh/client/index.ts` | `apply`、`AgentControlPage`、`AgentControlIcon`、`ClientContext`、`inject`。两个座同 id；页面单 client 实例；`createScopeSource` 惰性解 `workspaces` / `sessions`，存储不可用就不记住范围。 |
| `src/dsh/client/page.tsx` | `AgentsWorkspace`。双栏 / 单栏由 CSS `@container pane` 决定；四个视图保持挂载；drafts 按「工作空间 + agent」分桶；保存统一走 plan 预览再 commit，成功后重新 compose 并清已提交草稿。 |
| `src/dsh/client/editor-mount.tsx`、`src/dsh/client/registry-mount.tsx` | 懒加载 chunk 的 React 包装：loading / 失败 `role=alert` / 重试；chunk 只收纯数据与回调，不收 client / service 对象；样式仍由主 bundle 注入。 |
| `src/dsh/client/workspace-scope.ts`、`src/dsh/client/use-workspace-list.ts` | 范围推导优先级：记住的显式选择 → 当前会话 cwd → 最近活跃工作区 → 用户全局；空值 / 坏值 / 服务缺失一律退化，不抛。 |
| `src/dsh/client/panel-header.tsx`、`src/dsh/client/panel-types.ts`、`src/dsh/client/panel-focus.ts` | 四页签、页签键盘契约、跨页聚焦路由；头部只画页面算好的范围，不读服务。 |
| `src/dsh/client/advisor.tsx`、`src/dsh/client/operation-history.tsx` | 顾问面板只渲染 snapshot 的 findings / assemblies；操作历史只呈现真实 commit 报告与待写 plan 预览。 |
| `src/dsh/client/pane.tsx`、`src/dsh/client/class-names.ts`、`src/dsh/client/observable.ts` | 拖拽夹取、插件命名空间类、宿主可订阅快照的形状读取；均无 node / 宿主 import。 |
| `src/dsh/client/registry-writes.ts` | 唯一客户端 registry 写通道：逐条 `applyRegistryEdit`，把 host report / wire failure 折成 UI 行，成功批次后只做一次 read-back，不自行调 `/invalidate`。 |

## 测试 seam

- `test/client-build.test.ts`：主 bundle 轻壳与三个 chunk 的构建产物、外部依赖、chunk 自包含边界。
- `test/panel-focus.test.ts`、`test/panel-header.test.ts`、`test/panel-shell.test.ts`：页签键盘、头部三态、跨页聚焦与四页签挂载。
- `test/advisor-panel.test.ts`：顾问面板只消费规划输出。
- `test/registry-chunk.test.ts`：registry chunk 视图与挂载器的加载 / 失败 / 重试。
- 写路径的行为由 `test/control-client.test.ts` 与 `test/host-wiring.test.ts` 在契约层覆盖，界面测试不复制协议。

## 不做的事

- 不 import `node:*`、不执行磁盘 I/O、不读环境变量：浏览器翼只能经 HTTP 入口读写。
- 不 import 宿主包 `@deepseek-ai/*`，也不从 `src/dsh/host/` 深路径取实现；宿主服务只按形状读。
- 不在视图里重算列表查询、模型链或装配计划；这些分别归 `evaluateAgentQuery`、control 的链引擎与装配域。
- chunk 不 import 主 bundle 或另一个发布 chunk；样式元素只由主 bundle 注入，chunk 不建 style。
- 当前不做 UI 状态持久化（除工作空间选择的 sessionStorage 记忆）。

## 待收口项

- TODO（包抽象 2）：把泛 UI 迁到目标 client 包：ui-core（纯逻辑 / 类型）、ui-react（React 组件）、features（页面能力）、chunks（三个 chunk 源码）；dsh/client 只留 slots 注册、chunk-loader 与宿主服务读取。目录与入口落地后，本页所有「现状」路径与矩阵 entries 要同批改。
- TODO（包抽象 2）：目标 client 包入口在 ADR-0008 记为 src/client/index.ts（尚不存在）；迁移时先改 `scripts/checklist/matrix.mjs` 与 self-test，再落目录与入口，禁止深路径兼容。
- TODO（包抽象 2/3）：复核 `src/dsh/client/registry-writes.ts` 与 registry chunk 的写通道归属——它是否属于 features 的写能力，还是留在 dsh/client 的宿主适配，票面裁决后写实。
- TODO（docs 收口）：本页状态转「落定」，与 ADR-0008 的 client 布局和包抽象 2 的验收同批。
