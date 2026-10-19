# 11 — 控制核心与原型收敛（深模块化，后端优先）

Status: ready-for-agent
Type: task
Category: enhancement
Blocked by: —

## 裁决（2026-10-18，维护者）

- **Q1 = B**：v1 只支持标准 Agent 定义文件（单文件 body）；切片/include、`.sections/`、装配源、动态 provider 全部延后。维护者澄清：**prototype 的本意是装配源编辑器，host 长期只读装配源**——这是长期方向；v1 因时机与公开标准不成熟先走标准文件，不是终点。
- **Q5 = A + B**：front-matter 的 raw 文本与字段表单都支持；具体形态在移植 prototype 前端时定；core 以「原文回写」为唯一真相源（一份序列化实现，字段表单编译成原文编辑，不引入第二数据路径）。
- **Q4 = A**（未来转换器）：必填特性 fail-fast、可选特性显式 omit 带理由——记录待 14 票，不进 v1。
- **Q2/Q3 暂不做**：转换器首批目标、中性工具 id 均延后。
- **Q6 = A（2026-10-18 已确认）**：写器归 11、通道归 12；05 范围 3/6 改指针 ＋ `Blocked by: 11, 12`；`MasterDetailPane` 移出本票（归 05/13）。
- 状态：本票已转 `ready-for-agent`，以本票 Comments 的 Agent Brief 为权威规格。

## 背景与来源

`/codebase-design` 分析（2026-10-17，AI／两个只读子代理）＋ 一次原型（分支 `proto/settings-ui`，throwaway）的验证结论。本票是 **05 票的后端优先第一刀**：把原型验证过的行为收敛成宿主侧一个**深模块**（小接口 ＋ 大行为），纠正原型相对冻结契约的数据形状偏差，并补上宿主目前**完全缺失的写面**。12（接线）与 13（前端测试）依赖本票冻结的接口。

参考实现（不进主线）：分支 `proto/settings-ui` 的 `prototype/settings-ui/src/` 下 `App.tsx`、`model.ts`、`types.ts`、`pane-layout.ts`、`components/DocumentEditor.tsx`。

**目标假设**：本票目标是**主线**（`src/`），原型保持 throwaway。若维护者要的是「继续打磨原型本身」，请回退本票并把目标改指 `proto/settings-ui`（下面的深浅判定同样适用，但那时不需要与冻结契约对齐）。

## 宿主现状（动工前必须知道）

- 读面已存在、已冻结：`parseAgentDocument`（`src/core/catalog/frontmatter.ts:99`）、`AgentFrontmatter`（`src/core/catalog/frontmatter.ts:24`）、`readRegistryLayer`（`src/core/catalog/registry-file.ts:106`）、两个服务在 `src/dsh/host/core.ts:24` 的 `applyCore` 里注册（`ctx.agentRegistry` / `ctx.aliasRegistry`；18 票拆行前在 plugin.ts 的 `apply`）。
- **写面完全不存在**：全 `src/` 无 `writeFile` / `rename` / 原子写（grep 为空）。原型的 `serializeFrontmatter` 是唯一的序列化实现，且只认识已知键 ＋ `extra` 原文、无转义、不可往返（D14 要求原文回写）。
- **原型不在 `tsconfig.json` 的 include**（`"include": ["src", "test"]`）⇒ 原型的类型漂移不受 `pnpm run check` 保护，两套同名类型长期共存无人报警。
- 「零运行时依赖」的注释在 `src/core/catalog/frontmatter.ts:6`、`src/core/catalog/yaml-scalar.ts:7`、`src/core/catalog/registry-file.ts:16` 已与 2026-10-17 的依赖裁决（`js-yaml` / `zod` 保留在 `dependencies`，05 票 Q4「我们需要这些依赖」）不一致，但代码仍未引用这两个包 ⇒ 声明按裁决保留，本票要**改三处注释**，并决定写面/校验是用这两个包还是扩展现有 `yaml-scalar.ts`（二选一，只留一份实现）。

## 现状分析（原型实现）

### 深浅判定

| 模块 | 判定 | 证据 |
|---|---|---|
| `App.tsx`（429 行） | **浅**（接口复杂度 ≈ 行为复杂度） | 15 个 `useState`（域数据 4 ＋ 伪磁盘 3 ＋ 日志/布局/UI 8）＋ 25 个处理函数 ＋ 向子组件传 60+ 处 prop；层解析、删除回退、路径推导、默认目标选择、重命名影响等**域规则长在 React 组件里**，脱离 DOM 无法测试 |
| `model.ts`（442 行） | **浅**（是命名空间，不是模块） | 单文件 25+ 导出，混了五条互不相干的轴：层规则／列表查询／切片解析／frontmatter 序列化／组合文档＋编辑器布局／校验／解析链／写计划／重映射／断点文案 |
| `DocumentEditor.tsx`（858 行） | **深**（7 props 背后约 500 行行为） | 但**不变量全在类型之外**：草稿优先、`externalSync` annotation、结构变更要回调重置；且只有 `AgentEditor` 一个调用方 ⇒ 目前是**假想 seam** |
| `pane-layout.ts` | **半深** | 纯阈值数学（overlay 判定、宽度夹取）与 DOM 测量（`ResizeObserver`、`getComputedStyle`、`window.innerWidth` 做 state 初值）焊在同一个 hook 里 |
| `ListPane` / `PaneSplitter` | **正向**（已抽出的共用外壳） | 三个主从页共用同一套外壳，是原型里最接近深模块的部分 |
| `ClipLibrary` / `ModelLinks` / `SystemPrompts` | **浅** | 过滤/分区/层解析在组件内各自实现；`ModelLinks` 单文件 900+ 行承载 registry 管理 |
| `fixtures.ts` | 假适配器，**没有 seam** | 组件直接 import fixtures（`App.tsx` 行 49–53），没有「数据来源」接口可替换 |

### 域逻辑泄漏与重复（原型里的真 bug 面）

