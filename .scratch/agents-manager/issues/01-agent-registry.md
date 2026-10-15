# 01 — agent 文档注册与发现

Status: resolved
Type: task
Blocked by: 10（`10` 已于 2026-10-14 `resolved` 并装入本 profile ⇒ 本票现可开工）

## 范围

实现 agent 文档的发现、解析与注册（spec §5.1、D19–D24；术语见 `CONTEXT.md`）：

1. **多根发现（4 根 + bundled；结构照抄，ADR-0001）**
   - 根集：用户级 `$DSH_HOME/agents/`、`$DSH_AGENTS_HOME/agents/`（默认 `~/.agents/agents`）；项目级 `<项目根>/.dsh/agents/`、`<项目根>/.agents/agents/`（项目根由 cwd 经 `findProjectRoot` 上溯语义得出）。
   - rank 照抄原生常量值（`skill/skill-filesystem/src/index.ts:35-39`）：`PROJECT_DSH 100 < PROJECT_AGENTS 200 < CUSTOM 300 < USER_DSH 400 < USER_AGENTS 500 < BUNDLED 600`，**低 rank 胜** ⇒ workspace 胜；跨根去重以 agent-name（目录名）为键，rank 升序遍历首个胜。
   - 委托边界（D22）：不注册进 `ctx.skills`、不 import 原生包（import 不可达 + 零依赖守卫 `scripts/check.mjs:188`）；根表/rank/查询形状/invalidate 镜像原生（`roots()` 参照 `skill/skill-filesystem/src/index.ts:244-263`，locator 参照 `:730-740`）；小助手照抄语义：`resolveDshHome`/`resolveAgentsHome`（`util/home-paths/src/index.ts:151`）、`findProjectRoot` 上溯（`skill/skill-filesystem/src/index.ts:952`）、`optionalFileSystem` 的 ctx 优先读法（`:849`）。
2. **目录制布局（D19，ADR-0002）**
   - agent = `<根>/<agent-name>/<agent-name>.agent.md`，一个目录一个 agent；agent-name 小写 kebab `[a-z0-9]+(-[a-z0-9]+)*`，保留字 `default`。
   - 身份 = 目录名；显示名 `name` 缺省回退目录名；frontmatter `id` 废弃（仍写 ⇒ `unexpected-id` 诊断，值按原文进 `extra`）。
   - 平铺 `*.md` 不是 agent 位置：根下 kebab 形状的 `*.md` 或 `*.agent.md` ⇒ `misplaced-file` 诊断并提示正确形状；agent 目录内杂散文件静默忽略（未来扩展位）；无 frontmatter 块的合规命名文档 = 全默认合法 agent。
3. **frontmatter 解析（D23：自写最小 YAML 子集，零运行时依赖）**
   - `---` 围栏；已知键类型化：标量/引号串/流式与块式字符串数组/`{provider, model}` 流式映射；未知键按原文保留进 `extra`；已知键出现不支持的构造 ⇒ `unparseable-frontmatter` 诊断。原生参照（围栏切分 + `yaml` 包，本包不可用）：`skill/skill-filesystem/src/index.ts:812`、`:924`。
   - 字段：`name`/`description`/`color`/`emoji`（Agency 兼容）、`modelOrder: string[]`（别名名）、`model: {provider, model}[]`（D5 逃逸口）、`requiredTools: string[]`、`skills: string[]`（D20 预置技能名）、`spawn: 'spawn'|'fork'`、`reasoningEffort`。正文 = 文档正文（`AgentDefinition.body`，术语见 `CONTEXT.md`）；`source`/`origin` 由发现层派生，不进 frontmatter。
