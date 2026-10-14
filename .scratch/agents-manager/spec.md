# Agents Manager — 设计 Roadmap（spec）

> 状态：grilling 已收敛（四轮问答 + 4 个源码探员），共识已确认。本文件 = spec + roadmap；分模块票据在 `issues/`；wayfinding map 在 `map.md`。
> 原型参照：`agent-control-prototype.html`（其纯逻辑模块提升为解析引擎的规格参照，保留于仓库根）。

## 1. 背景与目标

DSH 没有面向用户的「Agent（专家）」层：子代理不带预设人设，主 Agent 每次都要把人设与要求手搓进首条消息。本插件（工作名 **agents-manager**）补上这一层，并与模型控制**正交**：

- **Agent 层**：`agent.md` 定义的专家（人设、模型选用顺序、所需工具），与内置「默认」（= DSH 原生行为）并列。
- **模型层**：**别名**把"注入上下文的名字"与真实 provider/model 解耦；Agent 声明模型选用顺序，支持故障回退。
- **组装层**：子代理 Prompt 由命名节按**通道**组装（不是一条线性字符串）；顺序有推荐方案（按变维度分层，为 provider 前缀缓存复用优化），也允许自由自定义（代价以警告呈现）。
- **产品边界**：插件**只管、且深度管会话启动参数**（persona / 模型链 / 工具过滤 / prompt 组装 / 首条消息）；运行时工作流一律委托 DSH 原生机制（"大量委托原版实现"）。

原型的验证问题——"agent.md 人设 + 模型别名 + 面向缓存的段序 + 基于工具的可见性过滤，这套正交模型手感对吗"——经事实修正后成立，但四处关键认知被源码推翻（见 §2.1）。

## 2. 共识记录

### 2.1 认知修正（grilling 确立的事实）

1. **AGENTS.md**：不是"子代理有、队友没有"——`context/agent-instructions` 无父子守卫，**两者都注入**且 unfiltered（候选 `['AGENTS.md','CLAUDE.md']`，`context/agent-instructions/src/config.ts:12`；`$DSH_HOME/AGENTS.md`，`context/agent-instructions/src/render.ts:98`）。插件不加核心补丁改不了 → 接受现状，上游 issue 记录（§12）。
2. **"8 段一条线性字符串"**：system 是**命名节 + 数字 order 的注册表**（`core/system-prompt/src/index.ts:405`，`SECTION_ORDERS` 见同一文件 `:131`），渲染成一条 system 消息；工具定义走**独立 tools 字段**（`core/tools/src/index.ts:854`）；AGENTS.md / skills catalog / runtime 快照是**user 消息通道**（change/digest 门控）；首消息再一条 user 消息。自由度 = 给**自己的节**选 order + 选通道。
3. **"DSH 无 Agent 层"**：半错。core 已有 per-child persona（order-0 `deployment:persona-prefix` 节）、per-child `toolFilter`、agent presets、GUI picker；Agency 外部包是"命名人设+召唤工具"的参考实现。本插件真正增量：**用户自写 agent.md、别名+modelOrder、requiredTools 警告、缓存感知组装、UI**。
4. **fork 缓存直觉陷阱**：fork = 父前缀消息史重放，但**子 system 头重组装** → 请求头部与父不同 → 前缀缓存从头部断。demo 级认知，写进 UI 顾问面板的知识库。

### 2.2 决策清单

