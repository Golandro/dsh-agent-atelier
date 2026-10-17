# Map: agents-manager

## Notes

- 特性目录：`.scratch/agents-manager/`；spec = `spec.md`（完整共识记录 + 事实速查 + 数据模型 + 通道映射 + 里程碑）；票据 = `issues/01..10`（单票单文件）。
- 插件产品边界：**只管、且深度管会话启动参数**（persona / 模型链 / 工具过滤 / prompt 组装 / 首条消息）；运行时工作流委托 DSH 原生。
- deck 闸恢复后可由 deck 接管本目录票据管理（文件已按 `docs/agents/issue-tracker.md` 约定落盘）。
- 原型 `agent-control-prototype.html` 保留在仓库根，其纯逻辑模块是 M3 解析引擎的规格参照。
- 领域文档已起步：`CONTEXT.md`（词汇表，随 grilling 增补）+ `docs/adr/`（0001 结构照抄、0002 目录制布局）。
- 仓库守卫与事实文档（2026-10-14 retro 落地）：`pnpm run check`（`scripts/check.mjs`：探针残留 / `lib/` 陈旧 / 宿主包运行时依赖（`@deepseek-ai/*` 禁、第三方库允许——2026-10-17 修订）/ 未装 devDeps / 票面 `path:line` 锚点漂移，会先自测每条判定）+ `.githooks/pre-commit`（每 clone 接线一次：`git config core.hooksPath .githooks`）；harness 事实与实施期约定见 `docs/agents/harness-facts.md`。

## Decisions-so-far