1. **模板行语法三份、字符集不同**：`model.ts` 的正则只认 `[a-z0-9-]`（行 198），而 `referencedBy` 转义任意名（行 167–171）⇒ 中文/大写切片名会被「引用统计」命中、却被 compose 当成 prose；`DocumentEditor.tsx` 行 352 又手写了一遍序列化。
2. **分隔行（模板行后恰一个换行）规则三处**：`model.ts` 行 226、231 编码一次，`DocumentEditor.tsx` 行 690 与行 810–824 各自假设同规则 ⇒ 改一处另一处静默错位。
3. **行号口径三套**：编辑器 `lineAt`（1-based）、折叠占位用 `split('\n').length`、`AgentEditor.tsx` 行 59 另算总数 —— 尾换行导致 ±1。
4. **回写分组两个维度等价只是假设**：`saveWrites`（`model.ts` 行 394–409）按 `b.file` 分组并**伪造** `lines`（各块行数相加；真实落盘按 `'\n'` 拼接应为 sum−(n−1)）；`App.tsx` 行 135–149 实际落写按 `block.kind` 路由。
5. **缺片占位串被当文件名**：`model.ts` 行 274 把展示串 `（未找到切片 X）` 写进 `DocBlock.file`，`saveWrites` 与 Inspector 的 `savedFiles` 拿它当文件键。
6. **脏口径三份**：编辑器（`slice !== saved`）／App（`texts[id] !== block.text`）／`AgentEditor`（`Object.keys(drafts).length`）。
7. **四套影子类型**：`DocBlock` → `LiveBlock`（`DocumentEditor.tsx` 行 117–134）等，`saved` 复制 `text`。
8. **副作用不可测**：处理函数里直接 `window.prompt` / `window.confirm`；`seq++` 是模块级可变全局（生成 id 不可复现）。
9. **层规则散落**：`resolveAlias` / `resolveModel` 在 App 的每个 handler 里被反复调用（删除回退、available 定位、重映射、默认目标选择），没有单一的「层解析」入口。
10. **深模块已存在但没被接上（死代码）**：`queryAgents`（`model.ts` 行 82）与 `shadowedClipNames`（行 124）**零调用点**，而 `AgentList.tsx` 行 138–149 把前者的权重公式（`errs*10 + hints`）内联重写了一遍 ⇒ 这不是「抽模块」，而是「把已有模块接上、删掉副本」。
11. **同一判断两套**：`remapImpact`（`model.ts` 行 420）已被 App 使用，`ModelLinks.tsx` 行 689–693 又手拼一遍「影响 Agent ×N」。

### 列表页与模型关联页的补充证据（第二个只读子代理）

- **列表管道 4 套实现**：TanStack 列定义（`AgentList.tsx` 行 64–131）＋ `ModelLinks.tsx` 行 174–193 与行 195–214 两份手写过滤 ＋ `ClipLibrary.tsx` 行 82–96 第三份；`AgentList.tsx` 行 151–188 还在 `AgentListQuery` 与列状态之间做双向翻译（5 处）。
- **主从外壳 3 份 ＋ 3 个 CSS 变量名**：`--list-width`（`App.tsx` 行 335）／`--models-list-w`（`ModelLinks.tsx` 行 321）／`--sections-list-w`（`ClipLibrary.tsx` 行 160）——同一策略三处各自命名。
- **选中修复语义不一致**：空列表时 App 清空选中（行 235–241），`ClipLibrary.tsx` 行 104–108 保留选中 ⇒ 同样的交互两种语义，且都不可测。
- **详情「四件套」三份**：`AliasDetail`（`ModelLinks.tsx` 行 647–764）、`ModelDetail`（行 777–908）、`ClipLibrary.tsx` 行 273–399 各写一遍「详情头 ＋ meta dl ＋ chips ＋ 预览」；同文件行 JSX 两遍（行 407–437 vs 440–472）。
- **零行为转发器**：`AgentCard.tsx`（18 行）与 `AgentDetail.tsx`（18 行）只是 `AgentRow`（89 行，唯一实现）的转发壳。
- **真 bug（漂移的代价，作为证据）**：`ModelLinks.tsx` 行 501、510 用 `'builtin' in record` 窄化 `ModelDef`，而该类型**没有** `builtin` 字段 ⇒ 恒为 false，内置模型条目反而显示「删除」而不是只读（同一守卫在行 675 对 `AliasDef` 是正确的）。
- **真缺口（必须在契约里补）**：UI 三处断言「available:false = 解析时跳过并回退」（`ModelLinks.tsx` 行 673、799、814），但 `resolveModel` / `resolveAlias`（`model.ts` 行 137、144）**根本不看 `available`** ⇒ 领域断言没有实现支撑。链解析（含 available 跳过与回退）是 **03 票**的解析引擎职责；本票只消费其结果，不重实现（见「已知约束」）。
- **pane-layout 形状错而非该删**：缝是真的（两个观测适配器：window 观测 vs 容器 `excludeRef`），但接口返回 10 个字段、调用方只用 6 个；纯策略约 15 行零导出（不可测）；夹取算术两份（行 57–61 与 83–84）；`getComputedStyle` 在 render 期读取（行 51）。
- **视图相关键漏进组件**：`clip-${name}`（`ClipLibrary.tsx` 行 69 与 `model.ts` 行 245 各自硬编码同一存储编码）；`PromptClip.file` 与契约的 `path?` 命名不一致。

### 数据形状偏差（「尊重数据结构」＝必须消除）

| 原型形状 | 冻结契约／宿主现状 | 处置 |
|---|---|---|
| `AgentDoc.frontmatter: AgentFrontmatter` 嵌套 ＋ `extra` | `AgentDefinition` 是**扁平**的（`src/contract/types.ts:54`）；宿主已有 `AgentFrontmatter`（`src/core/catalog/frontmatter.ts:22`）与 `parseAgentDocument`（`src/core/catalog/frontmatter.ts:84`） | 主线不得出现第二份 frontmatter 模型；编辑器要的原始 YAML 以显式字段（如 `frontmatterText`）出现在 compose 输出 |
| registry 层复用 `AgentSource`（含 `'bundled'`） | registry 层是 `AliasRegistrySource`（`src/contract/types.ts:132`），只 3 值 | 原型 `SOURCE_RANK` 混两套方言；主线直接用 `ModelDefinition`（`src/contract/types.ts:153`）/ `AliasDefinition`（`src/contract/types.ts:169`） |
| `Finding` 合成三族（4 别名码 ＋ 2 新增警告码） | `AgentDiagnostic`（7 码，`src/contract/types.ts:37`）与 `AliasFinding`（4 码，`src/contract/types.ts:252`）分族 | 核心派生**一个归一化视图类型**（带 `origin` 判别），UI 不得自行归并 |
| `AgentDoc.disabled?: boolean` | 契约无此字段；05 票 Q1 裁决启停 v1 不做 | 删除，不得进主线 |
| `PromptClip` / `DocBlock` / `BlockRange` | 无冻结契约（P1 提案） | **动工前必须裁决**（Q1）；裁决后先冻结形状再实现 |
| `ComposedDocument.text` ＋ `ranges`（编辑器字符偏移） | 域概念里不存在 | 偏移属**编辑器视图模型**；域形状只有 `blocks[]` ＋ `frontmatterText` |
| `ComposedDocument` 缺 `source` / `origin` / `readonly` | 冻结侧一律显式（`?: T \| undefined`，`exactOptionalPropertyTypes` 下原型的 `?` 形式不兼容） | 域形状显式携带身份字段；`readonly` 由 `origin`/`source` 派生，不再由 JSX 里 `source === 'bundled'` 现推 |
| 位置/索引当标识 | — | `ranges[block.id] ?? {from:0,to:0}` 的伪造 offset、按数组下标比结构、把 `L7–12` 当块身份，全部移除 |