| # | 决策 | 依据 / 备注 |
|---|------|------------|
| D1 | 交付物 = 本 roadmap + 分模块票据（`issues/01..09`） | 用户 Q1 |
| D2 | agent.md 发现 = `$DSH_HOME/agents` + `$DSH_AGENTS_HOME/agents`（用户级）+ `$WORKSPACE/.dsh/agents` + `$WORKSPACE/.agents/agents`（项目级）——**4 根，对齐原生 skills 机制**；同名 workspace 胜，低 rank 胜 | 用户 Q2；**修订 2026-10-14（01 票 triage Q2）**：原 2 根改为与 `skill-filesystem` `roots()` 对齐，并要求尽量委托原生 `ctx.skills` 机制（rank 表 100/200/300/400/500/BUNDLED） |
| D3 | frontmatter 元数据 + 正文=人设；字段兼容 Agency（name/description/color/emoji） | 学习成本最低 |
| D4 | 「默认」= 内置 bundled agent，**零特例代码**：无人设、`modelOrder:[dsh-default]`；`dsh-default` 别名映射 DSH 子代理默认对（`core/agent-default-model/src/index.ts:24`） | 一切皆注册表；默认是**替换无损的兼容桥**：`summon_agent(default)` ≡ 原生 subagent 调用 |
| D5 | 模型双轨制：**别名统一管理 + 传统 `model` 数组兜底；Agent 优先别名** | 用户最终轮；**修订**了早先"强制别名无逃逸口"——数组是显式逃逸口，lint 警告而非校验错误 |
| D6 | per-model 系统提示词与可用性标志挂**真实模型条目**；别名是纯指针（多别名同模型允许 + lint 提示）；注入目录只含别名名+意图标签 | 别名重映射时提示词随真实模型切换（S5 的正确行为） |
| D7 | reasoningEffort 暂挂 **agent.md**（agent 级默认，链项可覆盖），不进注册表；调用方覆盖 = v2 | 用户 Q4-5"暂时与 Agent 挂钩" |
| D8 | 解析优先级：v1 **严格走声明链**（无调用方 pin）；链耗尽 = **硬错误并回显链**；解析时过 `assertAllowedModelSelection` 白名单（链全被白名单拦 ⇒ 按不可用处理） | 用户 Q8"v1 优先标准策略"+ Q5 链耗尽硬错误（与 DSH isError 哲学同构）；pin 移 v2（Q5/Q8 张力的裁决） |
| D9 | mode = **DSH 预设**（standard/minimal/ptc/cordis），非插件新概念；有效工具集 = `ToolRuntime.view()` 交集，用 `ctx.tools.schemas()` 读取；可见性**只警告不保证**（不隐藏、不硬挡）——工具可回退/动态，硬保证做不到 | 用户 Q6′ |
| D10 | 段顺序：推荐方案（变维度分层）+ **自由自定义**；缓存代价以警告呈现 | 用户 Q7″"自由本身有价值" |
| D11 | 人设落点：persona/includes **恒 system 侧**（进首条消息 = 复用归零）；首条消息 v1 = 标准策略（自由文本 brief）；v2 = brief 模板 + 主 Agent 更多旋钮 | 用户 Q8 |
| D12 | 通道映射照 §6 通过 | Q12 |
| D13 | flavor：v1 = 子代理 `spawn`\|`fork`（调用点参数，默认取 agent.md）；**队友形态 v2** | Q13；agent-team 是 experimental 且与"只控首提示词"边界缠绕 |
| D14 | UI 进 v1 且**优先做**；尽可能智能；**UI 结构与配置文件 1:1 对应**，无隐藏状态 | 用户最终轮 |
| D15 | 替换机制 = 自有名工具 `summon_agent` + `system-prompt/assemble` waterfall 过滤原生 `subagent`/`subagent_fork` 的 AI 可见 schema；`keepNativeSubagentTools` 开关一键还原。同名影子判死（同层 throw `core/tools/src/index.ts:746-748`；本 profile `modelSelectionSettings=true` → 原生 per-agent 挂载 → 同层冲突） | 用户 Q9/Q10 + 探员 4 事实 |
| D16 | 与 Agency 正交共存；`source` 字段预留（built-in/user），v2 给 Agency 专家接模型选择 | Q10′ |
| D17 | M3/M4 为纯函数 + 单测（原型纯模块 = 规格参照）；测试是验收标准而非独立票 | Q1 附带 |
| D18 | 两个研究 spike 入票：R1 别名↔provider/model 关联方案；R2 别名内部负载控制（约束：不均衡、只故障转移、429 默认不转移） | 用户最终轮 |