4. **懒发现 + 服务契约（D24，冻结）**：首次查询按 cwd（解析后项目根）记忆化，无 watcher；`invalidate()` 清缓存，下次调用重扫（in-flight 去重）。`registry.ts` 哑容器保留为内部类型与单测载体（`createAgentRegistry` 不删），`size` 移出服务面；跨根同名覆盖不诊断（胜者 `source` 记录出处）。
5. **诊断面（D21）**：`AgentDiagnostic { path, code, message, agentName? }`；软处理 = 跳过 + `logger.warn`，不阻断启动（坏 agent 不可见即不可用；UI 05 后补）。code ∈ `invalid-agent-name | reserved-id | missing-document | misplaced-file | unparseable-frontmatter | unexpected-id | no-model-order`；`no-model-order` = `modelOrder` 与 `model` 都缺 ⇒ 警告（仍注册）。
6. **内置默认 agent（D4/D19）**：`bundled/default/default.agent.md`——`name: 默认`、一句话 description、`modelOrder: [dsh-default]`、`requiredTools: []`、`skills: []`、正文空；bundled 根 rank 600、`origin: built-in`、**受信**：解析失败 = 硬错（实现为 bundled 根受信，非 if-default 分支）。用户/项目根出现 `default` 目录 ⇒ `reserved-id` 诊断 + 跳过。零特例：与用户 agent 同一管线。
7. **服务挂点**：`ctx.agentRegistry`（`src/index.ts` 的 `AGENT_REGISTRY_SERVICE`，票 10 已就位）——**勿用 `agents`**（原生 `ctx.agents` 已占用）。

## 契约（冻结：03/05/06 消费面，D24）

```ts
export interface AgentRegistry {
  list(options?: { cwd?: string; signal?: AbortSignal }): Promise<readonly AgentDefinition[]>
  get(agentName: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<AgentDefinition | undefined>
  diagnostics(options?: { cwd?: string }): Promise<readonly AgentDiagnostic[]>
  invalidate(): void
}
export interface AgentDiagnostic {
  readonly path: string
  readonly code: 'invalid-agent-name' | 'reserved-id' | 'missing-document' | 'misplaced-file'
             | 'unparseable-frontmatter' | 'unexpected-id' | 'no-model-order'
  readonly message: string
  readonly agentName?: string
}
export interface AgentDefinition {
  readonly agentName: string              // = agent-name（目录名）；保留字 default
  readonly name: string                   // frontmatter name ?? agentName
  readonly description: string            // frontmatter ?? ''
  readonly body: string                   // 文档正文
  readonly modelOrder?: readonly string[]
  readonly model?: readonly { provider: string; model: string }[]
  readonly requiredTools?: readonly string[]
  readonly skills?: readonly string[]     // 预置技能名（D20）
  readonly spawn?: 'spawn' | 'fork'
  readonly reasoningEffort?: string
  readonly color?: string
  readonly emoji?: string
  readonly source: 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents' | 'bundled'
  readonly origin: 'built-in' | 'user'
  readonly extra: Readonly<Record<string, string>>
  readonly path: string                   // 文档绝对路径
}
```

## 验收

- 单测：四根发现（home 与项目根均可注入伪造，含 `.agents` 两处）；跨根同名去重（workspace 胜）；目录制布局与文档命名（含 `unexpected-id`）；agent-name 语法（非法 / 保留字 `default`）；无 frontmatter = 全默认；`misplaced-file` / `missing-document` / `unparseable-frontmatter` / `no-model-order` 诊断；`extra` 原文保留；legacy `model` 数组解析；bundled 默认走同一解析路径（无 if-default 分支）且受信根解析失败抛硬错；`invalidate()` 后重扫；查询选项形状与 `SkillLookupOptions` 同构（`skill/skill/src/index.ts:103-108`）。
- 委托边界可检查：未注册进 `ctx.skills`；未新增运行时依赖；根表/rank/查询形状与原生同构（实施说明点名照抄了哪一层）。
- `npm run check` 通过（含锚点）。

## Comments

- 来源：grilling 共识 D2/D3/D4（spec §2.2）。

### 诊断记录（/triage，2026-10-14）

> *This was generated by AI during triage.*

**现象**：本票要求的能力（agent.md 双根发现、双布局、frontmatter 解析、内置「默认」agent、内部 service）在当前代码库中不存在；本仓库亦无任何源码，票处于**未动工**状态。

**影响范围**：03/04/05/06/07 全部消费本票产出的注册表 service（03 直接 `Blocked by: 01`）；脚手架缺失同时影响 01–07 的实现，08/09（research）不受影响。

**核验证据（最小复现）**

