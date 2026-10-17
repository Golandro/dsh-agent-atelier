# 11 — 控制核心与原型收敛（深模块化，后端优先）

Status: needs-triage
Type: task
Blocked by: —

## 背景与来源

`/codebase-design` 分析（2026-10-17，AI／两个只读子代理）＋ 一次原型（分支 `proto/settings-ui`，throwaway）的验证结论。本票是 **05 票的后端优先第一刀**：把原型验证过的行为收敛成宿主侧一个**深模块**（小接口 ＋ 大行为），纠正原型相对冻结契约的数据形状偏差，并补上宿主目前**完全缺失的写面**。12（接线）与 13（前端测试）依赖本票冻结的接口。

参考实现（不进主线）：分支 `proto/settings-ui` 的 `prototype/settings-ui/src/` 下 `App.tsx`、`model.ts`、`types.ts`、`pane-layout.ts`、`components/DocumentEditor.tsx`。

**目标假设**：本票目标是**主线**（`src/`），原型保持 throwaway。若维护者要的是「继续打磨原型本身」，请回退本票并把目标改指 `proto/settings-ui`（下面的深浅判定同样适用，但那时不需要与冻结契约对齐）。

## 宿主现状（动工前必须知道）

- 读面已存在、已冻结：`parseAgentDocument`（`src/frontmatter.ts:84`）、`AgentFrontmatter`（`src/frontmatter.ts:22`）、`readRegistryLayer`（`src/registry-file.ts:104`）、两个服务在 `src/index.ts:45` 的 `apply` 里注册（`ctx.agentRegistry` / `ctx.aliasRegistry`）。
- **写面完全不存在**：全 `src/` 无 `writeFile` / `rename` / 原子写（grep 为空）。原型的 `serializeFrontmatter` 是唯一的序列化实现，且只认识已知键 ＋ `extra` 原文、无转义、不可往返（D14 要求原文回写）。
- **原型不在 `tsconfig.json` 的 include**（`"include": ["src", "test"]`）⇒ 原型的类型漂移不受 `pnpm run check` 保护，两套同名类型长期共存无人报警。
- 「零运行时依赖」的注释在 `src/frontmatter.ts:6`、`src/yaml-scalar.ts:6`、`src/registry-file.ts:15` 已与 2026-10-17 的依赖裁决（`js-yaml` / `zod` 保留在 `dependencies`）不一致，但代码仍未引用这两个包 ⇒ 本票要么用它们实现写面/校验，要么把声明去掉，不要让注释与 `package.json` 打架。

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
| `AgentDoc.frontmatter: AgentFrontmatter` 嵌套 ＋ `extra` | `AgentDefinition` 是**扁平**的（`src/types.ts:54`）；宿主已有 `AgentFrontmatter`（`src/frontmatter.ts:22`）与 `parseAgentDocument`（`src/frontmatter.ts:84`） | 主线不得出现第二份 frontmatter 模型；编辑器要的原始 YAML 以显式字段（如 `frontmatterText`）出现在 compose 输出 |
| registry 层复用 `AgentSource`（含 `'bundled'`） | registry 层是 `AliasRegistrySource`（`src/types.ts:132`），只 3 值 | 原型 `SOURCE_RANK` 混两套方言；主线直接用 `ModelDefinition`（`src/types.ts:153`）/ `AliasDefinition`（`src/types.ts:169`） |
| `Finding` 合成三族（4 别名码 ＋ 2 新增警告码） | `AgentDiagnostic`（7 码，`src/types.ts:37`）与 `AliasFinding`（4 码，`src/types.ts:252`）分族 | 核心派生**一个归一化视图类型**（带 `origin` 判别），UI 不得自行归并 |
| `AgentDoc.disabled?: boolean` | 契约无此字段；05 票 Q1 裁决启停 v1 不做 | 删除，不得进主线 |
| `PromptClip` / `DocBlock` / `BlockRange` | 无冻结契约（P1 提案） | **动工前必须裁决**（Q1）；裁决后先冻结形状再实现 |
| `ComposedDocument.text` ＋ `ranges`（编辑器字符偏移） | 域概念里不存在 | 偏移属**编辑器视图模型**；域形状只有 `blocks[]` ＋ `frontmatterText` |
| `ComposedDocument` 缺 `source` / `origin` / `readonly` | 冻结侧一律显式（`?: T \| undefined`，`exactOptionalPropertyTypes` 下原型的 `?` 形式不兼容） | 域形状显式携带身份字段；`readonly` 由 `origin`/`source` 派生，不再由 JSX 里 `source === 'bundled'` 现推 |
| 位置/索引当标识 | — | `ranges[block.id] ?? {from:0,to:0}` 的伪造 offset、按数组下标比结构、把 `L7–12` 当块身份，全部移除 |

### 其他

- **原型专用依赖进了运行时 `dependencies`**：`codemirror` / `@codemirror/*` / `@tanstack/react-table`（连同 `js-yaml` / `zod`）会装进任何使用者的 profile。主线按 ADR-0001 ＋ `hostRuntimeDeps` 判定重新归置。
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
11. `MasterDetailPane`：吸收 `ListPane` ＋ `PaneSplitter` ＋ `usePaneLayout` ＋ 选中修复 ＋ 键盘/`data-*` 选择器；消掉 3 个 CSS 变量名，统一「空列表时选中如何处置」，顺手删掉两个 18 行转发器。
12. `EntityKey`（`entryKey` / `clipKey` / `parseKey`）：把 `clip-${name}` 这类存储编码收进一处，修掉「视图相关键」漏进组件。