### 其他

- **原型专用依赖只在原型分支**（2026-10-18 核验）：主线 `package.json` 的 `dependencies` 只剩 `js-yaml` / `zod`（`hostRuntimeDeps` 判定合规）；`codemirror` / `@codemirror/*` / `@tanstack/react-table` 只存在于 `proto/settings-ui` 的 `package.json`，**未进主线** ⇒ 本票不需要「移出运行时依赖」，只剩三处「零运行时依赖」注释要改。
- **写盘是伪造的**：`App.tsx` 的 `markWrites` 直接造 `FileWrite` 记录；没有原子写、写后重校验、被 home patch/CLI 覆盖的失败语义。

## 目标接口（深模块：小接口，大行为）

宿主侧一个深模块（建议 `src/control/`），接口 ≤ 6 个成员：

- `snapshot(options?): Promise<ControlSnapshot>` — 四类数据（冻结类型）＋ 归一化 findings ＋ 原始 diagnostics；**域形状，无视图字段**
- `compose(agentName, options?): Promise<ComposedAgentDocument>` — `blocks[]`（`id` / `kind` / `file` / `text` / `clipName?` / `source?` / `missing?`）＋ `frontmatterText` ＋ 身份字段；**不含编辑器偏移**
- `plan(edits: DocumentEdit[]): WritePlan` — **纯函数**：草稿 → 每文件写入计划（`{ file, content, blockIds }`）＋ 拒绝原因（无 I/O）
- `commit(plan: WritePlan): Promise<WriteReport>` — 原子落盘（temp ＋ rename，`0600`）＋ 写后重校验 ＋ 覆盖冲突 ＋ 逐文件结果
- `applyRegistryEdit(edit: RegistryEdit): Promise<WriteReport>` — 判别联合（`setAvailable` / `setSysPrompt` / `remapAlias` / `addAlias` / `deleteAlias` / `addModel` / `deleteModel`）；层解析、删除回退、路径推导全藏在里面
- `invalidate(): void`

**内部 seam**（不进接口，供自带测试）——按收益排序：

1. `composeDocument`：唯一模板解析器、块 id/顺序、分隔符常量、层优先解析、missing 表示（消灭三份语法副本）。
2. `planWrites(doc, dirty) → { file, content, blockIds }[]`：块→文件路由（frontmatter＋prose 拼接、clip 独立文件、missing 跳过）、真实行数（消灭伪造 `lines` 与按 kind 的重复路由）。
3. `describeBlocks(doc, texts) → BlockView[]`：`id` / `kind` / `file` / `source` / `missing` / `dirty` / `foldable` / `folded` / 起止行；藏 `lineStarts`、header 行推导、fold 合并、dirty 比较（把编辑器里约 194 行的 meta 计算压成「数据→Decoration」）。
4. `foldController`：`isFoldable(block)` / `foldMap(compact, folds)` / `toggleFold(folds, compact, id)`；藏「只 clip、非 missing、需 header」与 compact ＋ 逐块覆盖两层优先。
5. `planSync(doc, drafts, liveTexts) → { whole?; patches }`：外部对账（草稿优先、结构 vs 内容两路），替掉 `sameStructure` 启发式与按数组下标比结构。
6. `evaluateAgentQuery(rows, query)`：唯一的列表查询求值器，TanStack 的 filter/sort 配置与测试共用它。
7. `computePaneLayout({ available, rem, preferredListWidth })`：纯阈值/夹取数学；`usePaneLayout` 退化为测量适配器。
8. `AgentDocPort`（接线 seam，12 票用）：`read(agentName)` / `commit(dirty)` / `invalidate`；组件 props 不变，App 的 `useMemo(composeDocument)` 与三个 override map 搬进适配器。
9. `buildRegistryView(models, aliases, agents, space)` ＋ `listModelLinks(view, query)`：藏合并空间、遮蔽关系、可达性映射、haystack、排序、统一「问题谓词」与稳定键；替掉 `ModelLinks.tsx` 里三份手写过滤与两个问题谓词。
10. `layerRelation(record, winner, layers) → { kind, note, badge }`：藏层优先级常量与文案/徽标优先级；替掉散在 6 处的遮蔽判定。
11. ~~`MasterDetailPane`~~（2026-10-18 Q6 裁决：**移出本票**，归 05/13）：吸收 `ListPane` ＋ `PaneSplitter` ＋ `usePaneLayout` ＋ 选中修复 ＋ 键盘/`data-*` 选择器；消掉 3 个 CSS 变量名，统一「空列表时选中如何处置」，顺手删掉两个 18 行转发器。
12. `EntityKey`（`entryKey` / `clipKey` / `parseKey`）：把 `clip-${name}` 这类存储编码收进一处，修掉「视图相关键」漏进组件。

**两个适配器 ⇒ 真 seam**：内存适配器（测试 ＋ 原型演示）与宿主 HTTP 适配器（12 票落地）。一个适配器只是假想 seam，故本票必须同时给出内存适配器。

## 范围

1. 冻结接口形状（回写 `## 契约（冻结）`），实现宿主侧核心：纯逻辑 ＋ 注入 fs 端口；`@deepseek-ai/*` 一律不 import（ADR-0001）。
2. **补写面**：与既有读者配套的序列化/回写的唯一实现（D14 原文回写、注释与未知键保留），用 `js-yaml` / `zod` 或扩展现有 `yaml-scalar.ts`，二选一但只留一份。
3. 按上表迁移域规则、去重、去漂移；删除 `disabled`、`Finding` 归并模型、平行的 frontmatter 模型、伪造 offset/file/lines。
4. 抽出上述内部 seam（编辑器视图模型、写计划、列表查询求值器、分栏纯函数）。
5. 依赖归置：原型专用包**已不在**主线 `dependencies`（只在分支）；`js-yaml` / `zod` 按 05 Q4 裁决保留；修掉三处「零运行时依赖」注释与 `package.json` 的矛盾。
6. 更新 `CONTEXT.md` 术语（组合文档 / 块 / 写入计划），必要时补 ADR。

