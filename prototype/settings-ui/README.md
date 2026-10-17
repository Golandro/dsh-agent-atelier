# 智能体控制页 — UI 设计原型（PROTOTYPE，一次性）

> 一次性原型，验证后即弃。回答的问题是「**这页 UI 长什么样、怎么交互**」，不是生产代码。
> 对应票据：`.scratch/agents-manager/issues/05-settings-ui.md`。

## 运行

```bash
pnpm proto        # 启动 Vite 开发服务器（支持热更新）
# → http://localhost:4188/
pnpm proto:build  # 自动构建到 dist/
pnpm proto:preview # 预览 dist/ 构建结果
```

TS/TSX、CSS 修改会由 Vite 自动处理并热更新。无持久化：全部状态在内存，刷新即重置。

## 变体（URL 可分享）

- `?advisor=drawer`（默认）：顾问面板 = Agents 页右抽屉（P1 标注的 B 区右侧）。
- `?advisor=tab`：顾问面板 = 独立页签。
- 底部浮动条随时切换，并同步进 URL；`?tab=sections|models|prompts` 可直达页签。页签名为中文：智能体 / 提示切片 / 模型关联 / 系统提示词。

## 数据结构（交付物之一）

`src/types.ts`：镜像冻结契约（`AgentSource` / `AgentFrontmatter` 全字段 / `ModelDef` / `AliasDef` / `Finding`）+ 本原型新增的 **P1 组合文档模型**（`DocBlock` / `BlockRange` / `ComposedDocument` / `FileWrite`）。`src/model.ts` 是纯函数：组合文档、校验（02 四类 + 警告项）、解析链、断点推演、保存回写、S5 影响预览。

## P1 标注还原点

- **A 区**：Agent List 走资源管理器「内容」排布——每行两行：第 1 行来源标签 / Agent 名称 / 弹性空白 / 路径 / 状态，第 2 行 Agent 摘要 / 模型链、工具、技能、spawn、reasoning。「内容」两行全显，「紧凑」只留第 1 行（视图级折叠），均为扁平行、无卡片外壳，行内不再提供展开/折叠按钮。状态：无诊断为绿色圆点，有诊断为红/黄徽标，禁用为灰色圆点。搜索 / 层级筛选 / 仅问题 / 排序（名称、层级、诊断、模型数）由 `@tanstack/react-table` v9 的 globalFilter / columnFilters / sorting 执行；查询接口仍是 `types.ts` 的 `AgentListQuery`，`model.ts` 的 `queryAgents` 保留为纯函数参考实现。`fixtures.ts` 含超长名称/路径/摘要/属性与禁用态样例。
- **布局**：Agent List 与 Editor 之间可拖拽分栏，分隔条 cursor = `ew-resize`，拖拽坐标按 `.agents-page` 父容器换算；列表最小 20rem（≈320px，默认 24rem）、编辑器最小 40rem（≈640px），分隔条 0.375rem。放不下（< 60.375rem ≈ 966px，并扣除顾问抽屉宽度）时 Editor 改为浮层覆盖 List；双击分隔条复位到默认 24rem（受可用宽度限制）。Editor 可关闭，窄屏默认先显示 List；不满足并列宽度时列表始终纵向排列，不做横向卡片条。
- **B 区**：Agent Edit 组合文本编辑器（单个 CodeMirror 6 文档）——front-matter 与 prose / clip 按块组织在同一个文档里。实际定义文件中的 `{% include clip <name> %}` 模板行原地渲染为 clip header（type 暂只支持 clip），clip 文件内容内联在该行之后；front-matter 在 `---` 上方有同样的 header。**所有内容默认直接可编辑**；header 显示全局行范围、来源、落盘文件与未保存状态，可**分块保存 / 回退**，也可在工具栏一次保存全部脏块（一次回写涉及的每个文件，见 Inspector 的「最近写入」）。编辑器头部固定两行：第一行是 agent 名称、落盘路径与复制 / 详情工具（详情弹层汇总层级、块统计、未保存数与复制动作），第二行是折叠、回退与保存；模型链解析只在顾问面板展示，不占用编辑器头部。窗格变窄时按优先级压缩而不整组隐藏：文案先换短，路径左截断优先保留文件名；更窄时路径与复制让位给详情弹层，折叠上移到第一行，第二行只留未保存状态与写盘动作。header 的 chrome（文件 / 状态 / 行范围 / 按钮）是不可选中的 widget，而模板行本身仍是文档文本——跨切片选取复制时不会带上 header chrome，但会带上 `{% include ... %}` 模板标识。**折叠切片 / 展开切片**（compact 状态）与每个 clip header 左侧 CodeMirror gutter 的折叠按钮都只折叠显示，不影响草稿与整块保存语义；折叠由 CodeMirror 的 gutter + replace decoration 实现。
- 顶栏：workspace 选择器、`+ Add Prompt Section ▾`、`+ Add Agent ▾`；页签行右缘 `Edit Tools ⋯`（顾问面板 / 模拟外部改文件 / invalidate 重读）。

