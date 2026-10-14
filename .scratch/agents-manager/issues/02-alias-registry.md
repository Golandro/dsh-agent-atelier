# 02 — 别名与模型注册表

Status: ready-for-agent
Type: task
Blocked by: 10

## 范围

实现 registry.yaml 的 schema、加载与合并（spec §5.2）：

1. **双轨 schema**（spec D5/D6）：
   - `models:` 真实模型条目 `{provider, model, sysPrompt, available}`——per-model 系统提示词与可用性挂**真实模型**；`available` v1 为手动开关。
   - `aliases:` 纯指针，v1 为**单目标数组**（`smart: [ds-reasoner]`）；池化是 R1/R2 的落点，schema 留数组不必动。
   - `dsh-default:` 启动时从 DSH 子代理默认对（`core/agent-default-model/src/index.ts:24` Config）读取并同步展示。
2. **合并规则**：profile 全局（`$DSH_HOME/agents/registry.yaml`）+ workspace（`$WORKSPACE/.dsh/agents/registry.yaml`）覆盖合并；别名/模型同名 workspace 胜。
3. **校验与 lint**（spec §8）：
   - modelOrder 引用不存在的别名 = **校验错误**（逃逸口只指 raw `{provider,model}` 条目，见 03）。
   - 多别名同指一模型 = lint 提示（允许）。
   - raw 条目建议 lint："建议改用别名"。
4. 对 03 暴露纯数据（models+aliases+合并结果）。

## 验收

- 单测：schema 校验、覆盖合并、dsh-default 同步、别名缺失错误、多对一 lint。

## Comments

- 来源：grilling 共识 D5/D6（spec §2.2）；"别名统一管理 + 传统 model 数组兜底"是用户最终轮裁决。
