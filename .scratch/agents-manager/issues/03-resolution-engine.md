# 03 — 解析引擎（纯函数）

Status: ready-for-agent
Type: task
Blocked by: 10, 01, 02

## 范围

实现链解析纯函数（spec §5.3），原型 `agent-control-prototype.html` 的 `resolveModel` 为规格参照，升级点：

1. **双轨遍历**：`modelOrder` 条目为别名 → 展开别名目标数组（v1 单目标）跳过 `available:false`；条目为 raw `{provider,model}` → 直连（触发逃逸口 lint）。
2. **白名单**：每个候选过 `assertAllowedModelSelection` 语义的 policy.routes 白名单（事实参照 `tool-subagent/src/model-selection.ts:139`）；全链被拦 ⇒ 按不可用处理。
3. **链耗尽 = 硬错误**：抛出/返回错误并回显整条链（对齐 DSH isError 哲学，`tool-subagent/src/index.ts:213`）。
4. **effort 取值**（spec D7）：链项覆盖 > agent 级 `reasoningEffort` 默认 > 无。
5. 输出：`{provider, model, reasoningEffort, persona, toolFilter, flavor}` + 解析报告（命中哪个别名、是否回退、被跳过的目标及原因）——报告供 UI（05）与目录警告（06）复用。
6. v1 **无调用方 pin**（spec D8：Q5/Q8 张力裁决，v1 优先标准策略）。

## 验收

- 单测：别名回退、raw 条目直连+lint、白名单拦截、链耗尽错误回显、effort 优先级、双轨混用。
- 纯函数零 IO（注册表/可用性/白名单全部入参注入）。

## Comments

- 来源：grilling 共识 D5/D7/D8（spec §2.2）；R2 研究落地后在本层扩展故障转移语义（v2）。
