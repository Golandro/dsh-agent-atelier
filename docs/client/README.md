# Client 界面翼

状态：**2026-11-14 落定（包抽象 2）**。泛 UI 按 ui-core / ui-react / features 分层，三个发布 chunk 的源码归 chunks；DSH 侧只保留 slots、chunk 契约 / 加载与宿主服务读取。

## 职责

浏览器界面翼负责「智能体工坊」面板：持有唯一 HTTP control client、展示快照四页签（智能体 / 模型关联 / 系统提示词 / 操作历史）、懒加载编辑器与列表 / registry chunk、把草稿走 `/plan` → `/commit` 的写管线，并维护工作空间范围与操作历史。

界面翼只消费 control 的线形契约与纯数据；不实现 compose / resolve / 查询求值，不访问 `node:*` 或宿主包。chunk 是自包含浏览器产物，列表与 registry 的唯一平台 external 是 React，编辑器 chunk 不依赖 React。

## 目录与公共入口

- `src/client/ui-core/`：纯逻辑、类型与写管线，包括首帧范围推导、页签 / 聚焦模型、registry 写通道与命名空间类。
- `src/client/ui-react/`：React 绑定与可复用组件，包括侧栏图标、abortable-load、chunk 挂载器、页头、工作区选择与拖拽分栏。
- `src/client/features/`：面板壳、工作区页面、顾问与操作历史，以及页面样式。
- `src/client/chunks/`：editor / list / registry 三份发布 chunk 源码；registry chunk 内两个页（`model-links*` 模型关联、`prompts.tsx` + `prompt-model.ts` 系统提示词）共用同一份 chunk 私有件——`prompts.tsx` 复用 `model-detail.tsx` 的写反馈与 `model-links.ts` 的来源词表，页间共享只发生在 chunk 内部，跨 chunk 仍然互不引用。
- `src/client/index.ts`：client 包公共入口，导出 `AgentControlPage`、`AgentControlIcon`、页面 props 与范围类型；DSH slots 适配只消费这一份。
- `src/dsh/client/index.ts`：导出 `apply`、`inject` 与 `ClientContext`，注册 `sidebar.panellist` 行和同 id 的 `main` 面板；为保持既有入口面，re-export 页面组件与 props 类型。
- `src/dsh/client/agent-control-scope.ts`：把 slots 上下文里的 workspaces / sessions / storage 折成 client 的 `ScopeSource`，是宿主服务读取适配。
- `src/dsh/client/chunk-contracts.ts`：`EditorChunk` / `ListChunk` / `RegistryChunk`、`PanelFocus` 等跨 bundle 形状；外加系统提示词预览的视图 DTO 与渲染信封 type-only re-export（定义在 `src/contract/prompt-preview.ts` 与 `prompt-preview-route.ts`，投影函数留在 `src/assembly/`）。
- `src/dsh/client/chunk-loader.ts`：`loadEditorChunk` / `loadListChunk` / `loadRegistryChunk`；构建时由 `scripts/build-client.mjs` 换成 `require.async` 转发。
- `src/dsh/client/observable.ts`：宿主可订阅服务的形状读取，不 import 宿主包。

三个发布入口分别是 `src/client/chunks/editor/index.ts`（`createDocumentEditor`）、`src/client/chunks/list/index.tsx`（`AgentListView`）与 `src/client/chunks/registry/index.tsx`（`ModelRegistryView` / `PromptRegistryView`）。产物名仍由 `scripts/build-chunks.mjs` 固定为 `client.editor.js` / `client.list.js` / `client.registry.js`。

## 依赖方向

client 层只准跨包读取 contract、control 公共入口及 `client-errors` / `http-client` 子入口，加上 dsh/client 的 `chunk-contracts` / `chunk-loader` / `observable` 三个窄入口。node 与 cordis 均为空；第三方库只进入浏览器产物，`@deepseek-ai/*` 仍禁止。

dsh/client 只额外读 contract、control 与 `src/client/index.ts`，不得走 client 深路径。矩阵扫描根已收敛为 `src/`，三个 chunk 作为 client 子层各自封口：只读 control 与 `chunk-contracts`，不能回流主壳或互相引用；构建测试再从产物侧钉住互不依赖。

预览视图类型能到 chunk 手里，靠的是「形状放 contract」而不是放宽围栏：chunk 读不到 `src/assembly/`，`chunk-contracts` 也读不到，所以 DTO 定义在 `src/contract/prompt-preview.ts`，由 `chunk-contracts` 做 type-only re-export。投影函数仍在 assembly，运行期代码不过界（`test/prompt-preview-seam.test.ts` 守着）。

