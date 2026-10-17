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
- 底部浮动条随时切换，并同步进 URL；`?tab=sections|prompts` 可直达页签。

## 数据结构（交付物之一）

`src/types.ts`：镜像冻结契约（`AgentSource` / `AgentFrontmatter` 全字段 / `ModelDef` / `AliasDef` / `Finding`）+ 本原型新增的 **P1 组合文档模型**（`DocBlock` / `ComposedDocument` / `ComposedRow` / `FileWrite`）。`src/model.ts` 是纯函数：组合文档、校验（02 四类 + 警告项）、解析链、断点推演、保存回写、S5 影响预览。

## P1 标注还原点

- **A 区**：Agent List 卡片（层标签 workspace/user/bundled + 诊断徽标）。
- **B 区**：Agent Edit 组合文本编辑器——front-matter 块打头；body 的 `$ clip-name` 引用行展开为 clip 块（header 行 + 内容行）；块间强制空行 = 各块 Header；行号全局连续；**保存一次回写涉及的每个文件**（见 Inspector 的「最近写入」）；**compact 开关**折叠 clip 内容只留 header（行号重算）。
- 顶栏：workspace 选择器、`+ Add Prompt Section ▾`、`+ Add Agent ▾`；页签行右缘 `Edit Tools ⋯`（顾问面板 / 模拟外部改文件 / invalidate 重读）。

## 自行发挥部分

- **Prompt Sections**：切片库（层遮蔽、引用方 chips、未引用态；有引用时禁删/禁改名——安全性演示）。
- **System Prompts**：左列 per-model 系统提示词（D6）+ available 开关（Q1：v1 手动）；右列别名→模型条目映射（S5 改目标，dsh-default 只读卡）。
- **顾问面板**（Q2 最小口径）：校验发现 / §6 通道表 + 断点推演（切 Agent vs 切模型）/ S5 即时影响预览 / fork 断点知识库 / D10 顺序反模式。
- **Inspector**（原型规则：状态可见）：虚拟文件系统 + 最近写入 + 操作日志。

## 开放问题（回票据裁决）

1. **clip 引用语法与落盘布局**：`$ name` 行 + `sections/<name>.md` 是原型提案，01 冻结契约的 body 是单文件——要不要引入切片文件，需裁决（可能另立票）。
2. **front-matter 编辑形态**：P1 标注是「文本编辑器」，原型按 raw 文本编辑演示（不解析往返）；验收要求字段 1:1——正式实现要 D23 解析器往返或字段表单，二选一。
3. **顾问面板放置**：drawer vs tab，用底部浮动条对比体验后定。
4. **主题**：DSH core 暗色是近黑（`#151517`）不是藏青；截图的藏青感来自未启用的 whale-song 皮肤。要强藏青只调 `--dsh-bg` / `--dsh-bg-panel` 两个 token（见 `styles/dsh-theme.css` 头注释）。

## 演示简化（不算数的地方）

- 编辑中的行号不随 textarea 实际高度流动（显示静态范围）。
- front-matter 存文本不解析回字段（卡片上的字段标签不随编辑更新）。
- 无文件 watcher（D24）：用「模拟外部改文件」+ invalidate 演示失效路径。
- 重命名切片不自动改引用方（故意演示悬空引用诊断）。
