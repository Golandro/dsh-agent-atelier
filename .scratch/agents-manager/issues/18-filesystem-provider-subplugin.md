# 18 — 文件系统 Provider 子插件与 Registry/Provider 边界（P2 读面）

Status: ready-for-agent
Type: task
Blocked by: —

## 背景

2026-10-18 `/grill-with-docs` 的收敛结果。核心问题是 **AgentRegistry 本身有状态、需要缓存与持久化边界，但每个 Registry 条目又必须能指回来源 Provider**。裁决：

- **Q4 = B**：延后的 “harness specification provider” 指跨 harness 的 `harness-config` 规格来源；它需要 `DefinitionFormat` 与新的 `AgentSource` 标签，本票不做。
- **Q5 = 读面**：本票先打通 `agentRegistry.list/get/diagnostics` 的 Provider 化；summon / preset bridge 另立票。
- **Q6 = 选项 1**：**Registry 继续是深领域模块；Provider 只做来源适配、持久化与热替换**。Provider 不解析 frontmatter、不合并 rank、不判 trust、不产 diagnostics；这些留在 Registry / core。

### 为什么不是选项 2（Provider 提供完整行为）

- 删除测试：删掉 Registry，解析、分类、rank 合并、trust、诊断会重新出现在每个 Provider 里；`docs/core-design.md` 的删除测试已经点明这正是语义分叉的入口。
- 冻结读面：06/UI/summon 只认 `agentRegistry` 的四个方法；Provider owns behavior 会让消费者认识异质 Provider，或把 Registry 变成 Middle Man。
- Q4=B：跨 harness Provider 如果 owns behavior，就得自己实现一套 agent 解析/rank/trust/诊断；`DefinitionFormat` 正是为了把“新格式”停在 core 翻译层。
- 热替换：换 Provider 应换来源；行为热替换会让缓存、UI 断言和测试基线静默变化。

### 执行流证据（本票必须保留的）

当前冷查询是：解析一次 project root → 扫四根 + bundled（低 rank 胜）→ 每份文档只解析一次 → 同一遍产出 list 与 diagnostics。若按草案让四个 Provider 各自解析 project root，会变成最多四次 walk，反掉 01 票修复轮的“每查询只解析一次 project root”不变量（`issues/01-agent-registry.md` 修复轮记录）。host `fs` 适配器还有三个与本票相关的信息损失：

- `listDirectory` 丢弃 `FsDirEntry.target` / `displayPath`，core 用 `join` 重建文档路径；
- `readDocument(agentName)` 丢掉 `SourceEntry` 身份，missing 时没有精确 path；
- `pathExists` 吞掉权限/不可用错误，`.git` 被拒绝时会静默落回 `cwd`。

本票只修 Provider 契约需要的那部分：**project root 由 Registry 解析一次并传入；Provider 只按 entry 读取；每个条目带 `providerId`。** `WorkspaceRoots` 深模块与 typed fs 结果（`present|absent|unavailable`）另立票，不在本票扩大。

### 部署硬约束

HMR profile 下 `plugin_manager` 安装/启用会把 bundle 的所有 row id 当作 required；required row 只要 `pending` 就算激活失败。因此 **不能先插一个 `inject: ['agentProviders']` 的 Provider 行、等以后补 registry**。本票必须同票提供 core 行，或在 Provider 行上显式 `disabled`；推荐前者。

## 范围

