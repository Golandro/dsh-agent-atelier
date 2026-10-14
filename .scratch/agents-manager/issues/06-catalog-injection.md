# 06 — 目录注入与可见性警告

Status: ready-for-agent
Type: task
Blocked by: 10, 01, 02

## 范围

把 agent/别名注册表注入主 Agent 上下文，并呈现警告（spec §6、§8）：

1. **`<available_agents>` + `<available_models>` digest 门控 user 消息**——照抄 tool-skill 模式（`skill/tool-skill/src/index.ts:213-251`）：
   - `agent/pre-step` waterfall（`core/agent/src/runtime-types.ts:320`）内构建条目：别名名 + 意图标签 + agent 名/描述 + modelOrder（**只含别名名，永不出现真实 provider/model**——注入名稳定）。
   - sha256 对**条目列表 JSON**（非渲染文本）做 digest（`:328-335`）；digest 相等 ⇒ 不追加、替换过期 offered 消息；变化 ⇒ 首次追加 / 按 `message.id` 替换（`:231-250`）。
   - 注册表不变（如仅别名重映射不改变目录内容时）⇒ 不发新消息 ⇒ 主 Agent 前缀缓存不断——这是"注入名稳定"的机制化（spec D6）。
   - 机器可读载荷参照 `source:{kind:'skill-catalog',…}`（`:271-275`）设计 `source:{kind:'agents-catalog',…}`。
2. **requiredTools 警告**：每个 agent 的 `requiredTools` 与 `ctx.tools.schemas(agent)`（effective 校验源，`core/tools/src/index.ts:1260`）比对；超界 agent **仍出现在目录**，但带紧凑警告（缺哪些工具）——**不隐藏、不阻断召唤**（spec D9：工具可回退/动态，硬保证做不到）。
3. **mode 显示**：当前 preset（`ctx.agentPresets.composedPreset(ctx)`，`preset/agent-preset-registry/src/index.ts:290`）随目录展示，解释工具集来源。

## 验收

- 单测：digest 门控（内容不变不发、变更按 id 替换）、requiredTools 比对警告、目录不含真实模型名。

## Comments

- 来源：grilling 共识 D6/D9/D12（spec §2.2）。