- `grep -rn "agent.md" ~/repo/deepseek-harness/packages --include=*.ts` → **0 命中**（DSH `0.2.1-alpha.3`）⇒ 无既有实现，本票非重复劳动。
- `ls -d $DSH_HOME/agents ~/.agents/agents $WORKSPACE/.dsh/agents` → 三者均**不存在** ⇒ 双根目录尚未建立。
- 仓库根 `ls`：只有 `agent-control-prototype.html` / `AGENTS.md` / `docs/` / `.scratch/`，无 `package.json`、无 `src/`、无测试配置 ⇒ 票面「单测」验收当前**无法执行**，需先落脚手架。
- 先例核验（可定位）：`packages/skill/skill-filesystem/src/index.ts:244-263` 的 `roots()`；`bundledSkillDir` 先例 = `dsh-mattpocock-skills-deck/bundled-skills/`、`@michengai/dsh-agency-agents/assets`（均存在）。
- 原型参照 `agent-control-prototype.html:280` 的 `resolveModel` 存在（03 票的规格参照有效）。
- `.out-of-scope/` 知识库不存在 ⇒ 无历史拒绝记录可比对。

**根因候选（置信度）**

- **C1（95%）** 功能确属未实现（能力缺口，非 bug）；「现象」= DSH 无面向用户的 agent 层，本票是全新实现票。
- **C2（90%，已核验）** 票面「镜像 skills 模式」与实际不符：`roots()` 的真实默认根是 **4 个**（项目级 `.dsh/skills` + `.agents/skills`，用户级 `$DSH_HOME/skills` + `$DSH_AGENTS_HOME/skills`，另有 custom/bundled），票面只列 2 个 ⇒ 实施者照字面「镜像」会与 spec D2 的显式列表冲突（实施漂移风险）。
- **C3（85%）** 无脚手架票：验收要求单测，但仓库无包清单/测试栈/插件 dev 挂载方式，本票隐含承担整个插件项目的初始化，与 01–07 的边界未划。
- **C4（95%，已核验）** 引用行号漂移：票面「双布局（参照 `:676/:687/:729`）」，实际 `:730-740` 是 `discoverRoot` 的 locator 判定、`:688-695` 是 `isPotentialSkillPath`；`:676` 属 `isRelevantWatchEvent` 的 addDir/文件分类，`:687` 是空行，`:729` 落在 `hasErrorCode` 内。符号名可定位，不阻塞。
- **C5（70%）** 范围第 5 条「暴露为内部 service」的接口形状、以及 frontmatter 非法/缺 id 的报错面（启动期 throw？日志？UI 列表？）未定 ⇒ 由消费点 03/05/06 反推或实施时自定。

**分流结论**：终态 **维持 `ready-for-agent`**（未动工 + 无既有实现 + 无历史拒绝 + 验收标准可测；先例路径与符号已核验）；下列待确认事项不阻塞实施，按推荐答案执行即可。

**待确认事项（对应收尾 ❓）**

1. 脚手架归属：新开 `10-scaffold` 票作为 01–07 的前置，还是并入 01 范围？
2. 根集：v1 按 spec D2 只做 2 根（并把票面「镜像 skills 模式」改写为「参照 `roots()` 的 rank/去重结构」），还是补齐 `.agents/agents` + `$DSH_AGENTS_HOME/agents` 以与 skills 真正对齐？
3. 票面行号是否修正为 `:730-740` / `:688-695`（纯文档修正）？
4. service 接口与错误面是否需要在动手前落成契约，还是交给实施者按 03/05/06 消费点自定？

### 维护者裁决（2026-10-14）

> *This was generated by AI during triage.*（记录维护者对上述 4 问的答复与已执行动作）

- **Q1 → 开脚手架票**：已建 `issues/10-plugin-scaffold.md`（原编号 `00`，2026-10-14 改号；`ready-for-agent` → 当日实施后 `resolved`，带 agent brief 与 Answer），并把 `Blocked by: 10` 加进本票与 02–07；08/09（research）不受其阻塞。
- **Q2 → 按原生 skill 机制的结构做，尽量委托原生机制**：本票范围第 1 条已改写为 4 根 + 原生 rank 表 + 「尽量委托 `ctx.skills` 机制」约束；票面「镜像 skills 模式」措辞已替换。委托边界（原生只认 `SKILL.md`/`<name>/SKILL.md`，agent.md 需自有解析）写进范围第 1 条末句。
- **Q3 → 已更新引用**：双布局锚点从 `:676/:687/:729` 改为 `:730-740`（`discoverRoot` locator）与 `:688-695`（`isPotentialSkillPath`）；`roots()` 锚点从 `:242-261` 改为 `:244-263`。
- **Q4 → 暂缓**：service 接口与错误面契约后补，不阻塞本票进入实施。