1. **contract**
   - 新增 `src/contract/providers.ts`，从 `src/contract/index.ts` 导出：
     - `AGENT_PROVIDERS_SERVICE = 'agentProviders'`、`SERVICE_API_VERSION = 1`；
     - `AgentProviders`（本票只含 agent 侧：`registerAgentProvider` / `listAgentProviders` / `onChange` / `apiVersion`）；
     - `ProviderControl`（`signal`、`invalidate`）；
     - `AgentSourceProvider`：`id`、`source`、`rank`、`trust`、`origin`、`format`、`apiVersion`、`listEntries(options)`、`readDocument(entry, options)`；
     - `SourceEntry`：`name`、`kind`、`path`、`providerId`、可选 `sourceRef`；
     - `SourceDocument`：`path`、`text`；
     - `SourceRead`：`{ kind:'text', document }` 或 `{ kind:'missing', path, reason:'absent'|'not-text'|'unavailable' }`；
     - `ProviderLookupOptions`：`cwd?`、`projectRoot?`、`signal?`。
   - `AgentDefinition` 与 `AgentDiagnostic` 增加必填 `providerId`；`AgentSource` v1 联合类型不扩（跨 harness 标签随 Q4=B 另立票）。
   - `AgentSourceProvider.format` 先只实现 `'agent-md'`；为 Q4=B 保留字段，不实现 harness-config。
2. **core**
   - 新增 `src/core/providers-registry.ts`：`createAgentProviders()`（plain object；`apiVersion: 1`；注册同步工厂；返回 disposer；重复 `id` / 重复 agent `source` throw；注册、注销、`control.invalidate()` 都触发 `onChange`）。
   - `createAgentRegistryService` 改为消费 `AgentProviders`：
     - 依赖 `providers`；保留 `nodeFileSystem` / `resolveFileSystem` 只用于 Registry 解析 project root；
     - 每次查询解析一次 project root，传给所有 Provider；
     - Provider 按 `rank` 升序、再按注册顺序；`listEntries` → 分类 → `readDocument(entry)` → `parseAgentDocument` → rank/name 合并；信任策略与诊断码/顺序保持现有行为；
     - `readDocument` 的 `SourceRead.missing` 映射为现有诊断（`missing-document` 等），path 必须来自 Provider，不再 `join` 猜；
     - `onChange` 清 Registry 缓存；`invalidate()` 仍清缓存；
     - 条目与诊断写入 `providerId`。
   - `aliasRegistry` 本票不动：仍走现有 `AgentFileSystem` 直读。
   - `src/core/index.ts` 公开 `resolveDshHome` / `resolveAgentsHome`（`dsh/host` 解析用户根用；`providers` 不得 deep import core）。
3. **providers**
   - 新增 `src/providers/fs/source.ts`：`createFileSystemAgentProvider`，一个实例读一个根。
     - 工厂接收根解析函数 `(projectRoot) => string | undefined` 与 `AgentFileSystem` 选择器；Provider 本身不解析 project root、不读 env、不读 `homedir`。
     - `listEntries` 返回原始直接子项（不替 Registry 过滤 dot/invalid/reserved/README/flat md）。
     - `readDocument(entry)` 读 `<name>/<name>.agent.md`，返回 `SourceRead`；missing 带精确 path；不解析 frontmatter。
     - 受信 bundled 根固定走 Node 适配器；项目/用户根按用时解析 host `fs`，缺失时回退 Node。
   - `src/providers/fs/index.ts` 导出工厂；现有 `node.ts` / `host.ts` / `absence.ts` 保持。
4. **host / 插件行**
   - 新增 `src/dsh/host/core.ts`：`applyCore(ctx)` 提供 `agentProviders`（plain object）、`agentRegistry`（消费 Provider 的 catalog）、`aliasRegistry`（现状不变）；不注册默认 Provider。
   - 新增 `src/dsh/host/providers.ts`：`applyProviders(ctx)`，`inject: ['agentProviders']`；注册四个根 + bundled 五个 `AgentSourceProvider`；用 `ctx.effect` 挂 disposer；根路径由本层解析（项目根用 Provider 传入的 `projectRoot`，用户根用 `$DSH_HOME` / `$DSH_AGENTS_HOME`，bundled 用 `BUNDLED_AGENTS_DIR`）。
   - `src/dsh/host/plugin.ts` 改为 all-in-one 兼容壳：`apply` = `applyCore` + `applyProviders`；`src/index.ts` 的导出清单保持（新增 `AGENT_PROVIDERS_SERVICE`）。
   - `package.json` 增加 `./core`（`lib/dsh/host/core.js`）与 `./providers/fs`（`lib/dsh/host/providers.js`）子路径 exports；`main` / `files` 不改。
   - `cordis.patch.yml` 从单行改为两行：`agents-manager-core`（`name` 指 `./core`）与 `agents-manager-provider-fs`（`name` 指 `./providers/fs`，`inject: [agentProviders]`）；不再插 all-in-one 行。HMR 下两行都必须 active。
