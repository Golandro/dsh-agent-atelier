# 13 — 前端测试：接口级用例、编辑器视图模型与组件测试

Status: ready-for-agent
Type: task
Blocked by: 11（适配器契约套件那一节待 12）

## 背景

原型零测试，且**不在 `tsconfig.json` 的 include**（`"include": ["src", "test"]`）——所以原型的类型漂移连编译期都不可见（子代理分析结论：`ModelLinks.tsx` 行 501、510 的 `'builtin' in ModelDef` 恒为 false 这类 bug 就是这么活下来的）。主线 UI 必须按「**接口即测试面**」补测试；测试写在主线 `test/`，纳入 `pnpm run check`。

原则（`codebase-design`）：测试断言**可观察结果**、穿过模块接口；不测实现细节；内部 seam 允许自带测试，但不得为测试把它们暴露到接口。

## 测试面

1. **核心接口级**（内存适配器，11 票）：`snapshot` / `compose` / `plan` / `commit` / `applyRegistryEdit` / `invalidate` —— 写入计划、原子落盘结果、冲突与拒绝原因。
2. **编辑器视图模型（纯）**：整篇文本编辑 → 哪些块变了 → 哪些文件要写；行号口径、折叠合并、dirty 判定；满/缺片与悬空引用。
3. **列表查询求值器（纯）**：筛选/排序/搜索字段、排序键与方向；断言它被 TanStack 配置与测试**共用**（防止再现「深模块存在但组件内联重写」）。
4. **registry 视图（纯）**：层关系（遮蔽/覆盖/被覆盖）、合并空间、问题谓词、可达 agent、稳定键。
5. **分栏几何（纯）**：阈值、宽度夹取、overlay 判定（含顾问抽屉排除）。
6. **组件测试**（jsdom ＋ `@testing-library/react` ＋ `@testing-library/user-event`）：只断言渲染结果与用户可见行为。
7. **适配器契约套件**：同一套用例跑**内存适配器**与**HTTP 假适配器**（两个适配器 ⇒ 真 seam；一套规格两份实现，防止 wire 形状漂移）。

## 禁止

- 断言组件内部 state / ref / 私有函数；纯快照测试；绕过接口去测实现（internal seam 例外：模块自带测试）。
- 把原型分支的测试搬进主线（原型 throwaway，测试必须针对 11/12 的接口重新写）。

## 必测行为清单（逐条要有用例）

- 分块保存：只写脏块涉及的文件；回退不动磁盘；一次保存跨多文件时逐文件结果正确。
- 缺片引用：不产生写入，且**不把展示串当文件名**（原型 bug：`model.ts` 行 274 把 `（未找到切片 X）` 写进 `DocBlock.file`）。
- 模板行语法单一来源：引用统计与组合用同一解析器（原型三份、字符集不同：只认 `[a-z0-9-]` 的正则 vs 转义任意名的 `referencedBy`）。
- 分隔行规则单一来源；行号口径只有一套（原型三套，尾换行 ±1）。
- 层遮蔽与合并：工作区胜用户；被遮蔽层在 UI 有标注；**UI 不重算层**（宿主已解析）。
- `available: false` 的跳过与回退（语义归 03）：断言「UI 显示的解析结果」来自引擎，而不是组件自己猜；原型三处断言无实现支撑即为反例。
- registry 编辑：`add` 的默认目标选择（首个可用条目）、`delete` 的回退接管、`dsh-default` 只读（含内置**模型**条目的只读——原型在此处有 `'builtin'` 窄化 bug）。
- findings 三族归并：`AgentDiagnostic` ＋ `AliasFinding` ＋ 05 的警告项，带 `origin` 判别；只警告不阻挡（门禁不做）。
- 断点推演：切 Agent 与切模型两套高亮按 §6 静态表移动。
- 未保存改动切换 agent：行为明确（原型丢草稿只写日志）且有断言。
- 空列表时选中如何处置：两页语义统一（原型 App 清空 vs ClipLibrary 保留）。
- overlay 阈值与宽度夹取；窄屏默认先看列表。
- `plan` 预览与实际 `commit` 结果一致（同输入下写入的文件集合相同）。

## 环境与基座

- Vitest 已在（`pnpm test`）；`vite` ＋ `@vitejs/plugin-react` 已在 devDependencies。
- **需补**：`jsdom`（或 `happy-dom`）＋ `@testing-library/react` ＋ `@testing-library/user-event`（沙箱内不装，见 `docs/agents/harness-facts.md`；组件测试按文件声明 environment，纯函数用例保持 node 环境以免整体变慢）。
- CodeMirror 侧：`@codemirror/state` 本身 DOM-free；把 StateField 构造的 React ref 依赖改成普通参数后，编辑器投影逻辑可 headless 测（原型证据：`DocumentEditor.tsx` 行 452–453）——组件测试只覆盖「渲染 + 交互 → 回调」，不重测编辑器内部。
- 若 11 票把纯逻辑放进 `src/`，它们自动进 `pnpm run typecheck`（`tsconfig.json` 的 include 已含 `src`）；组件测试文件放 `test/`，同样受 typecheck 保护。

## 验收

- [ ] 上述清单逐条有用例；`pnpm run check` 全绿（含 `hostRuntimeDeps`/锚点/devDeps 各判定）
- [ ] 适配器契约套件对内存与 HTTP 假适配器都跑，且**同一文件**（一套规格）
- [ ] 纯函数层用例在 node 环境跑；组件用例在 jsdom 跑；测试总时长不显著拖慢守卫
- [ ] 无用例断言组件内部 state；无用例依赖原型分支
- [ ] 删除的原型重复实现（如 `queryAgents` 死代码被接上后）有回归用例守住「只有一份」

## 已知约束

- 依赖安装是敏感操作，由维护者在沙箱外完成；本票不自行 `pnpm add`。
- 测试不得要求真实 DSH profile：宿主侧用内存适配器 ＋ 假 fs 端口（01/02 的既有测试同构）。
- 若 03 未落地，「available 跳过 / 回退」暂时只能测「UI 消费引擎结果」的契约，不能测语义本身——在该节的用例里显式标注依赖 03。

## Comments

- 来源：`/codebase-design` 分析（2026-10-17，AI ＋ 两个只读子代理）；11 票接口、12 票 wire 契约。
- 参考实现：分支 `proto/settings-ui`（throwaway，零测试、不在 typecheck 内）——本票不回填原型。