## 3. 事实基础（关键代码事实速查）

探员报告全文见会话归档（三块压缩摘要 + 探员 4 报告）。速查：

| 主题 | 事实 | 位置 |
|------|------|------|
| system 注册表 | 命名节+数字 order；`renderPrompt` 丢空节、严格 `{{var}}` 插值 | `core/system-prompt/src/index.ts:405/:279` |
| 节序 | identity −1000 → persona 0/10200 → 指引 500–5000 → 9900/10000/10100 | `SECTION_ORDERS :125-159` |
| 消息投影 | 渲染文本 = 持久 `system/message` 事件；system 与 messages 同源 `session.deriveMessages()`；仅 tools 来自 `assembly.tools` | `core/agent-loop/src/agent.ts:405-410/:599/:671-678` |
| runtime context | 持久 user 消息，**字节等值门控**（不变不发） | `core/agent-loop/src/runtime-context.ts:152-163` |
| 工具注册 | register 返回 disposer=注销；同层同名 **throw**；跨层最近 scope 胜；restrict 只滤 inherited；run_code 不可隐藏 | `core/tools/src/index.ts:1063/:746-748/:1178-1218/:1097/:1080-1082` |
| 工具枚举 | 无 list()；`ctx.tools.schemas(scope)` = effective 校验源 | `core/tools/src/index.ts:1260/:1230` |
| assemble waterfall | 返回值 authoritative；`assembly.tools` 可整体替换（树内先例 session-reference） | `system-prompt/src/index.ts:31/:625-628`；`context/session-reference/src/index.ts:127-134` |
| per-child 组装 | `applyChildComposition`：composeFrom → delegation context → persona 节 → tools.restrict | `subagent/src/child-agent.ts:190-215` |
| spawn 服务 | `ctx.subagents.start(provider, request)`；`SubagentStartRequest{prompt,parent,signal,persona,toolFilter,maxDepth,agentOptions}`；reasoningEffort 在 `AgentOptions` 内 | `subagent/src/types.ts:145-201`；`core/agent/src/runtime-types.ts:26-35` |
| 原生 subagent 工具 | AI 参数只有 description+prompt（+条件性 provider/model/reasoning_effort/run_in_background）；persona/toolFilter 是**插件 Config 字段非 AI 参数**；`config.toolName ?? 'subagent'`；`modelSelectionSettings=true` 时 per-agent 挂载 | `tool-subagent/src/index.ts:379-428/:323/:675/:78-135` |
| 模型路由 | 无别名机制、无链、无 per-model 提示词、无健康状态；解析=白名单→preflight→isError；重试=llm-retry 同请求退避（默认5次：EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT） | `tool-subagent/src/model-selection.ts:139/:176`；`llm/src/retry-policy.ts` |
| 子代理默认 | 单一静态对 `{provider,model,reasoningEffort?}` | `core/agent-default-model/src/index.ts:24` |
| 序列化 | DeepSeek：system=单拼接串（`[options.system, historySystem].join('\n\n')`）；tools 独立数组顺序保留；DSH 不发射 cache_control（Anthropic marker 在 vendored pi-ai；cacheRetention none\|short\|long） | `llm-deepseek/src/serialize.ts:150/:159-165`；`llm-pi-ai/src/catalog.ts:426-434` |
| digest 目录 | tool-skill 自建 sha256 门控（对 entry 列表 JSON 而非渲染文本）走 agent/pre-step；首次追加/变更按 message.id 替换 | `skill/tool-skill/src/index.ts:213-251/:328-335` |
| preset 读取 | `ctx.agentPresets.composedPreset(ctx)`；交集只在 `ToolRuntime.view()` | `preset/agent-preset-registry/src/index.ts:290` |
| per-model 变量 | 唯一内置机制：`installModelSelection` 注入 `{{provider}}/{{model}}` | `core/agent/src/model-selection.ts:67` |
| Agency 先例 | `startSubagentRun` = `ctx.subagents.start/startActivation`；请求带 persona+toolFilter+maxDepth；能力门控 `capabilities.persona/.toolFilter/.depthLimit`；332 personas，frontmatter{name,description,descriptionEn,color,emoji,vibe} | AGENCY `lib/src-DhS1geoQ.js:3356-3368/:3383-3401` |

