# 07 — 召唤工具与原生替换

Status: ready-for-agent
Type: task
Blocked by: 10, 03, 04, 06

## 范围

AI 面入口替换 + spawn 委托（spec §7，里程碑 MS4）：

1. **`summon_agent` 工具**（自有名注册，零冲突）：
   - 参数：`agent`（可见 agent 枚举）、`brief`（自由文本，v1 标准策略——就像用户 Prompt）、`flavor`（spawn|fork，默认取 agent.md `spawn` 字段）、`run_in_background`。
   - 委托：`ctx.subagents.start('spawn'|'fork', request)`（Agency 先例 `AGENCY/lib/src-DhS1geoQ.js:3356-3368/:3383-3401`）；request = `{prompt: brief, parent, signal, persona, toolFilter, maxDepth, agentOptions:{provider, model, reasoningEffort}}`（`subagent/src/types.ts:145-201`；reasoningEffort 在 agentOptions 内）。
   - 能力门控：provider `capabilities.persona/.toolFilter/.depthLimit` 不满足则降级并说明。
   - 子代理 toolFilter **deny `summon_agent` 自身**（防深度爆炸，Agency 先例）+ maxDepth。
   - 03 解析失败（链耗尽）⇒ isError 回显链；requiredTools 超界 ⇒ **警告放行不阻断**。
2. **原生替换**（spec D15）：
   - `system-prompt/assemble` waterfall（返回值 authoritative，`core/system-prompt/src/index.ts:625-628`；树内先例 `context/session-reference/src/index.ts:127-134`）把原生 `subagent`/`subagent_fork` 的 schema 从 AI 可见面过滤。
   - `keepNativeSubagentTools: true` 配置开关停止过滤 = 兼容回退。
   - 兼容桥：`summon_agent(agent=default)` ≡ 原生 subagent 调用——替换无能力损失。
   - 已知限制（v1）：主 Agent 暂失原生条件性 per-call 模型参数（`tool-subagent/src/index.ts:379-428` 的 provider/model），v2 pin 解决。

## 验收

- e2e：召唤带人设、别名回退、原生入口被过滤、开关还原、链耗尽 isError、default 等价原生。

## Comments

- 来源：grilling 共识 D15 + 探员 4 事实（同名影子判死：同层 throw + 本 profile 原生 per-agent 挂载）。