### 脚手架交接（2026-10-14，票 `10` resolved）

> *This was generated by AI during implementation.*

- **可直接消费的注册点**：`ctx.agentRegistry`（`src/index.ts` 的 `apply` 用 `ctx.effect(() => ctx.provide(AGENT_REGISTRY_SERVICE, registry))` 注册；插件卸载即移除）。本 profile 已装（`install_bundle` → `application: applied`）。
- **现成接口**（`src/registry.ts`）：`AgentRegistry { size; list(); get(id); register(def) }`，`AgentDefinition` 目前只有 `{ id, description, source }`。**本票按 frontmatter 需要扩展字段**（`name`/`color`/`emoji`/`modelOrder`/`requiredTools`/`includes`/`spawn`/`reasoningEffort` 等；`source` 已预留为发现根标记）。
- **key 命名**：`agentRegistry`（勿改回 `agents`，原生 `ctx.agents` 已占用；详见票 10 的 `## Answer` 第 1 条）。
- **工具链**：`npm test`（vitest）、`npm run build`（tsc → `lib/`，安装前必须构建）、`npm run typecheck`；源码内相对 import 写 `./x.ts`（emit 时改写为 `./x.js`）；单测放 `test/`。用 npm 而非 pnpm（沙箱只允许写 workspace，pnpm 全局 store 会 EROFS）。
- **内置「默认」agent 落点**：`bundled/`（票 10 已建目录并留 README；本票范围第 4 条往这里放）。
- **Q4 仍可自定**：容器已存在，service 接口形状与 frontmatter 报错面可按 03/05/06 消费点确定，无需另立契约票。

### 二轮 grilling 裁决 + agent brief（/triage /grill-with-docs，2026-10-14 第二轮）

> *This was generated by AI during triage.*

**裁决记录**（Q11–Q16；Q14 维护者原话「用最小化轮子（只是yaml解析器）」= 自写最小解析器；其余按推荐）：

- **Q11 委托条件不成立 ⇒ 结构照抄**（ADR-0001）：本包 realpath 动态导入 `@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-skill-filesystem` / `yaml` 全 `ERR_MODULE_NOT_FOUND`；原生 locator 硬编码 `SKILL.md`；往 `ctx.skills` 注册 = 类型 launder + 读面污染。当日上午「尽量委托」裁决自此落定为条件式并关闭。
- **Q12 布局细化全按推荐**（ADR-0002）：砍裸名文件变体；平铺死亡（`misplaced-file`）；agent-name 收紧为小写 kebab；frontmatter `id` 废弃 + `unexpected-id`；杂散文件忽略；无 frontmatter = 合法默认。
- **Q13** `includes` 改名 **`skills`**（预置技能名数组；存在性 06 警告；投递方式 = 04/07 设计题）。
- **Q14** 自写最小 YAML 子集解析器（零运行时依赖）。
- **Q15** 契约冻结（见上「契约」节）；**03 票需同步**：其「modelOrder 条目为 raw」旧读法改为「链 = `modelOrder` 别名在前、`model` raw 兜底在后」（spec §5.3 已改，03 票正文动工前修订）。
- **Q16** bundled 默认按推荐（`default/default.agent.md`、受信硬错、用户 `default` ⇒ `reserved-id` 跳过）。
- 一轮裁决回顾：Q1=B 懒发现（无 watcher）；Q4/Q7/Q8 按推荐（discovery 决胜 / 哑容器、legacy `model` + `extra` 原文保留、`source`/`origin` 分立）；Q5 软诊断 UI 后补；Q6 疑惑就警告；Q9 `includes` 重义为预置技能名；Q10 `default` 保留字。
- 事实备注：`AGENT_CONFIG` 非 DSH 环境变量（全树 0 命中）= 维护者对「四个发现根」的泛指。随本轮落地：`CONTEXT.md`（12 术语）、`docs/adr/0001`、`docs/adr/0002`、spec D19–D24 与 §5.1/§5.3/§6/§8 同步。

## Answer

> *This was generated by AI during implementation (2026-10-15).*