## 4. 架构总览

```
$DSH_HOME/agents/*.md ─┐
$DSH_AGENTS_HOME/agents/*.md ─┤
$WORKSPACE/.dsh/agents/*.md ─┤→ M1 注册发现 ──→ M6 目录注入（<available_agents>，digest 门控）
$WORKSPACE/.agents/agents/*.md ─┘（4 根，rank 100/200/300/400/500，低 rank 胜）
                        │        │                    ↑警告：requiredTools × ctx.tools.schemas()
registry.yaml（models+aliases）┤→ M2 别名注册表 ──→ M3 解析引擎（纯函数）→ M4 组装规划（纯函数）
                        │                                    ↓                     ↓
                        │                          M5 summon_agent 工具 ← 组装上下文
                        │                          （ctx.subagents.start 委托 + assemble 过滤原生）
                        └→ M7 设置 UI（结构忠实编辑器 + 智能顾问面板）
```

数据流：agent.md + registry.yaml → M3 解析出（persona, agentOptions{provider,model,reasoningEffort}, toolFilter, flavor）→ M5 以 `SubagentStartRequest` 委托原生 spawn；M4 决定哪些内容进哪条通道；M6 把注册表目录与警告注入主 Agent 上下文；M7 是唯一的人机编辑面。

## 5. 数据模型

### 5.1 agent.md（frontmatter + 正文=人设）

```yaml
---
id: reviewer                    # 必填，kebab-case，跨层唯一（冲突时 workspace 胜）
name: 代码审查专家               # 显示名（Agency 兼容）
description: 按 DL 能够列风险的 reviewer   # 注入目录用一句话
color: "#4f46e5"                # 可选（Agency 兼容）
emoji: "🔍"                    # 可选
modelOrder: [smart, fast]      # 别名优先（正道，推荐）
# —— 传统 model 数组兜底（显式逃逸口，lint 警告）——
# model:
#   - { provider: deepseek, model: deepseek-chat }
requiredTools: [read, grep]     # 真实工具名；只警告不保证（D9）
includes: [review-checklist.md]  # 相对本 agent 目录或 .dsh/agents/
spawn: spawn                   # 默认 flavor：spawn | fork（调用点可覆盖）
reasoningEffort: high          # 可选 agent 级默认；modelOrder 条目级可覆盖（D7）
source: user                   # 预留：built-in | user（D16 v2 统一 Agency 用）
---
正文 = 人设提示词（persona，恒 system 侧，D11）
```

### 5.2 registry.yaml（`$DSH_HOME/agents/registry.yaml`，workspace `.dsh/agents/registry.yaml` 覆盖合并）

```yaml
models:                        # 真实模型条目：调优层挂这里（D6）
  ds-chat:
    provider: deepseek
    model: deepseek-chat
    sysPrompt: "你是 DeepSeek-V3，偏对话与工具调用。"
    available: true            # v1 手动开关；运行时故障台账 = R2 研究落点
  ds-reasoner: { provider: deepseek, model: deepseek-reasoner, sysPrompt: "…", available: true }
aliases:                       # 纯指针（意图层）：v1 单目标数组；池化 = R1/R2 落点（D18）
  smart: [ds-reasoner]
  fast: [ds-chat]
  dsh-default: [ds-chat]       # 启动时从 core/agent-default-model 读默认对并同步展示（D4）
```

### 5.3 解析语义（M3 纯函数）

