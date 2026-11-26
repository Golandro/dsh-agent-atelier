# 系统提示词预览索引（过渡）

> **状态：规格已定，实施未开工（2026-11-25）**。本文是索引页：把「概念 → 词条 → 契约符号 → 消费方 → 状态」对齐，**不复述词义、不内联签名**。
>
> **权威顺序**：语义以 [GLOSSARY](../../GLOSSARY.md) 为准；数据来源裁决以 [ADR-0009](../adr/0009-prompt-preview-data-source.md) 为准；装配协议以 [assembly.ts](../../src/contract/assembly.ts) 为准；分段契约以规格 [issue #82](https://github.com/Golandro/dsh-agent-atelier/issues/82) 为准。
>
> **退役条件**：替换模式包落地、或装配读面迁进包文档时，本文并入包文档并删除。与 [agent-assembly.md](./agent-assembly.md) 同一生命周期。

## 1. 阅读路径

| 你想做什么 | 先读什么 |
|---|---|
| 改分段的含义 | [规格 #82](https://github.com/Golandro/dsh-agent-atelier/issues/82) |
| 改数据来源 | [ADR-0009](../adr/0009-prompt-preview-data-source.md) |
| 查为什么不能事后归因 | `docs/research/2026-11-24-prompt-assembly-attribution.md`（分支 `research/prompt-assembly-attribution`） |
| 查配置层能写什么 | `docs/research/2026-11-24-prompt-source-enumeration.md`（分支 `research/prompt-source-enumeration`） |
| 查装配本身 | [agent-assembly.md](./agent-assembly.md) |

## 2. 概念索引

| 概念 | 一句话角色 | 契约 / 代码符号 | 状态 |
|---|---|---|---|
| 来源（Source） | 一级分段轴：7 条注册者角色 | `PromptSourceId` / `PROMPT_SOURCE_ORDER`（`src/contract/prompt-preview.ts`） | 已实现（票 84） |
| 层（Layer） | registry 的工作区 / 用户 / 内置，**不是**来源 | `RegistrySource` | 既有 |
| 段内块（Part） | 一个节内部的子块（工具说明打包） | `PromptPart` / `PromptSegmentParts`（`src/contract/prompt-preview.ts`）；`promptSegmentParts` | 已实现（投影侧） |
| 分段视图 | 宿主装配产物 + 账本 → 按来源分组 | `PromptSegmentsView` / `PromptSegment` / `PromptSourceGroup`（`src/contract/prompt-preview.ts`）；`buildPromptSegments`（`src/assembly/segments.ts`） | 已实现（票 84） |
| 注册侧账本 | 注册方自己记「注册了哪些节、每节有哪些子块」 | `PromptLedger` / `createPromptLedger`（`src/assembly/ledger.ts`）；记录形状 `PromptSectionLedgerEntry` | 已实现（票 84，只记 executable 行） |
| 预览读面 | 只读 route，跑一次真实 `assemble()` | `PromptPreviewResponse`（`src/contract/prompt-preview-route.ts`）；`preview()`（`src/dsh/host/prompt-preview.ts`） | 已实现（票 83） |
| 降级矩阵 | 4 档：完整 / 链耗尽 / 静态回退 / 空态 | `PromptPreviewTier` / `PromptPreviewDegradation`；`previewTierOf`（`src/client/chunks/registry/prompt-preview-model.ts`） | 已实现（票 83/85） |
| 渲染信封 | 客户端只渲染已投影好的分段 | `PromptPreviewView` / `PromptPreviewHandler`（`src/contract/prompt-preview-route.ts`） | 已实现（票 85） |

## 3. 与装配的关系

预览是**同一装配面的读侧**：

- 装配（写侧）：规划器 → sink 注册 → 宿主装配。见 [agent-assembly.md](./agent-assembly.md)。
- 预览（读侧）：宿主装配产物 → 分段投影 → UI。

两者共用同一套来源词汇与同一份 `PromptAssembly` 形状；预览**不重跑装配逻辑**，只读宿主产物。

## 4. 不变量

1. **不重跑层合并**：预览消费宿主已解析结果，不在客户端重算（对齐 #13 必删项）。
2. **不事后归因**：贡献者只能来自注册侧账本。
3. **只增不改**：完全模式的扩展是宽子类型，基础成员语义不变。
4. **不撒谎**：被 waterfall 改写的段必须标注；遮蔽关系不可见时必须说「不可见」。