**结论**：agent 文档的发现、解析与注册已按冻结契约落地，`npm run check` 全绿（39 用例 / 43 锚点 / typecheck / build 新鲜 / 运行时零依赖）；本票 `resolved`。

> *2026-10-15 更正（`/code-review` 发现）*：本轮交付快照上 `npm run check` **首跑未通过**（`✗ build 不新鲜：src/ 比 lib/ 新`，`src/discovery.ts`、`src/file-system.ts` 晚于 `lib/`），重建后实际为 **40 用例 / 44 锚点**；故上面「39 用例 / 43 锚点 / build 新鲜」与本 Answer 的运行时 smoke 都**早于最后两次源码改动**。缺陷修复、契约成员改名与接受的偏差见下面的「修复轮」节。

**已交付**

- `src/types.ts`：冻结契约本体——`AgentRegistry`（`list`/`get`/`diagnostics`/`invalidate`）、`AgentDefinition` 全字段（含 `source`/`origin`/`extra`/`path`）、`AgentDiagnostic` + 7 个 code、`AgentLookupOptions`/`AgentDiagnosticsOptions`。
- `src/frontmatter.ts`：最小 YAML 子集解析器（D23），零运行时依赖——`---` 围栏、标量/引号串、流式与块式字符串数组、`{provider, model}` 流式（及无括号 `provider: x, model: y`）映射；已知键类型化，未知键原文进 `extra`；已知键的不支持构造产出 `problems`。
- `src/file-system.ts`：发现层的 fs 端口 + 两个实现（Node / ctx `fs` 服务）+ `optionalFileSystem(ctx)`；缺路径一律降级为 `undefined`/`false`（照抄原生 absence 语义）。
- `src/discovery.ts`：四根 + bundled 根表（rank 100/200/400/500/600，低 rank 胜，CUSTOM 300 预留）、`findProjectRoot` 上溯、目录制布局与全部诊断、软诊断 + `logger.warn`、受信根硬错、`invalidate()` 与按项目根记忆化的懒发现（含 in-flight 去重）；`resolveDshHome`/`resolveAgentsHome` 语义照抄。
- `src/registry.ts`：哑容器保留为扫描的内部存储与单测载体（`createAgentRegistry` 未删），`size` 不在服务面。
- `src/index.ts`：`apply(ctx)` 组装服务（注入 `optionalFileSystem(ctx)` + `ctx.logger.warn` + 由 `import.meta.url` 推出的 `bundled/`），仍只注册 `agentRegistry` 一个 key。
- `bundled/default/default.agent.md`：内置默认 agent（`name: 默认`、`modelOrder: [dsh-default]`、空正文），走同一条文档管线，无 if-default 分支。
- 单测 4 文件 40 用例：`test/frontmatter.test.ts`（9）、`test/discovery.test.ts`（22）、`test/plugin.test.ts`（5）、`test/registry.test.ts`（4）。

**证据**

- `npm run check` → `check: 通过`（self-test 通过；`✓ 扫过锚点 43 处`；build 新鲜；运行时依赖为空；devDeps 已装；typecheck 通过；`Test Files 4 passed / Tests 39 passed`）。**（计数与「build 新鲜」据上文更正为 44 锚点 / 40 用例；交付快照需先 `npm run build`。）**
- 构建产物真机 smoke（`lib/index.js` + 真实 Cordis `Context`，即 profile 加载的那一份）：`apply` 后 `ctx.get('agentRegistry')` 面 = `diagnostics,get,invalidate,list`；`get('default')` → `{agentName:'default', name:'默认', source:'bundled', origin:'built-in', modelOrder:['dsh-default'], body:'', path:'<workspace>/bundled/default/default.agent.md'}`（成员名以修复轮后的契约为准）；`list()` → 只有 `default@bundled`（本机 `~/.dsh/agents`、`~/.agents/agents` 不存在，无 cwd ⇒ 项目根不参与）；`diagnostics()` → `[]`；`lib/*.js` 无任何非 `node:` 裸 import（运行时零依赖）。
- 挂载/卸载：真实 `Context` 上 `fork.dispose()` 后 `ctx.get('agentRegistry')` 回到 `undefined`；`ctx.get('skills')` 始终 `undefined`（委托边界：未注册进原生 skills 面）。
- 未做：本会话没有 `plugin_manager` / `cordis_inspect_query` 工具（`docs/agents/harness-facts.md` 点名的通道在本次不可用），故没有重跑 `install_bundle` 与 loader-entry 读回；证据以上面的构建产物 smoke 为准（该产物就是软链 profile 加载的对象）。

