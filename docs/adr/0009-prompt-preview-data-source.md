# 0009 — 提示词预览的数据来源：宿主装配产物优先，静态 config 回退

Map #74 裁决（#75 / #77）。系统提示词预览要展示「这段是谁加的」，而**贡献者身份在装配产物里不存在**。

## 背景

- 宿主 `ctx.systemPrompt.assemble()` 返回的 `PromptPresentation` 只有 `{name, text, interpolate}`（`.vendor/deepseek-harness/packages/core/system-prompt/src/index.ts:93-134`），没有贡献者字段。
- waterfall 的入参是可变的，handler 可任意增删改，且**没有任何 per-handler 审计面**（本包日志 0 命中；`system-prompt/change` 无 payload 且只在注册时触发）。
- `complete` 节会把结果压成单节，waterfall 对 sections 的增删改被整体丢弃。
- scoped 遮蔽在**求值前**生效，被覆盖者的 text provider 一次都没被调用——不是丢弃，是未发生。

详见研究 `docs/research/2026-11-24-prompt-assembly-attribution.md`（分支 `research/prompt-assembly-attribution`）。

## 决策

**预览的数据来源 = 宿主 `assemble()` 的产物优先，静态 config 回退。**

1. **优先**：新增只读 route，在目标 agent 的 scope 上真实跑一次 `assemble()`（含 `tools.resolve()`），拿 `PromptAssembly`。
2. **归因**：来源由**注册侧账本**提供（注册方自己记「我注册了哪些节、每节有哪些子块」），不由装配产物反推。
3. **回退**：宿主面不可用时，退成「补丁合成后的原始 `system-prompt` 行 config + 本仓 `AssemblyPlan`」，并显式标注「非宿主装配结果」。

## 后果

- **预览是只读调用但不是无副作用调用**：它会执行全部 waterfall handler（记忆改写类插件就在这里改文本）。这一条进契约、进 UI 标注。
- 「被遮蔽」只能由自带账本的注册方展示；宿主节的遮蔽关系显示为「不可见」，不猜。
- 段内拆分（工具说明打包成一段）在兼容模式靠账本、在完全模式靠 `PromptSection.parts` 原语；两者都在 systemPrompt 系统内，不另立平行体系。
- 完全模式保留同名 `assemble()`，provenance 走返回值的扩展字段——守 ADR-0006「只增不改 / 无能力探测」。

## Considered Options

- **从 `PromptPresentation` 反推贡献者**：否决——没有贡献者字段，且 waterfall 之后 name 与注册名不再一一对应。
- **只读 session log 的 `system/message`**：否决——那是渲染后整段文本，不分段，且代表「上次实际发出」而非「现在会发出」。
- **只做静态 config 预览**：否决——看不到宿主注册的节（identity / 工具说明 / runtime context），也看不到 waterfall 结果。
