# 04 — Prompt 组装与通道放置

Status: ready-for-agent
Type: task
Blocked by: 10, 03

## 范围

实现组装规划器（纯函数）+ 运行时节注册（spec §6）：

1. **纯函数规划器**：输入 = agent + 解析结果 + 通道配置；输出 = 节列表（`{channel, name, order, variesWith, text}`）+ 缓存断点计算（每维度断点 = 第一个依赖该维度的节）。断点算法承原型 `cacheAnalysis`，通道维度扩展为 ①system 节 / ②digest user 消息 / ③pre-step / ④tools 字段 / ⑤首消息。**规划器输出同时供 UI 顾问面板（05）与警告（06）复用。**
2. **运行时注册**：
   - per-model 系统提示词 → `ctx.systemPrompt.section`，order **低于 persona**（persona 节点 order=0，参照 `subagent/src/child-agent.ts:200` 的 deployment:persona-prefix）；先例：`installModelSelection` 经 assemble waterfall 注入 `{{provider}}/{{model}}`（`core/agent/src/model-selection.ts:67`）。
   - persona → `deployment:persona-prefix`（委托原生机制，不重复发明）。
   - includes → 紧随 persona 的 system 节。
3. **顺序治理**（spec D10）：推荐顺序 = 变维度分层（model-sys → mode/tools → persona → includes）；允许全局覆盖配置；缓存反模式 lint（易变节排稳定节之前且未声明 cacheIsolated → 警告）。
4. 通道选择即缓存策略：②通道内容变化才断、③⑤天然尾巴——知识写进 UI 顾问面板文案。

## 验收

- 单测：节序快照（默认顺序、覆盖顺序）、断点计算、反模式 lint。
- fork 头部断点陷阱（spec §2.1-4）出现在顾问面板知识库。

## Comments

- 来源：grilling 共识 D10/D11/D12（spec §2.2、§6）。核心修正：不是一条线性字符串，是注册表+四通道+首消息。