**不含**：`ctx.webServer` 路由与 client 接线（12）、前端测试（13）、UI 组件实现本身（05）。

## 动工前必须裁决

- **Q1（阻断）clip 切片模型**：`{% include clip <name> %}` 模板 ＋ `sections/<name>.md` 独立文件是原型提案，而 01 冻结契约的 body 是单文件。三选一：(A) 引入切片文件并冻结新契约（01 需修订）；(B) 只做单文件 body，不引入切片（`compose` 退化为 frontmatter ＋ body 两块）；(C) 切片只存在于 UI 概念层、落盘保持单文件。**推荐 (A)**——P1 标注的「编辑 Clip 保存时改涉及的所有 clip 文件」只有切片成文件才成立；但这是产品决定，不是实现细节。（2026-10-18 诊断补：原型切片落点是 `<发现根>/sections/<name>.md`，而 `src/core/catalog/discovery.ts:141` 起把根下每个 kebab 目录都当 agent 候选 ⇒ `sections/` 会被判 `missing-document`，用户根每次扫描一条诊断、受信 bundled 根更会直接抛错。选 A 必须同时改发现面（保留目录名）或改用点号目录；成本落在 `discoverDirectory`，**不动** `src/contract/types.ts` 的冻结读面。维护者追问后补：`~/repo/ChunkStellar/.harness` 的组装是先例，但属**交付层**；作者层仍用 include（可嵌套、禁参数化）。落点取点号目录 `.sections/` 则 `src/core/catalog/discovery.ts:144` 直接跳过 ⇒ 发现面零改动。详见诊断记录「Q1 目标评价」。）
- **Q2 front-matter 编辑形态**：(A) 文本编辑 ＋ 写前用 D23 解析器校验、按原文回写（保注释/未知键）；(B) 字段表单（每字段一个控件，写入时序列化）。**推荐 (A)**——与 P1 标注一致，且 D14 的 1:1 回写只有文本形态能满足。（2026-10-18 诊断补：原型 `model.ts` 行 175-193 的 `serializeFrontmatter` 不转义 `name`/`description`、丢注释与键序，B 形态无法满足 D14 原文回写；选 B 需先推翻 D14，不是自由二选一。）
- **Q3 归属**：本票与 05 的关系。**推荐**：本票 = 05 的后端优先第一刀，05 的 brief 继续有效并收到本票指针。（2026-10-18 诊断补：05 正文范围 6 仍把写器写作「本票新增」、范围 3 仍认领数据通道，且 05 现为 `ready-for-agent` 且无 `Blocked by: 11` ⇒ 边界不落，先领 05 的 agent 会造出第二份写器/通道；另本票内部 seam 第 11 项 `MasterDetailPane` 是组件实现，与本票范围「不含 UI 组件实现（05）」自相矛盾，需一并裁决。）

裁决后本票转 `ready-for-agent`。

## 契约（冻结）

2026-10-19 实施完成时冻结。公开面 = `src/control/index.ts`（跨层 import 只走它，check.mjs 矩阵已加 control 层）；新形状进新文件（`src/control/types.ts`），`src/contract/types.ts` 未改动；所有可选字段一律显式 `?: T | undefined`（`exactOptionalPropertyTypes`）。

### ControlCore（`createControlCore(deps: ControlDependencies)`，六成员）

- `snapshot(options?): Promise<ControlSnapshot>` — `agents` / `models` / `aliases` 用冻结读面类型（`AgentDefinition` / `ModelDefinition` / `AliasDefinition`）＋ 原始 `agentDiagnostics` / `aliasDiagnostics` ＋ 归一化 `findings: ControlFinding[]`（`origin: 'agent-scan' | 'registry-layer' | 'cross-layer'` 判别联合；cross-layer 复用 `inspectAliasRegistry`，不重实现）。
- `compose(agentName, options?): Promise<ComposedAgentDocument>` — `agentName` / `path` / `source` / `origin` / `providerId` ＋ `frontmatterText` / `bodyText` 原始字节 ＋ `baseText` ＋ `framing`（`plain | fenced`，含 opening/closing 原始字节）＋ `blocks[]`（v1 仅 `frontmatter` / `prose` 两种 kind；`id` / `kind` / `file` / `text`）。无编辑器偏移。agent 未找到或文件不可读 throw（读面错误）。
- `plan(doc, edits): WritePlan` — 同步纯函数：同输入同输出、无 I/O、不改参。逐编辑应用到草稿并经 `parseAgentDocument` 验证，失败回滚为数据化 rejection（`code` / `message` / `editIndex`），永不 throw；无变化不产生 entry（`content !== baseText` 才写，D14）。
- `commit(plan): Promise<WriteReport>` — 永不 throw：逐 entry 再验证（`invalid-content`）→ 读盘比对（不一致 → `conflict`；文件消失 → `not-found`）→ 原子写（`ensureDirectory` → `writeNewFile`（wx、`0600`）→ `renameFile`）→ 写后重读验证；失败清理临时文件。`WriteFailureCode = conflict | invalid-content | io-error | invalid-edit | not-found | read-only`。
- `applyRegistryEdit(edit: RegistryEdit): Promise<WriteReport>` — 7 kind 判别联合（`setAvailable` / `setSysPrompt` / `remapAlias` / `addAlias` / `deleteAlias` / `addModel` / `deleteModel`）；层解析、路径推导、删除回退全藏在内。行手术保留注释 / 未知键 / 键序；层文件手术前后各验一次 `readRegistryLayer`（坏层整体拒绝 → `invalid-content`）。`built-in` 或 path 缺失 → `read-only`；未找到 → `not-found`；`addAlias` / `addModel` 须显式 `source: 'project-dsh' | 'user-dsh'`；保留名 `dsh-default`；名字须 `/^[A-Za-z0-9_.-]+$/`；`addAlias` 目标须存在于 registry。成功后失效别名注册表缓存。
- `invalidate(): void` — 同时失效 agent 与 alias 两注册表缓存。

### 序列化（唯一实现，ADR-0005）