**实现期决定（与票面的差异/细化）**

1. **新增 devDependency `@types/node@^24`**：源码需要 `node:fs/promises`、`node:path`、`node:os`、`node:url` 的类型；运行时依赖仍为空（守卫只管 `dependencies`）。工具链事实已补进 `docs/agents/harness-facts.md`。
2. **受信 bundled 根绕过注入的 fs 端口**（原生 `trustedHost` 同构）：注入的端口（修复轮后名为 `resolveFileSystem`）只作用于 4 个非受信根，bundled 根直读 Node。单测里「一次扫描只列 N 个根」的计数断言据此为 4 而非 5。
3. **advisory 诊断在受信根不抛**：`unexpected-id` / `no-model-order` 仍照常记录 + 注册；受信根里只有会让 agent 消失的诊断才升级为 `AgentDocumentError`。
4. **无 frontmatter = 合法但会得到 `no-model-order` 警告**：文档合法（全字段默认），但它没有模型链，按 Q6「疑惑就警告」记录 advisory。同理 `modelOrder: []` 与空 `model:` 视为缺省。
5. **未闭合的 `---` 围栏 = `unparseable-frontmatter`**：原生 skills 把它当「没有 frontmatter」而跳过；本票的 agent 侧「没有 frontmatter」是合法的，所以这里选择更响的处理（否则断掉的围栏会静默变成 persona）。
6. **查询选项用原生写法**：`{ readonly cwd?: string | undefined; readonly signal?: AbortSignal | undefined }`（`skill/skill/src/index.ts:103-108` 的形状），比票面简化写法多一个显式 `| undefined`，对调用方更宽松。
7. **`diagnostics()` 与 `list()` 共用一次扫描**：同一项目根只扫一遍，两条读面都从该结果派生；`list()` 结果按「根 rank 升序 → 根内文件名序」稳定排序。
8. **摘要里的 `AgentDefinition.requiredTools`/`skills` 空数组不出现**：空数组解析为缺省（内置默认 agent 的 `requiredTools: []`/`skills: []` 因此不在定义上）。

**验收对照**（见上方 `## 验收` 与 Agent Brief 的 6 条）

- 四根发现 + 跨根去重（workspace 胜）：`test/discovery.test.ts` 的 roots 组（4 例）覆盖；home 与项目根全部为注入的临时目录。
- 目录制布局全套：`layout` 组逐项覆盖（命名语法、保留字、无 frontmatter、`misplaced-file`、杂散文件忽略、`unexpected-id`、`missing-document`）。
- frontmatter 类型化 + 原文保留 + 不支持构造诊断：`test/frontmatter.test.ts` 9 例 + `layout`/`types the documented fields` 端到端例；legacy `model` 数组可解析。
- bundled 默认同管线 + 受信硬错 + 用户 `default` 被跳过：`bundled root trust` 3 例 + `rejects a user-authored default directory`。
- `invalidate()` 后重扫 / `{cwd, signal}` 形状：`lazy memoisation` 4 例（含并发去重、abort、user-only 与 project 分开记忆化）。
- 未注册进 `ctx.skills`、未新增运行时依赖、`npm run check` 通过：`test/plugin.test.ts` 第 3 例 + check 的 bundle/anchors/self-test 项。

**移交下游**：契约即票面「契约（冻结）」节，也是 `src/types.ts` 的导出；03/05/06 直接消费 `ctx.agentRegistry`。**成员名以「修复轮」为准**：`AgentDefinition.agentName` / `AgentDefinition.body` / `AgentDiagnostic.agentName`（`id` 只留给已废弃的 frontmatter 键）。03 票动工前需按本轮语义同步其「modelOrder 条目为 raw」旧读法（链 = 别名在前、`model` 兜底在后）。

### 修复轮（/code-review 两轴 + /implement，2026-10-15）

> *This was generated by AI during implementation.*

**来源**：对本票交付快照（未提交 diff，fixed point `13abc67`，21 文件 +2079/−85）跑 `/code-review` 两轴评审，产出 Standards 8 条、Spec 9 条。下面逐条处置。

