# Map: agents-manager

## Notes

- 特性目录：`.scratch/agents-manager/`；spec = `spec.md`（完整共识记录 + 事实速查 + 数据模型 + 通道映射 + 里程碑）；票据 = `issues/01..10`（单票单文件）。
- 插件产品边界：**只管、且深度管会话启动参数**（persona / 模型链 / 工具过滤 / prompt 组装 / 首条消息）；运行时工作流委托 DSH 原生。
- deck 闸恢复后可由 deck 接管本目录票据管理（文件已按 `docs/agents/issue-tracker.md` 约定落盘）。
- 原型 `agent-control-prototype.html` 保留在仓库根，其纯逻辑模块是 M3 解析引擎的规格参照。

## Decisions-so-far

- 完整共识 18 条见 `spec.md §2`。要点：模型双轨制（别名统一管理 + 传统 model 数组兜底，Agent 优先别名）；可见性只警告不保证（mode=DSH 预设）；替换 = 自有名工具 + assemble waterfall 过滤（同名影子判死：同层 throw + 本 profile 原生 per-agent 挂载）；UI v1 优先且与配置 1:1；默认 agent = 无损替换的兼容桥；flavor v1 = spawn|fork；AGENTS.md 认知修正（子代理与队友都注入）；通道映射六行（目录注入走 digest 门控）。
- 两个研究方向已立票：R1 别名↔provider/model 关联（池化、两级故障结构）；R2 别名内部负载控制（约束：不均衡、只故障转移、429 默认不转移、与 llm-retry 叠加语义待研究）。
- reasoningEffort 暂挂 agent.md；链内 pin 移 v2（Q5/Q8 张力裁决：v1 优先标准策略）。
- 脚手架（01 票 triage Q1）：新开 `10-scaffold`＝可安装 Cordis bundle（`dsh.bundle.patch` + `cordis.patch.yml`）+ TS/vitest 工具链 + 一个空壳注册点；安装只走 `plugin_manager install_bundle`（不手改 profile 的 `package.json`/`cordis.patch.yml`），作为 01–07 的前置。
- 发现机制（01 票 triage Q2）：agent.md 根集与原生 skills 对齐（4 根 + rank 表 `100/200/300/400/500/BUNDLED`，低 rank 胜），**尽量委托 `ctx.skills` 机制**，不另立平行发现设施；原生只认 `SKILL.md`/`<name>/SKILL.md`，agent 解析必须自有。
- ✅ 脚手架落地（票 `10` **resolved**，2026-10-14）：`dsh-plugin-agents-manager` 已装进本 profile（`install_bundle` → `application: applied`；`remove_bundle` 回退 → 干净移除，均已实测）。**注册点 key = `agentRegistry`**——票面建议的 `agents` 已被原生 `ctx.agents` 占用（实现期关键修正，勿再改回）。工具链 = TS + vitest，但用 **npm + workspace 本地 cache**（沙箱不允许写 workspace 之外，pnpm 全局 store 会 EROFS）；构建只用 tsc，`lib/` 运行时零依赖。详见 `issues/10-plugin-scaffold.md` 的 `## Answer`。

## Fog

- R1/R2 未决（池 schema、故障分类学、429 策略）——不阻塞 v1 单目标别名链。
- assemble waterfall 过滤原生工具的运行期细节（组装粒度/每 agent scope）——在 07 票内验证。
- v1 无链内 pin ⇒ 替换原生入口后，主 Agent 暂失原生 subagent 的条件性 per-call 模型参数——已知限制，v2 解决。
- UI「智能」的缓存可视化深度（断点图 vs 数字）——05 票内先做最小顾问面板。
- 脚手架不再阻塞任何票（票 `10` 已 resolved、已装入本 profile）。遗留限制：Host `Service` 目录只收录**声明式契约** service，空壳 `agentRegistry` 无法 service 级读回；现证据 = loader entry 命中 + `application: applied` + 真实 Cordis 单测。若日后需要 service 级读回，另开小票给注册点补契约。
- 01 号票「service 接口 + frontmatter 报错面」契约暂缓（Q4），实施中由 03/05/06 消费点反推；现成的落点 = `ctx.agentRegistry`。

## Children

见 `issues/`。frontier 扫描（open + unblocked + unclaimed，小号优先）：**01、02、08、09** 可立即开工（`10` 已 resolved，01/02 的 `Blocked by: 10` 随之解除）；03 待 01/02；04 待 03；05/06 待 01/02；07 待 03/04/06。