**两个适配器 ⇒ 真 seam**：内存适配器（测试 ＋ 原型演示）与宿主 HTTP 适配器（12 票落地）。一个适配器只是假想 seam，故本票必须同时给出内存适配器。

## 范围

1. 冻结接口形状（回写 `## 契约（冻结）`），实现宿主侧核心：纯逻辑 ＋ 注入 fs 端口；`@deepseek-ai/*` 一律不 import（ADR-0001）。
2. **补写面**：与既有读者配套的序列化/回写的唯一实现（D14 原文回写、注释与未知键保留），用 `js-yaml` / `zod` 或扩展现有 `yaml-scalar.ts`，二选一但只留一份。
3. 按上表迁移域规则、去重、去漂移；删除 `disabled`、`Finding` 归并模型、平行的 frontmatter 模型、伪造 offset/file/lines。
4. 抽出上述内部 seam（编辑器视图模型、写计划、列表查询求值器、分栏纯函数）。
5. 依赖归置：原型专用包移出运行时 `dependencies`；修掉三处「零运行时依赖」注释与 `package.json` 的矛盾。
6. 更新 `CONTEXT.md` 术语（组合文档 / 块 / 写入计划），必要时补 ADR。

**不含**：`ctx.webServer` 路由与 client 接线（12）、前端测试（13）、UI 组件实现本身（05）。

## 动工前必须裁决

- **Q1（阻断）clip 切片模型**：`{% include clip <name> %}` 模板 ＋ `sections/<name>.md` 独立文件是原型提案，而 01 冻结契约的 body 是单文件。三选一：(A) 引入切片文件并冻结新契约（01 需修订）；(B) 只做单文件 body，不引入切片（`compose` 退化为 frontmatter ＋ body 两块）；(C) 切片只存在于 UI 概念层、落盘保持单文件。**推荐 (A)**——P1 标注的「编辑 Clip 保存时改涉及的所有 clip 文件」只有切片成文件才成立；但这是产品决定，不是实现细节。
- **Q2 front-matter 编辑形态**：(A) 文本编辑 ＋ 写前用 D23 解析器校验、按原文回写（保注释/未知键）；(B) 字段表单（每字段一个控件，写入时序列化）。**推荐 (A)**——与 P1 标注一致，且 D14 的 1:1 回写只有文本形态能满足。
- **Q3 归属**：本票与 05 的关系。**推荐**：本票 = 05 的后端优先第一刀，05 的 brief 继续有效并收到本票指针。

裁决后本票转 `ready-for-agent`。

## 验收

- [ ] 契约冻结并回写本票 `## 契约（冻结）`；`src/types.ts` 未被改动（新形状进新文件）
- [ ] 核心接口成员 ≤ 6；内部纯函数可单独测试（internal seam）
- [ ] 写面存在且与既有读者配对：往返不丢注释/未知键（D14），有原子写与失败路径
- [ ] 主线无第二份 frontmatter / registry 解析模型；registry 层类型用 `AliasRegistrySource`
- [ ] `AgentDiagnostic` 与 `AliasFinding` 分族保留，归一化视图带 `origin` 判别
- [ ] 模板行语法、分隔行规则、行号口径、脏口径、块→文件路由各只有**一份**实现
- [ ] 主线不存在 `disabled`、`Finding` 归并模型、伪造的 offset / file 占位串 / `lines`
- [ ] `plan()` 是纯函数（同输入同输出）；`commit()` 覆盖冲突有明确错误
- [ ] 原型专用依赖不在运行时 `dependencies`；三处「零运行时依赖」注释与 `package.json` 一致
- [ ] `pnpm run check` 全绿（含 `hostRuntimeDeps` 判定）；`CONTEXT.md` 术语更新；原型分支不合并

## 已知约束

- 沙箱内不做依赖变更（pnpm store 陷阱 ＋ 敏感操作，见 `docs/agents/harness-facts.md`）；需要新依赖时由维护者在沙箱外安装。
- 写盘面必须与 05 票的 Q3-A 通道定案一致（宿主自管文件；client 只经 12 票的 HTTP 适配器）。
- 01/02 的冻结读面**只读**：`ctx.agentRegistry`（`src/types.ts:112`）与 `ctx.aliasRegistry`（`src/types.ts:219`）不因本票而改；本票只加写面与组合面。
- CodeMirror 侧的可测性阻断点已定位：StateField 构造依赖 React ref/callback（`DocumentEditor.tsx` 行 452–453），改成普通参数后该文件约 409 行可在 Node 里 headless 测（`@codemirror/state` 本身 DOM-free）——这条给 13 票用。
- **链解析归 03，不归本票**：`modelOrder` → 别名 → 模型条目的解析、`available: false` 的跳过与沿声明顺序回退、链耗尽硬错，都是 03 票解析引擎的语义。本票的 `snapshot` 只消费其结果（链展示与 findings）；若动工时 03 尚未落地，本票**不**自行实现一套平行解析器，宁可在 UI 上显式标注「链解析待 03」。原型的三处 `available` 断言无实现支撑（见上），正是「UI 抢了引擎职责」的后果。
- **层合并不许 UI 重算**：接通后必须删掉 UI 侧的重算（原型 `model.ts` 行 137–148），因为宿主 `ctx.aliasRegistry.getAlias` / `getModel`（`src/types.ts:219`）已经解析过层；否则两份真相必然漂移。

## Comments

- 来源：`/codebase-design` 分析请求（2026-10-17，维护者：「Prototype 实现的分析…后端优先、尊重数据结构、尽可能优化」）；两个只读子代理分别产出编辑器核心与列表/模型关联页的结构证据。
- 参考实现：分支 `proto/settings-ui`（throwaway）；05 票已挂该分支的指针。