**Spec 轴（缺陷，已修）**

1. **ctx `fs` 端口保真**：`apply()` 曾一次性快照 `optionalFileSystem(ctx)` ⇒ 本插件之后挂载的 `fs` 服务被静默忽略、转真 Node 读。改为**按用时解析**：依赖项由 `fileSystem`（端口）改为 `resolveFileSystem: () => AgentFileSystem | undefined`，`apply` 传 `() => optionalFileSystem(ctx)`。回归测试两层：`test/plugin.test.ts` 的「reads through an fs service mounted after the plugin」+ `test/discovery.test.ts` 的「resolves the injected fs port at scan time…」。
2. **`extra` 原文保留**：`blockLines.join('\n').trim()` 只吃掉首行缩进（`notes:` 块 → `keep: me\n  also: me`），且旧测试把该失真固化为期望。改为 `dedentBlock()`：剥掉**公共缩进**、保留每行相对形状；`test/frontmatter.test.ts` 的 `notes` 期望改为 `keep: me\nalso: me`，并新增「removes only the common indent of a block value, keeping the deeper shape」一例。
3. **受信根 advisory 行为无测试**：新增 `test/discovery.test.ts` 的「keeps a trusted agent with advisory findings instead of failing the scan」——`unexpected-id` / `no-model-order` 在 bundled 根照常记录 + 注册，不抛 `AgentDocumentError`（把 Answer「实现期决定」第 3 条固化）。
4. **Answer 证据计数错误**（39 用例 / 43 锚点 / 「build 新鲜」）：已在上方就地更正并说明原因（交付快照上 `npm run check` 首跑卡在 `build 不新鲜`）。

**Standards 轴**

5. **契约成员改名（硬违反 → 已按 `CONTEXT.md` 修正）**：`AgentDefinition.id` → `agentName`、`AgentDefinition.persona` → `body`、`AgentDiagnostic.id` → `agentName`、`RESERVED_AGENT_ID` → `RESERVED_AGENT_NAME`，测试名与 `test/registry.test.ts` 的 helper 同步。依据：`CONTEXT.md` 对 `id`/`persona` 的 `_Avoid_` + `docs/agents/domain.md`「代码与测试命名用词汇表术语」。**形状与语义零变化，只改成员名**；本票「契约」节已同步，03/05/06 请用新名。
6. **每查询重复 `findProjectRoot`**（原 `:139` 与 `:305`）：改为每查询解析一次，记忆化键与根表共用同一个项目根。
7. **根 README 契约失实**（「scaffold only… belongs to tickets 01–07」）以及 `package.json` description 的同类陈述：已改写为当前交付面（服务面四方法、目录制布局、根集与 rank）。
8. **机器相关测试**：`test/plugin.test.ts` 的 `get('default')` 曾读开发者真实 `~/.dsh/agents`、`~/.agents/agents`；现在用 `vi.stubEnv('DSH_HOME' / 'DSH_AGENTS_HOME')` 指向临时 home，并断言 `list()` 只有 `default`。

**接受为偏差 / 记为债务（不阻塞关闭）**

- **(a)1 未缩进的块序列**（合法 YAML 的 `model:` + 顶格 `- {…}`）按 `unparseable-frontmatter` 处理。spec §5.1 的示例形状是缩进块，D23 只承诺最小子集 ⇒ 接受为限制；将来若要收，动 `src/frontmatter.ts` 的 `INDENTED_RE` 块收集逻辑。
- **`CUSTOM_RANK` 死导出**：范围第 1 条明写「CUSTOM 300 预留」⇒ 有意保留（原生 `roots()` 亦恒推入 custom 目录）。
- **`AgentRoot.rank` 写而不读**：rank 常量值照抄原生根表（ADR-0001），保留字段让根表一眼可对；实际顺序来自数组序。
- **`source`/`origin`/`trusted` 共变、`src/frontmatter.ts` 双职责、三个手写引号扫描器**：判断项坏味道；解析器小而测得住，重构收益/回归风险不划算，记为债务（若要收，先补 frontmatter 边界例）。
- **`src/index.ts` 多导出的内部件、`@types/node` devDependency**：前者供测试与下游直接引用，后者是源码类型所需（运行时依赖仍为空），均保留。

