# 14 — Registry UI：模型关联与系统提示词页签

Status: ready-for-agent
Type: task
Category: enhancement
Blocked by: 05

（来源：05 票 2026-10-19 第二轮裁决 Q2——「只移植第一个选项卡（『智能体列表』）所需的功能」，spec §5.2 registry UI 从 05 拆出至本票。）

## 范围

1. **模型关联页**（原型 `ModelLinks.tsx`；主从双栏，复用 05 落地的 `ListPane`/`PaneSplitter`/`usePaneLayout` 公共外壳）：
   - 空间切换 = registry 层（工作区 `.dsh/agents/registry.yaml` / 用户 `~/.dsh/agents/registry.yaml` / 合并）；合并视图按层解析展示生效条目，工作区同名条目胜，行标「遮蔽 / 覆盖 / 被覆盖」。
   - 别名页：别名 → 模型条目 → agent 关联链（解析目标、重映射即时影响 S5、同指向 fan-in、使用者跳转）；重映射下拉只列真实模型。
   - 模型页：available 开关、被别名指向、触达 agent、sysPrompt 预览。
   - 新增条目写当前空间（合并视图落工作区）；有引用且有下层同名时允许删除并由下层接管，否则「删除」换「引用列表」；`dsh-default` 内置只读（含隐式合成条目）；`path?` / `synthesized?` 只读展示（02 冻结契约预留）。
2. **系统提示词页**（原型 `SystemPrompts.tsx`）：per-model 系统提示词调优（D6）；每模型名只展示生效层（工作区覆盖用户层）；从模型关联页跳转后高亮定位。
3. **数据通道**：全走 12 冻结 wire（`GET /agents-manager/state`、`POST /agents-manager/registry`、`POST /agents-manager/invalidate`）；层解析用宿主已解析结果（`snapshot`），**UI 不重算层合并**（12 票「两个必删项」之一）；写经 `applyRegistryEdit` 的 HTTP 投影。
4. **页签接入**：05 交付的「智能体控制」面板内挂页签（原型页签行结构），与第一选项卡并存。

## 验收

- [ ] spec §5.2 全字段一一对应（models 条目含 `sysPrompt` / `available`；aliases 重映射）
- [ ] 层覆盖关系正确展示（project-dsh 胜 user-dsh）；`dsh-default` 只读；别名下拉只列真实模型
- [ ] UI 写操作经 `/registry` 落盘（原子写由 11/12 保证）；`invalidate` 后 UI 反映
- [ ] S5 重映射即时影响预览（02 数据计算）与 fan-in 呈现
- [ ] 12 票「行为对齐清单」registry 侧条目逐条勾（层合并展示、别名重映射即时影响）
- [ ] `pnpm run check` 通过

## Out of scope

- 写器/通道实现（11/12）；智能体列表/编辑器/顾问面板（05）；03 解析引擎；04 规划器输出；watcher

## Agent Brief

**Category:** enhancement
**Summary:** 移植原型的「模型关联」「系统提示词」两页签进 05 交付的面板，消费 11/12 冻结 wire；UI 不重算域（层合并、写路由全归宿主）。

**Current behavior:**（待 05 落地后更新——本票 Blocked by: 05）面板只有第一选项卡（05 交付物）；registry 数据已经 `GET state` 可得（snapshot 含 models / aliases / findings / diagnostics），`/registry` 写路由与 `/invalidate` 已真机实证（12 票）。

**Desired behavior / Key interfaces:** 见上「范围」；组件形状以 05 落地的公共外壳为准，原型组件（`ModelLinks.tsx` / `SystemPrompts.tsx`，分支尖 `f0f9abe`）为布局参照；错误面消费 12 冻结契约（404 not-found / 409 conflict / read-only）。

**Acceptance criteria:** 见上「验收」。

**Out of scope:** 见上。