预览的**投影发生在宿主侧**：`/prompt-preview` 拿到 `assembly` + 账本后立刻调 `buildPromptSegments`，随回答送出 `segments`。降级档（②③④）没有装配产物，给的是空骨架（7 条来源、组内无段）；它不表示「装配了但没贡献」，那个区别只由 `degraded` 的在场表达，UI 在降级档不摆来源组。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/client/features/agent-control-page.tsx` | `AgentControlPage`。页面单 client 实例；壳只跑 loading / error / retry；首帧范围由 ui-core 推导。 |
| `src/client/ui-react/agent-control-icon.tsx`、`src/client/ui-core/scope-bootstrap.ts` | 纯侧栏图标，以及首帧范围推导 / 失效记忆提示；均不读取宿主实现。 |
| `src/dsh/client/agent-control-scope.ts` | `createAgentControlScope`：惰性读取 workspaces / sessions，存储不可用就不记住范围。 |
| `src/client/features/page.tsx` | `AgentsWorkspace`。四个视图保持挂载；drafts 按「工作空间 + agent」分桶；保存统一走 plan 预览再 commit。 |
| `src/client/ui-react/abortable-load.ts` | `createAbortableLoad` 与 `useAbortableLoad`；列表、编辑器、registry 与壳快照共用同一状态机。 |
| `src/client/ui-react/editor-mount.tsx`、`src/client/ui-react/registry-mount.tsx` | chunk 的 React 包装；chunk 只收纯数据与回调，不收 client / service 对象。 |
| `src/client/ui-core/workspace-scope.ts`、`src/client/ui-react/use-workspace-list.ts` | 范围优先级：记住的选择 → 当前会话 cwd → 最近活跃工作区 → 用户全局；缺失或坏值退化，不抛。 |
| `src/client/ui-react/panel-header.tsx`、`src/client/ui-core/panel-types.ts`、`src/client/ui-core/panel-focus.ts` | 四页签、页签键盘契约与跨页聚焦路由。 |
| `src/client/features/advisor.tsx`、`src/client/features/operation-history.tsx` | 顾问只渲染 snapshot 的 findings / assemblies；历史只呈现真实 commit 报告与 plan 预览。 |
| `src/client/ui-react/pane.tsx`、`src/client/ui-core/class-names.ts` | 拖拽夹取与插件命名空间类。 |
| `src/client/ui-core/registry-writes.ts` | 无 React / host 的纯写管线：逐条 `applyRegistryEdit`，折叠报告与 wire failure，成功批次后一次 read-back。 |
| `src/client/chunks/registry/prompt-model.ts`、`prompts.tsx` | 系统提示词页：每模型名一张生效声明卡片（只读合并快照，不重跑层合并）、草稿按「范围 + 模型名」分桶 / 脏标记 / `setSysPrompt`（空串 = 移除字段）、写反馈页面级一次、跨页落点滚动 + 高亮（定时器只在卸载时清理）。 |

registry 层轴保留本地 `SOURCE_RANK` 视图常量；`test/registry-model.test.ts` 同时断言 snapshot 层表与显式期望顺序（project → user → built-in）/ 实际排序一致，不为排序改变查询求值器签名。

## 测试 seam

- `test/client-build.test.ts`：主 bundle 轻壳与三个 chunk 的产物形状、外部依赖和自包含边界。
- `test/panel-focus.test.ts`、`test/panel-header.test.ts`、`test/panel-shell.test.ts`：页签、页头、聚焦与壳行为。
- `test/advisor-panel.test.ts`、`test/registry-chunk.test.ts`、`test/abortable-load.test.ts`：顾问、chunk 挂载与共享状态机。
- `test/registry-prompts-page.test.ts`：系统提示词页的生效声明卡片、草稿分桶与脏标记、`setSysPrompt`、回读失败保留草稿、写反馈只出现一次，以及高亮的 effect 结构（TS AST 断言，含 CSS 断点与常量同源断言）。
- 写路径由 `test/control-client.test.ts` 与 `test/host-wiring.test.ts` 覆盖协议，界面测试不复制协议。

## 不做的事

- 不 import `node:*`、不执行磁盘 I/O、不读环境变量。
- 不 import `@deepseek-ai/*`，不从 `src/dsh/host/` 取实现。
- 不在视图里重算列表查询、模型链或装配计划。
- chunk 不 import 主 bundle 或另一个发布 chunk；样式只由主 bundle 注入。
- 不做 UI 状态持久化（除工作空间选择的 sessionStorage 记忆）。