1. 遍历 `modelOrder`：条目为别名 → 展开池（v1 单目标）跳过 `available:false`；条目为 raw `{provider,model}` → 直连（lint 警告）。
2. 每个候选过 `assertAllowedModelSelection` 白名单（policy.routes）；全链被拦 ⇒ 与不可用同等处理。
3. 命中即返回 `{provider, model, reasoningEffort, persona, toolFilter, flavor}`；**链耗尽 = 硬错误，回显整条链**（isError 哲学）。
4. effort 取值顺序：链项覆盖 > agent 级默认 > 无。

## 6. 通道放置与缓存动力学（D12）

| 内容 | 通道 | 机制 | 缓存动力学 |
|------|------|------|-----------|
| per-model 系统提示词 | ① system 节 | `systemPrompt.section`，order 低于 persona（在 persona **之前**） | 轮间稳定；切模型在此断 |
| persona / includes | ① system 节 | persona→`deployment:persona-prefix`(order 0)；includes 紧随 | 切 Agent 在此断 |
| mode 工具集 | ④ tools 字段 | toolFilter → `ctx.tools.restrict` | 随 preset/过滤变化 |
| agent/别名目录 | ② digest 门控 user 消息 | 照抄 tool-skill sha256 pre-step 模式 | **注册表不变 ⇒ 不发新消息 ⇒ 主 Agent 前缀不断**（注入名稳定的机制化） |
| AGENTS.md | ②（DSH 原生，不可控） | unfiltered，change 门控 | DSH 行为 |
| brief | ⑤ 首条消息 | `SubagentStartRequest.prompt` | 天然尾巴 |
| compaction/提醒等 | ③ pre-step | DSH 原生 | 天然尾巴 |

**推荐顺序的依据（D10）**：切 Agent 是高频路径（每次召唤）、切模型只在罕见回退时发生 → model-sys 在 persona 之前，使同模型跨 Agent 可复用到 persona 为止。fork 的头部断点（§2.1-4）写进 UI 知识库。

## 7. 原生工具替换机制（D15）

- 注册自有名 `summon_agent`（零冲突风险）。
- `system-prompt/assemble` waterfall（返回值 authoritative）把原生 `subagent`/`subagent_fork` schema 从 AI 可见面**过滤**；原生机制保持注册（"实现层大量委托原版"字面成立）。
- `keepNativeSubagentTools: true` 配置开关停止过滤 = 兼容承诺（随时回退）。
- **兼容桥**：`summon_agent(agent=default)` ≡ 原生 subagent 调用（D4）——过滤原生入口不损失能力。
- **已知限制（v1）**：替换后主 Agent 暂失原生 subagent 的条件性 per-call 模型参数（`modelSelectionSettings=true` 时暴露的 provider/model）——v1 无链内 pin（D8），v2 旋钮解决；roadmap 已记。
- 子代理 toolFilter 需 deny `summon_agent` 自身（防深度爆炸，Agency 先例）+ `maxDepth`。

## 8. 警告体系（只警告，不保证）

| 警告 | 触发 | 呈现 |
|------|------|------|
| requiredTools 超界 | `requiredTools ⊄ ctx.tools.schemas(agent)` | 目录内紧凑标注（缺什么）+ UI；**不隐藏、不阻断召唤** |
| 链耗尽 | modelOrder 全不可用/全被白名单拦 | **硬错误**（isError 回显链）——唯一例外，因其修复是人级的 |
| 逃逸口 | modelOrder 含 raw model 条目 | lint 警告："建议改用别名" |
| 多对一 | 多别名同指一模型 | lint 提示（无害但提示意图重叠） |
| 顺序反模式 | 易变节（③通道）被排到稳定节之前 / cacheIsolated 未声明 | UI 顾问面板缓存断点可视化 |

## 9. 研究项（D18，spike 票 `issues/08`、`issues/09`）

