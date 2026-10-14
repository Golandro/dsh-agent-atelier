# 05 — 智能 UI 设置页（优先）

Status: ready-for-agent
Type: task
Blocked by: 10, 01, 02

## 范围

设置页是 v1 的**优先交付项**（spec D14，里程碑 MS2）。要求：**UI 与配置文件 1:1 对应，无隐藏状态**——UI 是 registry.yaml / agent.md 的结构忠实编辑器，不是另一份真相。

1. **注册面**：`settings.section` slot（参照 Agency 设置页与 `SettingsProvider.installSection`，`client/ui-settings/src/client/contract/slots.ts:56`）。
2. **编辑面**（结构忠实）：
   - agent 列表：启停、frontmatter 字段编辑（含 modelOrder 数组编辑、requiredTools、includes、spawn、reasoningEffort）。
   - registry：别名重映射（下拉选真实模型）、`available` 开关、dsh-default 只读展示。
3. **智能顾问面板**（"尽可能 UI 智能"）：
   - 缓存断点可视化：消费 04 规划器输出（断点图/每维度可复用前缀长度）。
   - 警告呈现：requiredTools 超界（缺什么）、多对一、逃逸口 raw 条目、顺序反模式（spec §8 全表）。
   - 别名重映射的即时影响预览（S5 场景：注入名不变、实际命中变）。
4. UI 写操作直接落配置文件（configEditor 先例：`boot/config-editor/src/index.ts:34`），文件被手改后在下次会话生效并在 UI 反映。

## 验收

- 每个可编辑项与 schema 字段一一对应（清单核对）。
- 顾问面板能演示：切换 Agent/模型断点移动、别名重映射前缀不变。

## Comments

- 来源：grilling 共识 D14（spec §2.2）。用户原话："优先做UI。尽可能UI智能，配置文件也正确体现结构。"