## 自行发挥部分

- **Prompt Sections**：列表 + 详情的主从布局。列表复用 Agent 面板的 `ListPane` 外壳（同一套粘性头部 / 计数 / 工具区，标题动作与搜索筛选排序均由插槽注入），分隔条复用 `PaneSplitter`，分栏策略与 Agent 页共用 `usePaneLayout`（同样的 20rem / 40rem 最小值与浮层阈值）；详情可关闭（× / 返回），关闭后列表占满并保持可读宽度，放不下时详情改为浮层。详情含层解析、被遮蔽文件、引用语法与只读预览；引用统计只给类别与数目（`Agent ×N`），有引用时「删除」换成「引用列表」（可直接跳到引用方），未引用条目才显示「删除」。
- **模型关联**：别名与模型集合的 registry 管理（主从双栏，复用 `ListPane` / `PaneSplitter` / `usePaneLayout`）。空间切换 = registry 的层：工作区（`.dsh/agents/registry.yaml`）/ 用户（`~/.dsh/agents/registry.yaml`）/ 合并；合并视图按层解析后展示生效条目，工作区同名条目胜，行上标「遮蔽 / 覆盖 / 被覆盖」。别名页以「别名 → 模型条目 → agent」关联链为主：解析目标、重映射即时影响（S5）、同指向 fan-in、使用者跳转；模型页给 available 开关、被别名指向、触达 agent 与 sysPrompt 预览。新增条目写入当前空间（合并视图落工作区）；有引用且有下层同名时允许删除并由下层接管，否则「删除」换成「引用列表」；dsh-default 内置只读。
- **系统提示词**：只保留 per-model 系统提示词调优（D6）。模型集合、available 与别名映射已统一到「模型关联」，本页每个模型名只展示生效层（工作区覆盖用户层），并支持从模型关联页跳转后高亮定位。
- **顾问面板**（Q2 最小口径）：校验发现 / §6 通道表 + 断点推演（切 Agent vs 切模型）/ S5 即时影响预览 / fork 断点知识库 / D10 顺序反模式。
- **Inspector**（原型规则：状态可见）：虚拟文件系统 + 最近写入 + 操作日志。

## 开放问题（回票据裁决）

1. **clip 模板的落盘布局**：引用语法已定为 `{% include clip <name> %}`（type 暂只支持 clip）；clip 内容仍按 `sections/<name>.md` 独立成文件（原型提案）。01 冻结契约的 body 是单文件——要不要引入切片文件，需裁决（可能另立票）。
2. **front-matter 编辑形态**：P1 标注是「文本编辑器」，原型按 raw 文本编辑演示（不解析往返）；验收要求字段 1:1——正式实现要 D23 解析器往返或字段表单，二选一。
3. **顾问面板放置**：drawer vs tab，用底部浮动条对比体验后定。
4. **主题**：DSH core 暗色是近黑（`#151517`）不是藏青；截图的藏青感来自未启用的 whale-song 皮肤。要强藏青只调 `--dsh-bg` / `--dsh-bg-panel` 两个 token（见 `styles/dsh-theme.css` 头注释）。

## 演示简化（不算数的地方）

- front-matter 存文本不解析回字段（卡片上的字段标签不随编辑更新）。
- 单编辑器使用全局行号；header 中的 L 范围随输入实时重算。
- 无文件 watcher（D24）：用「模拟外部改文件」+ invalidate 演示失效路径。
- 重命名切片不自动改引用方（故意演示悬空引用诊断）。
