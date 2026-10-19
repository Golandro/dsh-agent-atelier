# 15 — 客户端 UI 后续实现（面板收口与配置页签）

Status: ready-for-agent
Type: task
Category: enhancement
Blocked by: （无；14 / 13 并行，04 落地后接顾问深化）

（来源：05 票 2026-10-19 resolved 时裁决——第一选项卡「智能体」与面板壳已交付，剩余客户端 UI 面集中到本票跟踪。）

## 现状（05 已交付）

- 左侧栏「智能体控制」面板；双行页头：题头行标题 + 工作空间选择器占位，页签行「智能体 / 操作历史 / 配置」+ 刷新。
- 智能体列表（懒加载 TanStack chunk）+ CodeMirror 分块编辑器（懒加载 chunk）+ `/plan`/`/commit` 保存流 + 最小顾问面板。
- 操作历史（原「最近写入」）为内存态；「配置」页签为占位；工作空间选择器为 disabled 占位。
- 大块布局 CSS 容器查询单栏（< 60.375rem 列表隐藏），结构类名带 `dsh-plugin-agents-manager` 命名空间。
- 代码提交：`9e77364`（列表/编辑器 chunk）、`ad9bb8f`（页头/页签/静态 CSS）、`e9a5345`（aria 接线）；`pnpm run check` 192 用例 / 17 文件全绿。

## 计划（按优先级）

### P1 — 面板收口（可立即开工）

1. **工作空间选择器**：替换题头占位；数据源 = 宿主工作区列表 / 项目根发现；切换后 `invalidate()` → `snapshot` → 重新 compose；保留选中与草稿；补空态与失败态。
2. **配置页签壳**：把占位换成配置入口；与 14 票的模型关联 / 系统提示词页签接线（本票只做壳、层选择与跳转/高亮，字段编辑归 14）。
3. **智能体编辑收口**：frontmatter 字段级编辑（spec §5.1 全字段）与 `extra` 原文回写；完整真机验收——改动 → 保存全部 → plan chips → 确认写入 → `agent.md` 落盘 → 操作历史入账 → 草稿清除；手改文件 → `invalidate()` → UI 反映。
4. **可访问性与键盘**：页签 ←/→/Home/End 导航、焦点管理、`aria-controls` 与 `tabpanel` 保持对齐（05 已建立基础）。

### P2 — 历史与顾问

5. **操作历史**：持久化策略（宿主日志 / sessionStorage / 仅内存的产品裁决）、按文件/结果筛选、清空/导出、刷新目录状态统一。
6. **顾问面板深化**：04 规划器输出接入（04 落地后）、缓存断点可视化、S5 即时影响、fork 知识库的完整呈现；02 findings 四类与三类警告（requiredTools 超界 / 预置技能缺失 / 顺序反模式）逐条演示。

### P3 — 测试与发布

7. **前端测试基座**：与 13 票协同；组件测试（页头/页签/历史/占位）、懒加载失败与重试、窄容器布局回归、保存流契约测试。
8. **合回主线前清理**：删除 `prototype/` 与 proto scripts（05 Q1=A）；更新 README / AGENTS / CONTEXT；`pnpm run check` 全绿。

## 验收

- [ ] 工作空间选择器可切换并触发 `invalidate`；选中与草稿不丢
- [ ] 「配置」页签不再是占位；与 14 票页签一致
- [ ] §5.1 全字段编辑 + `extra` 原文回写；完整保存流真机走通
- [ ] 操作历史持久化策略定案并实现（或明确仅内存）
- [ ] 顾问面板完整演示（S5 / 断点表 / fork 知识库；04 落地后）
- [ ] 页签键盘导航与 aria 关系通过；窄容器单栏回归
- [ ] 13 票组件测试锚覆盖页头/页签/历史/占位；`pnpm run check` 全绿
- [ ] 合回主线前 `prototype/` 与 proto scripts 已删除

## Out of scope

- registry 写器 / 通道（11/12）；registry 字段 UI（14）；03 解析引擎；04 规划器实现；13 的测试基座建设（本票只消费）。
- 05 已交付的智能体列表 / 编辑器回退重写；CDN 引入；修改 11/12 冻结契约。

## References

- 05 交付：`issues/05-settings-ui.md` 的 `## Answer`
- registry UI：`issues/14-registry-ui.md`
- 前端测试：`issues/13-frontend-tests.md`
- 原型：`prototype/settings-ui`（合回主线前删除）