文件 = `opening + frontmatterText + closing + bodyText` 逐字节往返（CRLF、注释、未知键、键序保留）；`frontmatterText` 含 closing 前的换行。frontmatter 编译器不变式：结果为 `''` 或以 `\n` 结尾；plain 文档 ＋ 字段编辑 ⇒ 合成 `---\n` ＋ 文本 ＋ `---\n`。`DocumentEdit` 两种：`setBlockText`（原始文本替换）与 `setFrontmatterField`（9 字段，编译成原文编辑——Q5 裁决，不引入第二数据路径）。

### 接线 seam（12 票消费）

- `evaluateAgentQuery(rows, query: AgentListQuery): AgentRow[]` — 唯一列表求值器（filter / sort 纯函数，UI 共用，不自行内联权重公式）。
- `AgentDocPort` = `{ read(agentName), commit(dirty: DocumentEdit[]), invalidate }`；`createAgentDocPort(core, { cwd? })` 按 agentName 分组 dirty edits、逐组 compose（unknown agent → `unknown-agent` rejection，`editIndex` = 组首索引）、一次 commit 一份报告。
- 适配器：内存适配器 `createInMemoryControlCore`（`src/control/memory.ts`，测试 / 演示）；Node 写适配器 `createNodeControlFileSystem()`（`src/providers/fs/write.ts`）；宿主 HTTP 适配器归 12 票，同接口。

## 验收