- 完整共识 18 条见 `spec.md §2`。要点：模型双轨制（别名统一管理 + 传统 model 数组兜底，Agent 优先别名）；可见性只警告不保证（mode=DSH 预设）；替换 = 自有名工具 + assemble waterfall 过滤（同名影子判死：同层 throw + 本 profile 原生 per-agent 挂载）；UI v1 优先且与配置 1:1；默认 agent = 无损替换的兼容桥；flavor v1 = spawn|fork；AGENTS.md 认知修正（子代理与队友都注入）；通道映射六行（目录注入走 digest 门控）。
- 两个研究方向已立票：R1 别名↔provider/model 关联（池化、两级故障结构）；R2 别名内部负载控制（约束：不均衡、只故障转移、429 默认不转移、与 llm-retry 叠加语义待研究）。
- reasoningEffort 暂挂 agent.md；链内 pin 移 v2（Q5/Q8 张力裁决：v1 优先标准策略）。
- 脚手架（01 票 triage Q1）：新开 `10-scaffold`＝可安装 Cordis bundle（`dsh.bundle.patch` + `cordis.patch.yml`）+ TS/vitest 工具链 + 一个空壳注册点；安装只走 `plugin_manager install_bundle`（不手改 profile 的 `package.json`/`cordis.patch.yml`），作为 01–07 的前置。
- 发现机制（01 票 triage Q2）：agent.md 根集与原生 skills 对齐（4 根 + rank 表 `100/200/300/400/500/BUNDLED`，低 rank 胜），**尽量委托 `ctx.skills` 机制**，不另立平行发现设施；原生只认 `SKILL.md`/`<name>/SKILL.md`，agent 解析必须自有。→ **已被 D22 修订**（2026-10-14 二轮：委托条件经探针裁决不成立，改结构照抄，见下条）。
- ✅ 脚手架落地（票 `10` **resolved**，2026-10-14）：`dsh-plugin-agents-manager` 已装进本 profile（`install_bundle` → `application: applied`；`remove_bundle` 回退 → 干净移除，均已实测）。**注册点 key = `agentRegistry`**——票面建议的 `agents` 已被原生 `ctx.agents` 占用（实现期关键修正，勿再改回）。工具链 = TS + vitest，但用 **npm + workspace 本地 cache**（沙箱不允许写 workspace 之外，pnpm 全局 store 会 EROFS）；构建只用 tsc，`lib/` 运行时零依赖。详见 `issues/10-plugin-scaffold.md` 的 `## Answer`。
- ✅ 01 票二轮 grilling 落地（2026-10-14，/triage /grill-with-docs）：D19 目录制布局 + 路径身份（`<agent-name>/<agent-name>.agent.md`，保留字 `default`；ADR-0002）；D20 `includes`→`skills` 预置技能；D21 软诊断（UI 05 后补）；D22 委托条件不成立 ⇒ 结构照抄（ADR-0001）；D23 自写最小 YAML 子集；D24 契约冻结（懒发现 + `{cwd,signal}` + `invalidate()`）。`CONTEXT.md` 12 术语、spec D19–D24 与 §5.1/§5.3/§6/§8 已同步；agent brief 已挂票 01。
- ✅ 01 票落地（2026-10-15，`/implement`，**resolved**，见 `issues/01-agent-registry.md` 的 `## Answer`）：四根 + bundled 懒发现（rank 100/200/400/500/600、低 rank 胜、`invalidate()` 重扫、无 watcher）、目录制布局与路径身份、自写最小 YAML 子集（零运行时依赖）、软诊断 + 受信根硬错、内置默认 agent 走同一管线。契约落在 `src/types.ts`，服务面 = `ctx.agentRegistry`；单测 46 例 / 44 锚点（交付快照首跑 `npm run check` 曾卡在 `build 不新鲜`，见下条修复轮）。
- ⚠️ 01 实现期细化（下游需要知道）：受信 bundled 根**绕过**注入的 fs 端口（原生 `trustedHost` 同构）；无 frontmatter / `modelOrder: []` 这类「合法但无链」的 agent 会得到 advisory `no-model-order`（仍注册）；未闭合围栏按 `unparseable-frontmatter` 处理；新增 devDependency `@types/node`（运行时依赖仍为空）；`spawn` 缺席保持 `undefined`（默认 flavor 是调用点的事，避免破坏 D14 的 1:1 回写）。
- ✅ 01 修复轮（2026-10-15，`/code-review` 两轴 + `/implement`）：Standards 8 条 + Spec 9 条 → 修 4 项 Spec 缺陷（ctx `fs` 端口改**按用时解析**、`extra` 值改公共缩进去缩、受信根 advisory 行为补测、Answer 计数更正）+ 4 项 Standards（契约成员改名 `id`→`agentName`、`persona`→`body`；每查询只解析一次 `findProjectRoot`；根 `README.md`/`package.json` 契约陈述更新；plugin 测试改封闭不再读真实 home），其余记为债务或接受偏差（详见 01 票「修复轮」节）。**唯一破坏性变更 = 契约成员改名**，形状/语义不变，03/05/06 用新名。
- ✅ 01 修复轮复评（2026-10-15，两轴 `/code-review` 跑在修复提交上）：Standards 1–4 RESOLVED、5–8 维持债务，再收 `get(id)` 参数名与 `bundled/README.md` 矛盾句；Spec a2/b3/c1/c2/c3 RESOLVED、零回归，新增两条处置——**未知键不再能让整份文档消失**（spec §5.1 只允许已知键造成 `unparseable-frontmatter`，已修 + 补测）、受信根坏文档即使被同名用户根抢先也照抛（裁决故意的，已补测）；`spawn` 缺席 = `undefined`（裁决）。终态：`npm run check` 全绿，46 用例 / 44 锚点。
- ✅ 02 票诊断 + 五项裁决落地（2026-10-15，/triage，全按推荐）：dsh-default **装载时快照 + `invalidate()` 重读**（弃「启动时」措辞，D24 同构）；目标 = 与默认对相等的已声明条目、无匹配 ⇒ **隐式合成条目**（无 sysPrompt、available: true，保「别名=纯指针」不变式）；`dsh-default` **保留字**；registry.yaml **软诊断错误面**（坏层弃用、另一层照常、两层全坏 ⇒ 空注册表只含 dsh-default）；跨层校验 = **纯函数 + 错误级 finding**（agent modelOrder/model 入参注入，运行时硬错仍归 03 链耗尽）。诊断发现并回填票面：registry.yaml 语法（布尔/两层块映射/四键流映射）超出 01 frontmatter 子集 ⇒ 需新写最小解析器；运行时读取面 = `ctx.agentDefaultModel.currentSelection()`（服务已装配本 profile）；服务键 `aliasRegistry` 原生无占用已核验。agent brief 已挂票 02，维持 `ready-for-agent` 可开工。
- ✅ 02 票落地（2026-10-15，`/implement` + 两轴 `/code-review`，**resolved**，见 `issues/02-alias-registry.md` 的 `## Answer`）：registry.yaml 双层装载与工作区胜合并、自写第二份最小 YAML 子集读器（布尔/两层块映射/四键流映射超出 01 子集）、内置 `dsh-default`（装载时快照、匹配已声明条目否则合成隐式条目、`models:`/`aliases:` 两处保留字、无默认对则不存在）、跨层发现为纯函数 `inspectAliasRegistry`（agent 侧数据注入，不扫 agent 根）、服务面 `ctx.aliasRegistry`（`snapshot`/`getAlias`/`getModel`/`diagnostics`/`invalidate`）。契约冻结并回写票面 `## 契约（冻结）`。**共享层抽出**：`src/roots.ts`（项目根走查 + home 解析）、`src/lazy-load.ts`（两注册表共用的懒加载/记忆化，01 的 `scanFor` 重复实现一并收敛）、`src/yaml-scalar.ts`（两份 YAML 读器的标量规则）。三笔提交：`85fa97d`（实施）、`6820f23`（复核后修正）、末笔（票面/地图回填）。终态：**83 用例 / 54 锚点**，`npm run check` 全绿。复核后修正要点：`'builtin'`→`'built-in'`（词汇漂移）、一概念一声明（`ModelDeclaration`/`AliasDeclaration`）、无默认对时的 finding 归因主机。
- ⚠️ 02 实现期细化（下游需要知道）：`inspectAliasRegistry` 除 scope 四项外还校验「别名 → 模型目标」存在性（D6 不变式）；agent 的 `model:` 数组只出逃逸口 hint，不做目标存在性校验（D5 允许直连）；无默认可读对时 `dsh-default` 不存在且引用它的链得一条**主机归因**错误 finding；`path?`/`synthesized?` 是给 05/06 的预留字段。
- ✅ 05 票诊断 + 五项裁决落地（2026-10-17，/triage，全按推荐、唯 Q4 依赖项被追加修正「我们需要这些依赖」）：阻塞 10/01/02 全解 ⇒ 05 为 frontier 且**优先开工**（Q5）。票面事实漂移就地修正——`SettingsProvider.installSection` 系幻影 API（活注册面 = client `ctx.slots` + `settings.section`）；`includes`→`skills`（D20）；补 01/02 冻结读面与交付前置（双面面包：`dsh.client` + `exports['./client']` + tsdown client 构建，缺产物激活期硬失败）与数据通道定案（Q3-A：宿主自管 + `ctx.webServer` route + client fetch）。Q1 启停 v1 不做；Q2 顾问面板取最小面板（spec §6 静态表 + 02 findings + S5 预览 + fork 知识库，04 落地后另立票迭代）；agent brief 已挂票 05，维持 `ready-for-agent`。**工作区未提交改动同日处置**（Q4）：pnpm 迁移 + `.vendor` 软链保留、js-yaml/zod 依赖保留、守卫 `bundle` 判定改 `hostRuntimeDeps`（第三方库允许进 `dependencies`、`@deepseek-ai/*` 宿主包仍禁——ADR-0001 边界不变），提交 `3ac2894`（含 harness-facts 补记与 pnpm 沙箱 store 陷阱）。

