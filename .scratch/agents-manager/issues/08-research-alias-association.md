# 08 — R1：别名↔provider/model 关联方案（研究）

Status: ready-for-agent
Type: research
Blocked by: —

## 问题

别名与真实 provider/model 的关联结构如何设计，才能同时表达"注入名稳定"与"故障转移"（spec §9-R1）。

## 开放问题

1. 别名 = 单目标还是**池**？池内是同模型的多个供应商，还是不同模型（语义不同——前者是路由冗余，后者是能力梯度）？
2. **两级故障结构**：供应商故障 ≠ 模型故障。同一 `deepseek-chat` 经不同 key/网关，"模型不可用"与"这条供应线不可用"需要分层表达吗？（如 `model: ds-chat` + `routes: [official, mirror]`？）
3. 池条目 schema：`{provider, model}` 对够不够？需要 per-target 覆盖（sysPrompt 差异、effort 差异）吗？
4. `dsh-default` 在池化下的语义（映射 DSH 默认对 vs 也允许池？）。
5. v1 单目标数组 schema 的向后兼容路径（`aliases: {smart: [ds-reasoner]}` → 池）。

## 约束

- 注入目录永远只含别名名（spec D6）。
- 与 R2（负载控制）的接口：R1 定结构，R2 定选择/转移语义。

## 产出

- findings 文档（追加本文档 `## Answer`，Status → resolved，并在 map.md Decisions-so-far 记一行）。
- registry schema 提案（更新 spec §5.2/§9），含兼容迁移示例。

## Comments

- 来源：用户最终轮："我们还要研究别名与 provider/model 的关联方案"。