- [x] 契约冻结并回写本票 `## 契约（冻结）`；`src/contract/types.ts` 未被改动（新形状进新文件）
- [x] 核心接口成员 ≤ 6；内部纯函数可单独测试（internal seam）
- [x] 写面存在且与既有读者配对：往返不丢注释/未知键（D14），有原子写与失败路径
- [x] 主线无第二份 frontmatter / registry 解析模型；registry 层类型用 `AliasRegistrySource`
- [x] `AgentDiagnostic` 与 `AliasFinding` 分族保留，归一化视图带 `origin` 判别
- [x] 模板行语法、分隔行规则、行号口径、脏口径、块→文件路由各只有**一份**实现（Q1=B：v1 无切片 ⇒ 模板行/分隔行不存在；行号/脏口径归 05 UI；块→文件路由唯一实现于 `src/control/writes.ts`）
- [x] 主线不存在 `disabled`、`Finding` 归并模型、伪造的 offset / file 占位串 / `lines`
- [x] `plan()` 是纯函数（同输入同输出）；`commit()` 覆盖冲突有明确错误
- [x] 三处「零运行时依赖」注释与 `package.json` 一致；原型专用包（codemirror / @codemirror/* / @tanstack/react-table）不进主线（2026-10-18 已成立，回归即可）
- [x] `pnpm run check` 全绿（含 `hostRuntimeDeps` 判定）；`CONTEXT.md` 术语更新；原型分支不合并（2026-10-19：静态 6 项 ＋ typecheck ＋ 147 测试全绿）

## 已知约束

- 沙箱内不做依赖变更（pnpm store 陷阱 ＋ 敏感操作，见 `docs/agents/harness-facts.md`）；需要新依赖时由维护者在沙箱外安装。
- 写盘面必须与 05 票的 Q3-A 通道定案一致（宿主自管文件；client 只经 12 票的 HTTP 适配器）。
- 01/02 的冻结读面**只读**：`ctx.agentRegistry`（`src/contract/types.ts:112`）与 `ctx.aliasRegistry`（`src/contract/types.ts:219`）不因本票而改；本票只加写面与组合面。
- CodeMirror 侧的可测性阻断点已定位：StateField 构造依赖 React ref/callback（`DocumentEditor.tsx` 行 452–453），改成普通参数后该文件约 409 行可在 Node 里 headless 测（`@codemirror/state` 本身 DOM-free）——这条给 13 票用。
- **链解析归 03，不归本票**：`modelOrder` → 别名 → 模型条目的解析、`available: false` 的跳过与沿声明顺序回退、链耗尽硬错，都是 03 票解析引擎的语义。本票的 `snapshot` 只消费其结果（链展示与 findings）；若动工时 03 尚未落地，本票**不**自行实现一套平行解析器，宁可在 UI 上显式标注「链解析待 03」。原型的三处 `available` 断言无实现支撑（见上），正是「UI 抢了引擎职责」的后果。
- **层合并不许 UI 重算**：接通后必须删掉 UI 侧的重算（原型 `model.ts` 行 137–148），因为宿主 `ctx.aliasRegistry.getAlias` / `getModel`（`src/contract/types.ts:219`）已经解析过层；否则两份真相必然漂移。

## Comments

- 来源：`/codebase-design` 分析请求（2026-10-17，维护者：「Prototype 实现的分析…后端优先、尊重数据结构、尽可能优化」）；两个只读子代理分别产出编辑器核心与列表/模型关联页的结构证据。
- 参考实现：分支 `proto/settings-ui`（throwaway）；05 票已挂该分支的指针。

### 诊断记录（/triage，2026-10-18）

> *This was generated by AI during triage.*

**阶段闸门**：进入时 `Status: needs-triage`，无 `## Answer`、无 `## Agent Brief`、无实施提交（HEAD `db52b0d` 只加票面）。`src/` 仍是 01/02 的 11 个文件、`src/control/` 不存在 ⇒ 判定**未动工**，走正常诊断；本记录不改任何 `src/`（诊断 ≠ 实施）。

**现象**：宿主侧「控制核心」与写面都不存在——用户今天改 agent 配置只能手改文件；原型验证过的组合文档/切片/写计划行为无法进主线，因为它带回了与 01/02 冻结契约冲突的数据形状（平行 frontmatter 模型、`AgentSource` 混用、`Finding` 三族、`disabled` 等）。

**影响范围**：12（接线）、13（前端测试）均 `Blocked by: 11`，契约冻结前无法开工；05 已 `ready-for-agent`，其正文范围 3（数据通道）/ 6（写器）与 12/11 重叠 ⇒ 先领 05 会先造出第二份写器与通道（根因 C4、❓Q3）。map 已定「11 裁决落地后即为新的第一优先」。

**核验证据（最小复现，2026-10-18 真机）**

- 写面缺失：`grep -rn 'writeFile\|rename(\|mkdtemp\|atomic' src/` → 0 命中；`ls src/control` → 不存在。
- 读面健康且未动：`npm run check` EXIT=0（`node scripts/check.mjs` 通过、92 处 `path:line` 锚点全解析、`tsc --noEmit` 0、83 单测通过）。pnpm 前置 install 在沙箱内报 `ERR_SQLITE_ERROR` 是已记 harness 事实（`docs/agents/harness-facts.md`），不影响三项判定。
- 原型不在类型检查内：`tsconfig.json` `"include": ["src","test"]`；`prototype/` 只在 `proto/settings-ui` 分支，该分支 `tsconfig.json` 同值 ⇒ 漂移编译期不可见。
- 真 bug 复核（原型分支，证据成立、只作证据）：`components/ModelLinks.tsx` 行 501 / 510 用 `'builtin' in active.record && active.record.builtin` 窄化，而 `prototype/settings-ui/src/types.ts` 第 86 行的 `builtin?: boolean` 只在 `AliasDef`、`ModelDef`（同文件 `:66` 起）无此字段 ⇒ 对模型条目恒 false：内置模型条目的「只读」标签不出现，反而走删除分支。
- 死代码复核：`git grep -n 'queryAgents\|shadowedClipNames' proto/settings-ui -- prototype/` → 仅 `model.ts` 行 82 / 124 两处定义 + README 一句说明，零调用点。
- `available` 无实现支撑：`model.ts` 行 137 / 144 的 `resolveModel`/`resolveAlias` 只按名字 + `SOURCE_RANK` 排序，不看 `available` ⇒ UI 三处「available:false = 跳过并回退」的领域断言没有实现（链语义归 03，本票只消费）。
- 写计划伪造行数：`model.ts` 行 394-409 的 `saveWrites` 的 `lines = Σ 各块行数`；同文件多块按 `'\n'` 拼接后的真实行数应为 `sum−(n−1)`。
- 缺片占位串当文件名：`model.ts` 行 274 把 ``（未找到切片 ${clipName}）`` 展示串写进 `DocBlock.file`，`saveWrites` 与 Inspector 还拿它当文件键。
- 重复引用未定义：同一 body 两次引用同一 clip 时块 id 都是 `clip-${name}`，`layoutBlocks` 的 `ranges[block.id]` 后写覆盖前写 ⇒ 编辑/保存只认一块（嵌套与重复引用的语义要在契约里显式定为诊断或 fail-fast）。
- 序列化不可往返：`model.ts` 行 175-193 的 `serializeFrontmatter` 只写已知键 + `extra` 原文，`name`/`description` 不转义、注释与键序全丢 ⇒ 满足不了 D14 的 1:1 原文回写（❓Q2 的硬约束）。
- Q1 的具体代价：原型切片落点是 `<发现根>/sections/<name>.md`（`prototype/settings-ui/src/fixtures.ts` 第 109 行；`App.tsx` 的「外部手改」演示也用同路径），而 `src/core/catalog/discovery.ts:141` 起把根下每个 kebab 目录都当 agent 候选 ⇒ `sections/` 会被判 `missing-document`（用户根每次扫描一条诊断；若出现在受信 bundled 根会直接抛错）⇒ 选 A 必须同时改发现面（保留目录名）或改用点号目录（点号目录在 `src/core/catalog/discovery.ts:144` 直接被跳过 ⇒ 零发现面改动）。
- 票面事实漂移（已就地修正）：主线 `dependencies` 只剩 `js-yaml`/`zod`（`hostRuntimeDeps` 合规）；`codemirror`/`@codemirror/*`/`@tanstack/react-table` 只在 `proto/settings-ui` 的 `package.json`，**未进主线**；05 票 Q4 裁决「我们需要这些依赖」已定 js-yaml/zod 保留 ⇒ 原文「原型专用依赖会装进任何使用者的 profile」「要么把声明去掉」已过时，本票只剩三处注释要改。
- 冗余检查：`src/`、`test/`、`bundled/` 无 control/compose/write 实现；`.out-of-scope/` 不存在 ⇒ 无既有实现、无历史拒绝记录。

**根因候选（置信度）**

- **C1（100%，范围顺延）**：写面从未进任何已落地票——01/02 只交付读器；05 范围 6 才把写器列为「本票新增」，随后 05 拆出本票 ⇒ 宿主「只读」是范围顺延的结果，不是缺陷。
- **C2（95%，隔离失效）**：原型 throwaway 且不在 tsconfig include ⇒ 形状漂移编译期不可见，`'builtin'` 恒 false 这类 bug 是隔离的产物；原型本体不进主线，这些 bug 只作证据、不是待修缺陷。
- **C3（高，真阻断）**：原型把 spec 之外的一族领域带进来——切片（第三类分层实体）+ 组合文档 + 写计划；spec §5.1 只有「正文 = 人设」单文件 ⇒ Q1 本质是「v1 要不要引入切片」，产品裁决（❓Q1）。
- **C4（中高，跨票竞争）**：11 范围 2（写面）与 05 范围 6（写器）同一块地；11 的契约（`plan`/`commit` 纯函数 + 原子写 + 拒绝原因）与 05 brief 的「写器为新增面」指向两份实现，且 05 现为 `ready-for-agent`、无 `Blocked by: 11`（❓Q3）。同类：05 范围 3（通道）与 12。
- **C5（中，时间差）**：票面写于 05 Q4 依赖裁决与主线依赖清理之前（依赖段已就地修正）；Q1 的「01 需修订」没定位到具体改动点（已补）；内部 seam 第 11 项 `MasterDetailPane` 是组件实现，与本票范围「不含 UI 组件实现（05）」自相矛盾（并入 ❓Q3）。

**分流结论**：**`needs-info`**（category: enhancement）。不是不做、也不是交人写代码——缺的是只能由维护者拍板、且决定契约冻结面的三个输入；未答复前写不出可交给 AFK agent 的 brief（不猜）：

1. **Q1 切片模型**（硬阻断，维护者追问后已细化为 A′）：A′ 引入切片、工具端 include 解析、允许嵌套（禁参数/变量；导出另立票）——诊断推荐；B 只做单文件 body、切片延后（需同步改 12 的 `sections/*.md` 验收）；C 切片只在 UI 概念层（违背 D14）；D 组装式（ChunkStellar 机制，不搬进编辑器）。（维护者方向 2026-10-18：跨 harness 优先，v1 倾向 **B ＋ 装配源双格式**，include 不进 v1；待确认后落标签。）
2. **Q2 front-matter 形态**：A 原文文本 + 写前校验（推荐，D14 已事实锁定）/ B 字段表单（需先推翻 D14）。
3. **Q3 11 与 05/12 的边界**：写器与通道归 11/12、05 正文收指针并加 `Blocked by: 11, 12`？`MasterDetailPane` 移出 11？

回复后的标签动作：转 `ready-for-agent` + 挂 agent brief（`## 契约（冻结）` 留到实施第一步）；12/13 维持 `ready-for-agent` + `Blocked by: 11` 不变（契约冻结在 11 内，不改它们的阻塞边）。

**Q1 目标评价与两模式心智平衡（2026-10-18，维护者追问后补）**

- **先例定性**：`~/repo/ChunkStellar/.harness`（README 44 行；`compose.toml` 的 `[meta]` 声明式装配规则；`binding/<品牌>.toml` 词汇投影；`compose.lock` 哈希冻结；`tools/agent-composer.py` 的 build/check）是**构建式组装**：块整选、块内禁槽位、顺序按共享广度降序、生成物直写品牌目录（无符号链接）、投影 fail-fast。它优化的是**字节确定性 ＋ 多品牌交付**；禁嵌套/禁参数正是该目标的取舍，不是缺陷 ⇒ 不要让组装层长出 include。
- **两层分离**：切片（P1 组合文档）是**作者层**目标：单源片段（Prompt Sections 库）、层遮蔽（workspace 胜 user）、一次保存回写涉及文件、编辑器内组合视图。ChunkStellar 的 manifest/哈希/check 纪律属于**交付层**，可复用但别混层。
- **三种读者 ⇒ 一个语法、多种渲染**：① 编辑器 = 组合视图（含 `{% include %}` 标记行，可编辑）；② 本宿主运行时 = **去标记**的展开正文（标记永不进模型上下文）；③ 外部不支持插件的工具 = 扁平快照。快照必须派生、只读、带来源哈希、不进发现面；缺片/环/重复引用的诊断码在三种渲染下同构。
- **嵌套**：原型 `composeDocument` 只扫 agent body 行、clip 内容原样内联 ⇒ 原型也不支持嵌套；作者层支持嵌套成本低（环检测 ＋ 深度上限），但 v1 禁参数/变量/条件（把 ChunkStellar「块内禁槽位」的纪律用在作者层），否则组合视图与 1:1 回写不可解释；同一文件被多块引用应 fail-fast。
- **心智平衡规则**：一个语法（include，可嵌套）＋ 两个渲染（实时读取 = 内存组合；交付 = 快照文件）；用户只需认识「切片（可编辑的最小单元）」与「快照（不可编辑的产物）」两个名词。双编辑面、自动改写外部目录、把组装当编辑器模型、把 include 做成模板语言，都会破平衡。
- **对 Q1 的结论（不含裁决；2026-10-18 裁决已取代为 B）**：切片曾评估为可进 v1 作者层（A′）；离线导出另立票（不在本票）；若选 B，需同步改 12 的 `sections/*.md` 验收。落点建议 `.sections/`（点号目录，零发现面改动）。**裁决：B（v1 无切片）**。
- **未决**：导出归属（本票不做/另立票/永不做）；落点名（`.sections/` vs 保留 `sections/`）；嵌套边界（是否进 v1 契约、上限、是否禁参数）。
- **双模式的 provider 化与去重/覆盖（2026-10-18 追问后补）**：分层职责 = 唯一读路径（发现 → 层解析）→ 唯一组合（`compose` 产出 IR：blocks ＋ provenance ＋ diagnostics）→ provider 只渲染（`render(ir, target) → { text | writes }`）→ 唯一写路径（`plan`/`commit` 原子写 ＋ 记录）。provider 不得读盘/写盘/解析标记/做层解析。两种模式 = 两个内置 provider：`runtime`（composed → 去标记文本，内存）与 `snapshot:<target>`（composed → 扁平文件）；按 consumer 能力选择，不做用户开关。去重键：agent =（root rank, agent-name）、slice =（rank, name）、target = id、产物 = path；同键同哈希 → 不写（幂等），同键异内容 → 层遮蔽/漂移冲突，同 path 两 provider → 注册期 fail-fast，产物根 ∩ 发现根 → 注册期 fail-fast，重复 include 同一 slice → 诊断，同文件多块引用 → fail-fast，同目录同时有原生与组合 → 冲突诊断（不静默择优）。覆盖只有一个语义：层 rank（core 一次实现），provider 不参与覆盖；快照覆盖须显式 build ＋ lock 哈希比对，手改/漂移 → 冲突错误（要求确认，参考 ChunkStellar 的冻结接受）；快照不回写源（导入另立票）。落地：11 只保证 IR 够用（blocks/provenance/去标记文本），provider 接口与 snapshot 票后置（14），不把动态插件注册塞进 11。
- **[历史，已被 2026-10-18 裁决取代] 维护者方向讨论稿（2026-10-18）**：跨 harness 是真实约束（团队用不同厂商额度、部分客户端锁定）⇒ v1 放弃 include，改为**方案一（装配/静态转换）＋ 标准 Agent 定义文件**双格式。诊断意见：① 主源 = 标准 Agent 文件（天然扁平、任意 harness 可打开、现有 11/12/13 路径、D14 直接成立）；装配源（`.harness` 树）是**逐 agent 的替代格式**，由转换器导入/导出与静态构建消费，**不做双向同步、不做第二个编辑面**。② 设置页 v1 只编辑标准文件；装配源的编辑/浏览延后（15），转换器另立票（14）。③ 转换器 = 一个引擎 ＋ 每目标一个 binding（字段/工具投影、必填特性 fail-fast、可选 omit 带理由、生成物 lock 哈希、禁止进发现根）；先做 1 个真实 locked client（团队最痛）验证 binding；DSH 侧若 agent 是装配源，由转换器生成标准文件，**不做第二读路径**。④ 标准文件现在就要定核心/扩展边界：core = name/description/body（＋ 可选 model hint、中性工具 id），DSH 扩展字段（modelOrder/model raw/skills/spawn/reasoningEffort/color/emoji）显式标注、转换时映射或丢弃并报告。⑤ DSH 读路径不变（只读标准文件），不让 DSH 直接解析 `.harness`，避免两条读路径。未决：主源拓扑、首批转换目标、工具 id 中性化、失败策略（见回复 Q1–Q4）。

### 裁决与 Agent Brief（/triage，2026-10-18）

> *This was generated by AI during triage.*

**裁决记录**：2026-10-18 维护者裁决——Q1=B（v1 仅标准 Agent 文件，单文件 body；切片/装配源/动态模式延后）；Q5=A+B（前端移植时定，core 以原文回写为唯一源）；Q4=A（未来转换器失败策略）；Q2/Q3 暂不做；Q6 待确认。维护者澄清 prototype 本意 = 装配源编辑器，长期 host 只读装配源；v1 是时间受限的过渡。

## Agent Brief

**Category:** enhancement
**Summary:** 给宿主补上唯一一套 agent 文档写面与组合视图控制核心（深模块，≤6 接口成员），消除原型相对冻结契约的数据形状漂移。v1 只支持标准 Agent 定义文件（单文件 body）；切片、装配源、动态 provider 均不在本票。

**Current behavior:**
宿主只有读面：发现、解析、注册表查询可用，但没有任何写盘能力；用户只能手改 agent 文档。原型（throwaway）验证过组合视图与写计划，但它的序列化不可往返（不转义、丢注释与键序），且带回了平行 frontmatter 模型、混用 registry 与 agent 两套来源方言、`Finding` 三族、`disabled` 等与冻结契约冲突的形状；原型不在类型检查内，漂移无人报警。

**Desired behavior:**
- 新增宿主侧独立控制模块（深模块），接口 ≤ 6 成员：`snapshot` / `compose` / `plan` / `commit` / `applyRegistryEdit` / `invalidate`；纯逻辑 ＋ 注入 fs 端口。
- `compose(agentName)` 返回域形状：`frontmatterText` ＋ `blocks[]`（v1 只有 `frontmatter` / `prose` 两种 kind，无 clip 字段）＋ 身份字段；**不含编辑器字符偏移**。
- `plan(edits)` 是纯函数：草稿 → 逐文件写入计划（每个 agent 一份 `.agent.md`；registry 编辑走 `applyRegistryEdit`）＋ 拒绝原因；`commit(plan)` 原子写（temp ＋ rename、`0600`）、写后重校验、覆盖冲突返回明确错误。
- 唯一序列化实现满足 D14 往返：注释、未知键、键序保留；`name` / `description` 正确转义。front-matter 的 raw 文本与字段表单两种编辑形态共用这一份实现；字段表单只是生成原文编辑，不引入第二数据路径。
- registry 层使用 `AliasRegistrySource`，模型/别名使用 `ModelDefinition` / `AliasDefinition`；`AgentDiagnostic` 与 `AliasFinding` 分族保留，归一化视图带 `origin` 判别。
- 删除 `disabled`、平行 frontmatter 模型、`Finding` 归并模型、伪 offset、伪文件名占位串、伪造行数；模板行语法/分隔行/行号/脏口径/块→文件路由各只有一份实现。
- 链解析（`modelOrder` → 别名 → 条目、`available:false` 跳过与回退、链耗尽硬错）归 03 票引擎；本模块只消费结果，不重实现；03 未落地时显式标注「链解析待 03」。
- 两个适配器：内存适配器（测试/演示）与宿主 HTTP 适配器（12 票）；一个适配器只是假想 seam，故本票必须给出内存适配器。
- 内部纯函数可单测（internal seam：唯一模板解析、写计划、块视图、分栏、查询求值等）。

**Key interfaces:**
- `ControlSnapshot`：四类数据（冻结类型）＋ 归一化 findings ＋ 原始 diagnostics；无视图字段。
- `ComposedAgentDocument`：`frontmatterText` ＋ `blocks[]`（`id` / `kind`（`frontmatter` / `prose`）/ `file` / `text`）＋ `agentName` / `path` / `source` / `origin`。
- `WritePlan`：`{ file, content, blockIds }[]`；`WriteReport`：逐文件结果 ＋ 覆盖冲突错误。
- `RegistryEdit`：判别联合（`setAvailable` / `setSysPrompt` / `remapAlias` / `addAlias` / `deleteAlias` / `addModel` / `deleteModel`）。
- `AgentDocPort`（12 票接线用）：`read(agentName)` / `commit(dirty)` / `invalidate`。

**Acceptance criteria:**
- [x] 接口 ≤ 6 成员；`plan` 纯函数（同输入同输出）；`commit` 原子写 ＋ 写后重校验 ＋ 覆盖冲突错误。
- [x] D14 往返：手写 front-matter（含注释、未知键、键序）经 compose → plan → commit 后除实际编辑部分外逐字节不变。
- [x] 主线只有一份序列化实现、一份 frontmatter 模型、一份 registry 层类型（`AliasRegistrySource`）。
- [x] `compose` 的块只有 `frontmatter` / `prose`；`plan` 不按 kind 路由到多文件。
- [x] 删除 `disabled`、伪 offset、伪文件名占位串、伪造行数；`AgentDiagnostic` / `AliasFinding` 分族，归一化视图带 `origin`。
- [x] 内存适配器与 HTTP 适配器同接口；组件不 import fixtures（12/13 验收）（内存适配器 `createInMemoryControlCore` 已交付；HTTP 适配器与组件约束由 12/13 各自票验收）。
- [x] 三处「零运行时依赖」注释与 `package.json` 一致；原型分支不合并。
- [x] `pnpm run check` 全绿（含 `hostRuntimeDeps`）；术语表按 v1 范围更新（不引入切片/装配源术语）。
- [x] 视觉/交互不在本票验收内（05 负责）。
- [x] 新增第三方运行时依赖（js-yaml / zod 等）前，先修订 `scripts/check.mjs` 的矩阵规则（else 分支现拒 `src/` 一切外部 import；票 16 复核记入）（本票未新增运行时依赖——未引 js-yaml/zod，义务未触发；矩阵已加 control 层）。
- [x] 收拢两个 Dependencies 接口重复的 fs 依赖三件套（`resolveFileSystem` / `nodeFileSystem` / `warn`）为共享基类型（票 16 复核 Data Clumps 记账；本票必动这些接口，顺手收）（`FileSystemDependencies` 落于 `src/core/ports.ts`）。

**Out of scope:**
- 切片 / include / `.sections/`（Q1=B：v1 单文件 body）。
- 装配源编辑器（prototype 的长期意图）与跨 harness 转换器、provider、动态模式、中性工具 id、omit 策略——全部延后（14/15 未建）。
- `ctx.webServer` 路由与 client 接线（12）、前端测试（13）、UI 组件实现与 `MasterDetailPane`（05）。
- 冻结读面的类型修改（新形状进新文件）。
- 03 的链解析引擎语义。

**Q6（已裁决 2026-10-18 = A）：** 写器归本票、通道归 12、`MasterDetailPane` 归 05/13；05 已改指针并加 `Blocked by: 11, 12`。