**R1 别名↔provider/model 关联方案**：别名单目标 vs 池；同模型多供应商的**两级结构**（供应商故障 ≠ 模型故障）；池条目 schema（provider/model 对 + per-target 覆盖?）；`dsh-default` 在池化下的语义；registry v1 的向后兼容。

**R2 别名内部负载控制**：故障分类学（5xx/timeout/401 → 转移候选；**429 默认原地退避**——与 llm-retry（同请求 5 次退避）的**叠加语义**：解析层转移 vs 请求层重试如何组合）；转移阈值（连续 N 次？）；恢复探测（v1 手动 UI 开关，v2 半开？）。约束已定：**不均衡（主备不轮询）、只做故障转移**。

## 10. 里程碑（UI 优先，D14）

| 里程碑 | 内容 | 票 |
|--------|------|-----|
| MS0 | spec + map + 票据落盘 | （本步） |
| MS0.5 | **插件脚手架**：可安装 Cordis bundle（`dsh.bundle.patch` + `cordis.patch.yml`）+ TS/vitest 工具链 + 空壳注册点；安装走 `plugin_manager install_bundle` | 10 |
| MS1 | schema 与纯逻辑核心：M1 注册发现 + M2 别名注册表 + M3 解析引擎（含单测）——UI 绑定所需最小集 | 10,01,02,03 |
| MS2 | **M7 智能 UI**（结构忠实编辑器 + 缓存/警告顾问面板）——用户要求的优先项 | 05 |
| MS3 | 组装与注入：M4 通道组装 + M6 目录注入与警告 | 04,06 |
| MS4 | 端到端：M5 召唤工具 + 原生替换 | 07 |
| MS5 | 研究落地：R1/R2 → 池化与故障转移进 M2/M3 迭代 | 08,09（MS1 起即可并行启动研究） |

## 11. v2 展望（明确不进 v1）

- 队友形态（spawn_teammate 的 agent 化）
- Agency 专家接模型选择（`source` 字段统一）
- brief 模板 + 主 Agent 旋钮（**链内 pin**、effort 覆盖、includes 覆盖）
- 别名进 GUI model picker（`@Remote('modelCatalog')` / `ctx.modelDirectories`）
- `agent/request` waterfall 透明别名解析（别名对裸调用/主 Agent 自身生效）
- per-agent `cacheIsolated: true` 显式例外
- 运行时故障台账（R2 产出）：429/5xx 记录驱动半自动可用性

## 12. 上游 issue（记录给 DSH 主仓）

1. `context/agent-instructions` 按召唤形态过滤（子代理/队友差异化注入）需要核心补丁——插件期接受 unfiltered 现状。
2. 工具描述改写无官方 API：直接 mutate `ToolSchema` 无声明支持（`schemaOf` 每次投影从 live definition 取，但无 tools/change 通知）；`system-prompt/assemble` waterfall 是唯一受支持入口（session-reference 先例）。
3. `ToolRestriction` 全局调用 throw（scoped-only，`core/tools/src/index.ts:1100`）——影响任何想做全局工具过滤的插件。

## 13. 票据清单

| # | 票 | Type | Blocked by |
|---|-----|------|-----------|
| 01 | agent.md 注册与发现 | task | 10 |
| 02 | 别名与模型注册表 | task | 10 |
| 03 | 解析引擎（纯函数） | task | 10,01,02 |
| 04 | Prompt 组装与通道放置 | task | 10,03 |
| 05 | 智能 UI 设置页 | task | 10,01,02 |
| 06 | 目录注入与可见性警告 | task | 10,01,02 |
| 07 | 召唤工具与原生替换 | task | 10,03,04,06 |
| 08 | R1：别名↔provider/model 关联方案 | research | — |
| 09 | R2：别名内部负载控制与故障转移语义 | research | — |
| 10 | 插件脚手架与安装通路（Cordis bundle + 工具链） | task | — |

> 10 于 2026-10-14 由 01 票 triage 的 Q1 裁决新增（脚手架原为计划缺口，原编号 00，同日由维护者改号为 10）。