## Fog

- R1/R2 未决（池 schema、故障分类学、429 策略）——不阻塞 v1 单目标别名链。
- assemble waterfall 过滤原生工具的运行期细节（组装粒度/每 agent scope）——在 07 票内验证。
- v1 无链内 pin ⇒ 替换原生入口后，主 Agent 暂失原生 subagent 的条件性 per-call 模型参数——已知限制，v2 解决。
- UI「智能」的缓存可视化深度（断点图 vs 数字）——05 票内先做最小顾问面板。
- 脚手架不再阻塞任何票（票 `10` 已 resolved、已装入本 profile）。遗留限制：Host `Service` 目录只收录**声明式契约** service，空壳 `agentRegistry` 无法 service 级读回；现证据 = loader entry 命中 + `application: applied` + 真实 Cordis 单测。若日后需要 service 级读回，另开小票给注册点补契约。
- 03 票面「modelOrder 条目为 raw」旧读法待同步：新契约 = 链先 `modelOrder` 别名、耗尽后 `model` raw 兜底（spec §5.3 已改，03 票正文动工前修订）。
- 预置技能（`skills`）投递方式未定（内容预注入 vs 目录标记）——04/07 设计题，不阻塞 01（01 只解析名字）。
- deck 闸本轮仍 defer（`deck_*` 返回 `{"reason":"gate-defer"}`）：01 票二轮处理、修复轮与 02 票诊断+裁决回填+实施（2026-10-15）都按 `docs/agents/issue-tracker.md` 的 markdown 约定直接改票（`issues/01-agent-registry.md`、`issues/02-alias-registry.md`、本文件），未走 deck 上报；闸恢复后补报（挂账：#2 诊断、裁决回填与实施完毕，待补报）。05 票诊断+裁决+brief（2026-10-17）同样直改 `issues/05-settings-ui.md`（挂账追加：#5 诊断与裁决完毕、brief 已挂，待补报）。
- ✅ 工作区未提交改动已处置（2026-10-17，05 票 Q4 裁决）：pnpm 迁移 + `.vendor` 软链 + js-yaml/zod 依赖保留，守卫零依赖判定修订为 `hostRuntimeDeps`，提交 `3ac2894`；守卫复绿（72 锚点 / 83 用例）。pnpm 沙箱 store 陷阱已记 harness-facts。

## Children

见 `issues/`。frontier 扫描（open + unblocked + unclaimed；2026-10-17 更新，守卫已复绿）：**05 优先开工**（Q5 裁决：D14 用户明示 UI 优先，agent brief 已挂）——03、06、08、09 亦可立即开工；04 待 03；07 待 03/04/06。