5. **测试**
   - Provider 契约套件：临时根 + 假 host `fs`；list/read/`projectRoot`/missing path/受信 Node 绕过/`providerId`；断言 Provider 不解析 frontmatter。
   - Registry：rank 排序、重复 `id`/`source`、注册/注销/`invalidate` 清缓存、`onChange`、shadowing 与受信硬错误保持、条目/诊断 `providerId`。
   - 现有 83 用例改造后行为不变（允许新增 `providerId` 字段断言）；alias 用例不动。
   - 插件行：真实 `Context` + fake `agentProviders` 验证 `applyProviders` 注册/卸载；Loader 行测试尽量覆盖 `inject`；HMR 安装用 `plugin_manager` 真机验收。
6. **文档 / 守卫**
   - 更新 `docs/core-design.md` §3.5 的 Provider 契约到本票形状（`readDocument(entry)`、`projectRoot`、`providerId`、`SourceRead`）。
   - `map.md` 记录裁决；`CONTEXT.md` 补 Provider / Registry 条目术语（Provider＝来源适配器，不解析不合并；条目＝带 `providerId` 的 Registry 读模型）。
   - 需要的 `path:line` 锚点逐条重验；import 矩阵、build、`lib` loader 冒烟全绿。

## 验收

- [ ] `pnpm run check` 全绿（先恢复工作树中 `src/providers/fs/node.ts`）；现有 agent 读面的 list/顺序/`source`/`origin`/诊断码/诊断顺序与基线一致（唯一新增字段 = `providerId`）。
- [ ] `agentProviders` 是 plain object 服务，可被 Provider 行 `inject`；注册/注销/`invalidate` 均触发 Registry 重扫。
- [ ] 每个 `AgentDefinition` 与 `AgentDiagnostic` 都带 `providerId`；Provider 注销后对应条目消失，不保留旧值。
- [ ] 四个文件根 + bundled 由 Provider 子插件注册；Provider 不自己 walk project root；Registry 每查询只解析一次 project root。
- [ ] Provider 只返回原始 entry/文档；分类、frontmatter 解析、rank/trust、诊断全部在 core。
- [ ] HMR 真机：bundle 的 core 行与 Provider 行都 active；`install_bundle` 返回 `applied`；无 required row pending。
- [ ] `package.json` 的 `./core` / `./providers/fs` 子路径可被 Node 解析；`lib` 新鲜；loader 冒烟通过。
- [ ] import 矩阵零违规；`contract`/`core`/`providers` 仍不 import `@deepseek-ai/*`；`dsh/host` 运行期仍只 type-only cordis。
- [ ] `docs/core-design.md` Provider 契约、`map.md`、`CONTEXT.md` 与实现一致；新 `src/...` 锚点/路径陈述可通过守卫。

## 已知约束