**修复轮证据**：`npm run build` + `npm run check` 全绿（4 文件 44 用例 / 44 锚点 / typecheck / 运行时零依赖）。构建产物真机 smoke（`lib/index.js` + 真实 Cordis `Context`，`DSH_HOME`/`DSH_AGENTS_HOME` 指向临时 home）：`apply` 后服务面 = `diagnostics,get,invalidate,list`；`get('default')` → `{agentName:'default', name:'默认', source:'bundled', origin:'built-in', modelOrder:['dsh-default'], body:''}`；`list()` → 只有 `default@bundled`；`diagnostics()` → `[]`；`ctx.get('skills')` → `undefined`；`lib/*.js` 只 import `node:` 与包内相对路径。

---

## Agent Brief

**Category:** enhancement
**Summary:** 从零实现 agent 文档的发现、解析与注册，以冻结契约挂到 `ctx.agentRegistry`。

**Current behavior:**
插件只有一个空壳注册点：`ctx.agentRegistry` 暴露一个不校验、无发现的哑容器（`AgentDefinition` 仅 `{id, description, source}`，`register()` 后写覆盖同 id）。磁盘上没有任何 agent 根目录，DSH 也没有 agent 文档概念。

**Desired behavior:**
- 四根 + bundled 懒发现（用户级两个 home 根、项目级两个，项目根由 cwd 上溯），rank 低者胜，跨根同名首个胜；显式 `invalidate()` 清缓存重扫；无 watcher、无文件监听。
- 目录制布局 `<根>/<agent-name>/<agent-name>.agent.md`；身份 = 目录名（小写 kebab，保留字 `default`）；显示名 `name` 缺省回退目录名；frontmatter `id` 废弃但值保留进 `extra`。
- 最小 YAML 子集解析：已知键类型化、未知键原文进 `extra`、不支持构造产出诊断；正文 = persona。
- 软诊断（跳过 + 日志 + `diagnostics()`），唯一硬错 = 受信 bundled 根解析失败。
- 内置默认 agent 走同一管线（`bundled/default/default.agent.md`，`modelOrder: [dsh-default]`），零 if-default 分支。
- 服务面换成票面「契约」节的冻结接口（`list`/`get`/`diagnostics` 带 `{cwd, signal}`，`invalidate()`）。

**Key interfaces:**
- `AgentRegistry`（服务键 `agentRegistry`）：从哑容器升级为 cwd 记忆化读模型；现有哑容器类型保留为内部载体供单测。
- `AgentDefinition` / `AgentDiagnostic`：按票面「契约」节的冻结形状（含 `source`/`origin`/`extra`/`path` 派生字段）。
- 查询选项与原生 `SkillLookupOptions {cwd?, signal?}` 形状同构。
- 建议新模块：发现（根表 + 扫描 + rank 决胜）与 frontmatter（最小解析器）各一个；现有容器模块保留。

**Acceptance criteria:**
- [ ] 四根发现（home 与项目根均可注入伪造）与跨根去重（workspace 胜）有单测
- [ ] 目录制布局全套行为有单测：命名语法、保留字、无 frontmatter、misplaced-file、杂散文件忽略、unexpected-id
- [ ] frontmatter 已知键类型化 + 未知键原文保留 + 不支持构造诊断有单测；legacy `model` 数组可解析
- [ ] bundled 默认 agent 经同一解析路径装载；受信根解析失败抛硬错；用户 `default` 目录被 `reserved-id` 跳过
- [ ] `invalidate()` 后下次查询重扫；`{cwd, signal}` 查询形状与原生同构
- [ ] 未注册进 `ctx.skills`、未新增运行时依赖；`npm run check` 通过

**Out of scope:**
- 别名与 registry.yaml（02）、解析引擎（03）、组装与通道（04）、UI（05）、目录注入与警告呈现（06）、召唤与替换（07）
- 预置技能的投递方式（04/07 设计题）与存在性警告（06）
- watcher / 文件监听（明确不做）
- 修改零依赖守卫或脚手架决定（npm 工具链、`agentRegistry` key）

**实施注意**（票 10 交接 + `docs/agents/harness-facts.md`）：npm（非 pnpm）；相对 import 写 `./x.ts`；改 `src/` 后必须 `npm run build` 再装；票面 `path:line` 锚点动工前真机复核。