- **工作树现状**：`src/providers/fs/node.ts` 当前是未提交删除，`src/providers/fs/index.ts` 还 re-export 它；不动手恢复则测试无法收集。实现第一步先恢复它。
- **与 17 票的顺序**：17 的裸 `src/...` 路径守卫若先落地，本票的新增路径在实现前都“不存在”，会让 `check` 先红；两票合并时需约定 planned-path 例外（或允许“新增”上下文），否则先做 18。
- **HMR 安装**：已选中的 bundle 在 HMR 下会被 `installBundle` 拒绝 `already-installed`；改 linked checkout 的 patch 或 remove 后重装。两行必须同时 active。
- **plain object 服务**：`agentProviders` 不进 `Service.listService` 目录；证据用 loader entry + 真实 `Context` 单测。`Service` 基类 / `peerDependencies` / `Service.listService` 安装探针是 P2 的单独门，不在本票。
- **不新增依赖**；沙箱内不改 `package.json` 依赖；第三方库仍按 2026-10-17 裁决允许，但本票不需要。
- `AgentSource` v1 是闭合联合；跨 harness 的 `harness-config` 来源标签与 `DefinitionFormat` 留给 Q4=B 的后续票。本票只落 `format` 字段和 `'agent-md'`。
- `AgentDefinition.providerId` / `AgentDiagnostic.providerId` 是**加字段**，不是改 `AgentRegistry` 四方法语义；但会改 01/02/06/11 的测试 fixture 与文档陈述，需一起更新。
- alias registry 本票保持直读；模型层 / 默认对 Provider 不做。
- 写入面（11）、summon/preset bridge、UI 均不做。

## Agent Brief

**Category:** refactor
**Summary:** 把 Agent 定义来源从四根硬编码改成可注册的 Provider 子插件；Registry 继续负责解析、rank/trust、诊断与缓存，每个条目带 `providerId`。

**Current behavior:**
`apply` 直接构造 `agentRegistry`；discovery 自己 walk project root、扫四根 + bundled、读文档、解析、去重；没有 `agentProviders` 服务，也没有可替换的来源。`aliasRegistry` 也直读 fs。

**Desired behavior:**
- `agentProviders` 作为 plain-object 服务提供注册/读取/变更通知；
- 文件系统 Provider 子插件注册四个文件根 + bundled，只列原始 entry、按 entry 读原始文本；不解析、不合并、不判 trust；
- `agentRegistry` 消费 Provider 列表，每查询只解析一次 project root 并传入；分类/解析/rank/trust/诊断/缓存仍在 Registry；
- 条目和诊断带 `providerId`；Provider 注册/注销/invalidate 清 Registry 缓存；
- 两个插件行（core + providers/fs）同时 active；all-in-one `apply` 保持兼容；
- 现有 agent 读面行为不变（唯一新增 = `providerId`）。

**Key interfaces:**
`AgentProviders` / `ProviderControl` / `AgentSourceProvider` / `SourceEntry` / `SourceDocument` / `SourceRead` / `ProviderLookupOptions`；`AgentDefinition.providerId`、`AgentDiagnostic.providerId`；`AGENT_PROVIDERS_SERVICE`。

**Acceptance criteria:**
- `pnpm run check` 全绿（先恢复 `src/providers/fs/node.ts`）；
- Provider 契约套件 + Registry 热替换/去重/rank/trust 测试；
- HMR 真机 `install_bundle` applied，无 required row pending；
- `./core` / `./providers/fs` 子路径可解析，`lib` 新鲜，loader 冒烟；
- import 矩阵与冻结读面语义不变。

**Out of scope:**
`Service` 基类 / peerDependencies / `Service.listService` 探针；`WorkspaceRoots` 深模块与 typed fs（follow-up）；模型层/默认对 Provider；跨 harness `harness-config`（Q4=B）；summon/preset bridge；写面；UI。

## Comments

- 来源：2026-10-18 `/grill-with-docs`。裁决 Q4=B、Q5=读面、Q6=选项 1；执行流证据来自只读子代理对 `agentRegistry` / `aliasRegistry` 的冷/热查询追踪。
- 关键证据：vendor DSH 0.2.1-rc.2 的 `SubagentStartRequest` 已无 `persona`/`toolFilter`，新子代理走 agent preset；这会改 summon 的设计，但不属于本票读面。记录在 `map.md` 的 Fog，供 07 票修订。
- HMR required-row 证据：`plugin_manager` 安装/启用把 bundle 所有 row 当 required，pending 即激活失败。故 core 行与 Provider 行同票。
- deck 闸本轮仍 defer；按 markdown 约定直改票面与 `map.md`，待闸恢复后补报 #18。
