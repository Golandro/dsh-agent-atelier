# 基础系统提示词的配置来源枚举（Profile / preset / patch）

> 研究题：[#78](https://github.com/Golandro/dsh-agent-atelier/issues/78)「研究：基础系统提示词的配置来源枚举」。
> 日期：2026-11-24。执行：research 子代理（分支 `research/prompt-source-enumeration`）。
> 一手源：仓库内真实 checkout `.vendor/deepseek-harness/`（可读可搜，未修改）。所有 `path:line` 均相对仓库根；宿主源码前缀 `.vendor/deepseek-harness/` 下文省略为 `<H>/`，本仓文件直接写相对路径。

---

## 0. 结论摘要

1. **能写 `system-prompt` 行 config 的层只有 Loader patch 层**：bundle 补丁（按 `dsh.profile.bundles` 顺序）→ profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml`（home 层）→ `--patch` 叠加（argv 顺序）→ 遥测开关补丁。证据：`<H>/packages/boot/app-boot/src/profile.ts:5-14`、`<H>/apps/cli/src/profile-boot.ts:211-236`、`<H>/packages/boot/app-boot/src/profile-context.ts:74-85`。
2. **补丁是「整键替换」而非深合并**：后层的 `config` 整体覆盖前层，不做逐字段合并，所以每层必须重述自己拥有的全部键。证据：`<H>/vendor/include/src/patch.ts:102-105`、`<H>/packages/bundle/web-app/cordis.patch.yml:5-6`。
3. **`system-prompt` 行 config 只有 5 个字段**（`includeHarnessIdentity` / `includeRuntimeContext` / `personaPrefix` / `personaSuffix` / `toolOrder`），默认值由 schemastery 在插件加载时施加，YAML 里读到的是**原始值**。证据：`<H>/packages/core/system-prompt/src/index.ts:264-286`、`index.ts:437-444`。
4. **preset 不写这一行的 config**；preset 用 `@deepseek-ai/dsh-persona` 在**自己的 scope** 注册同名 section `deployment:persona-prefix` 来遮蔽部署级 persona。证据：`<H>/packages/preset/persona/src/index.ts:62-75`、`<H>/packages/core/system-prompt/src/index.ts:191-197`、`<H>/packages/preset/agent-preset/src/index.ts:12-29`。
5. **harness identity 是代码里的固定串**（`includeHarnessIdentity` 关掉即消失），**runtime context 由各插件注册**（working-directory 等），**tool order 只决定排序、工具集来自 provider**。证据：`index.ts:456-462`、`<H>/packages/session/working-directory/src/index.ts:90-96`、`<H>/packages/core/tools/src/index.ts:113-118`、`index.ts:233-247`。
6. **预览可静态枚举到「补丁合成后的原始 config」，但枚举不到「加载后的有效 config」**：`--dump-config` 明确不求值 `!!js`、不跑 schemastery 默认值。证据：`<H>/apps/cli/src/dump-config.ts:2-6,51-74`、`<H>/apps/cli/src/args.ts:173`。
7. **preset 组合可在不建 Agent/会话的前提下读取**（`compositionInventory()` / `pluginInventory`），但需要宿主已挂载 registry。证据：`<H>/packages/preset/agent-preset-registry/src/index.ts:400-413`、`<H>/packages/host/plugin-inventory/src/index.ts:104-120`。
8. **手改文件与宿主实际装配的分叉点有三处**：home/overlay 压过 profile 层（config-editor 会显式报错）、preset 作用域 section 遮蔽部署 persona、`!!js` 与默认值只在加载时求值。证据：`<H>/packages/boot/config-editor/src/index.ts:134-140`、`persona/src/index.ts:63-68`、`<H>/packages/boot/app-boot/src/index.ts:571-588`。

---

## 1. profile 加载链与各层可写性

### 1.1 目录与合成顺序

- profile 目录 = `$DSH_HOME/profiles/<name>`，内含 `package.json`（`dsh.profile.bundles` 有序列表）与用户自己的 `cordis.patch.yml`。证据：`<H>/packages/boot/app-boot/src/profile.ts:5-14,38-42`。
- 目录解析：`resolveProfileDir`（拒绝空名、含斜杠、`node_modules`）。证据：`profile.ts:159-172`。
- bundle 解析顺序：**安装锚点优先，其次 profile 目录**。证据：`profile.ts:639-661`。
- 单 profile 目录加载：按 `manifest.dsh.profile.bundles` 顺序逐个取 `dsh.bundle.patch`（字符串或数组）→ 再读 profile 自己的 patch 文件。证据：`profile.ts:678-713`。
- 启动器层叠加：bundle 层 → profile 用户层 → home 层（`$DSH_HOME/cordis.patch.yml`，「机器级偏好，压过 per-profile 层」）→ `--patch` 叠加（argv 顺序）→ 遥测开关。证据：`<H>/apps/cli/src/profile-boot.ts:211-236`；home 路径 `profile-boot.ts:67-75`。
- 运行时重读同一顺序：`readProfilePatches` = bundles + profile patch + home patch + overlays + telemetry patch。证据：`<H>/packages/boot/app-boot/src/profile-context.ts:74-85`。
- 合成算法 = `applyEntryPatches`（同一空根上一次性叠加），`composeEntries` 是对外入口。证据：`profile.ts:747-762`。

### 1.2 哪些层能写 `system-prompt` 行 config

行由 base bundle 插入并给出初值：

```yaml
# <H>/packages/bundle/base/cordis.patch.yml:508-513
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
  config:
    personaPrefix: ''
```

之后任何一层都能按 `id: system-prompt` 覆盖 `config`（整键替换）：

| 层 | 能否写该行 config | 证据 |
| --- | --- | --- |
| bundle 补丁（按 `dsh.profile.bundles` 顺序，base 最先） | 能；web-app 就覆写了 `personaPrefix` | `<H>/packages/bundle/web-app/cordis.patch.yml:17-20`；顺序 `<H>/packages/boot/app-boot/src/profile.ts:689-703` |
| profile 自己的 `cordis.patch.yml` | 能 | `profile.ts:708-711` |
| `$DSH_HOME/cordis.patch.yml`（home 层） | 能，且压过 profile 层 | `<H>/apps/cli/src/profile-boot.ts:215-217,67-75` |
| `--patch <file>`（可重复，argv 顺序） | 能，最后生效 | `profile-boot.ts:234`；`<H>/apps/cli/src/args.ts:170-173` |
| `DSH_TELEMETRY_DISABLED` 派生补丁 | 不能（只改 `session-telemetry-otel` 行） | `<H>/packages/boot/app-boot/src/profile-context.ts:39-55` |
| preset 的 `plugins` 列表 | **不能**：preset 子行挂在自己的 scope，不写宿主 `system-prompt` 行 | `<H>/packages/preset/agent-preset/src/index.ts:12-29`、`<H>/packages/preset/agent-preset-registry/src/mount.ts:204-215` |

补丁语义的两条硬约束：

- 后层 `config` **整对象替换**前层（`target[key] = value`），没有字段级合并。证据：`<H>/vendor/include/src/patch.ts:102-105`；web-app 补丁头注释明说「A patch replaces the targeted row's whole `config`」。证据：`<H>/packages/bundle/web-app/cordis.patch.yml:1-6`。
- `name` 不匹配只警告并跳过；`insert` 追加到列表尾。证据：`patch.ts:65-100`。

---

## 2. `system-prompt` 行 config 的字段与默认值

### 2.1 字段清单

```ts
// <H>/packages/core/system-prompt/src/index.ts:264-286
export interface Config {
  includeHarnessIdentity?: boolean   // 固定开场白，默认 true
  includeRuntimeContext?: boolean    // 可选运行时上下文快照，默认 true
  personaPrefix?: string             // 部署级 persona 前缀，默认 ''
  personaSuffix?: string             // 部署级 persona 后缀，默认 ''
  toolOrder?: string[]               // 面向模型的工具顺序，须含且仅含一个 '<unlisted-tools>'
}
```

运行时默认值（schemastery，插件加载时施加）：

```ts
// <H>/packages/core/system-prompt/src/index.ts:437-444
includeHarnessIdentity: z.boolean().default(true),
includeRuntimeContext: z.boolean().default(true),
personaPrefix: z.string().default(''),
personaSuffix: z.string().default(''),
toolOrder: z.array(z.string()).default(undefined as unknown as string[]),
```

`toolOrder` 形状在加载时校验（必须恰好一个 rest 标记），**未知工具名要等到 `assemble()` 才报错**。证据：`index.ts:215-225`、`index.ts:239-241`。

### 2.2 段位与注册点

- 段位常量：`HARNESS_IDENTITY: -1000`、`DEPLOYMENT_PERSONA_PREFIX: 0`、`DEPLOYMENT_PERSONA_SUFFIX: 10200`。证据：`index.ts:136-172`。
- 构造函数注册三段：identity（`includeHarnessIdentity` 为真时）、persona prefix、persona suffix；`includeRuntimeContext: false` 时调 `suppressRuntimeContext()`。证据：`index.ts:452-475`。
- 段名常量对外导出，**专为被遮蔽而共用**：`PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'`。证据：`index.ts:191-200`。
- 遮蔽规则：scoped section 遮蔽同名 global section（同层内重复注册直接抛错）。证据：`index.ts:478-494,637-639`。

### 2.3 preset / 部署级 persona 的遮蔽关系

```ts
// <H>/packages/preset/persona/src/index.ts:30-46,49-54
prefix: string            // 渲染为 deployment:persona-prefix 段
suffix?: string           // 省略或空串 = 把部署后缀遮蔽掉
complete?: boolean        // 让该段成为完整系统提示词，压掉其他所有段
includeRuntimeContext?: boolean  // 默认 true
```

`apply()` 用**同一个段名**在挂载 scope 注册 prefix/suffix，因此 preset 的 persona 覆盖部署级 persona 而不是并列；`complete` 时该段成为唯一提示词。证据：`persona/src/index.ts:62-75`、`<H>/packages/core/system-prompt/src/index.ts:69-75,660-663,688-695`。

优先级（对单个 agent）：**agent scope 的 persona section > 全局 persona section**；两者都按 `order` 排序，同名才是遮蔽关系。

---

## 3. identity / runtime context / tool order 的注册者与可枚举性

| 组成 | 注册者 | 是否可只读枚举（不建会话） |
| --- | --- | --- |
| harness identity 固定串 | `SystemPrompt` 构造函数，串面量写死 | **代码级可枚举**（读源码/常量），运行期需挂载插件；无独立导出常量，仅 `index.ts:456-462` 内联字面量 |
| 部署级 persona（prefix/suffix） | `SystemPrompt` 构造函数读行 config | 原始值可静态读补丁合成结果；默认值需加载 |
| preset persona | `@deepseek-ai/dsh-persona` 在 preset scope | 可：`compositionInventory()` / `pluginInventory` 读声明行，不建 Agent |
| runtime context（cwd 等） | 各插件 `ctx.systemPrompt.context()`：working-directory（required）、sandbox-policy、user-approval、harness-dev-context 等 | **不能**：provider 在 `assemble()` 时按 `context.agent` 求值；无 agent 时 working-directory 返回空串 |
| 工具集（schemas） | `ToolsService` 构造时注册的唯一 provider | **不能**：schema 只在组装时产出 |
| tool order（排序） | 行 config `toolOrder` + `orderTools()` | 原始值可静态读；生效顺序可离线复算，但未知名的校验要组装 |

证据：

- 固定开场白与注册：`<H>/packages/core/system-prompt/src/index.ts:456-462`。
- working-directory context（`required: true`，无 agent 时 `''`）：`<H>/packages/session/working-directory/src/index.ts:90-96`。
- 其余 context 注册点：`<H>/packages/sandbox/sandbox-policy/src/index.ts:175`、`<H>/packages/interaction/user-approval/src/index.ts:190`、`<H>/packages/context/harness-dev-context/src/index.ts:134-155`。
- 工具 provider 与 schemas：`<H>/packages/core/tools/src/index.ts:113-118`；组装时收集并排序：`<H>/packages/core/system-prompt/src/index.ts:641-658,675`；未配置 `toolOrder` 时按名称字典序：`index.ts:233-238`。
- `provider` / `model` 变量由 agent-loop 注册（preset persona 模板里的 `{{model}}` 依赖它）：`<H>/packages/core/agent-loop/src/index.ts:337-338`。
- 无需会话即可读 preset 组合：`<H>/packages/preset/agent-preset-registry/src/index.ts:400-413`（注释明写 “Read plugin rows without creating an Agent”）、`<H>/packages/host/plugin-inventory/src/index.ts:104-120`。

---

## 4. 内置 profile 与默认 preset

- 随发行版的 profile 模板（首次打开时自动初始化）：`acp` / `web` / `headless` / `sdk` / `sdk-minimal`。证据：`<H>/packages/util/official-bundles/src/bundles.ts:9-26`。
- 无模板时的默认 bundle 列表：`DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']`。证据：`bundles.ts:43-44`。
- 安装方拥有的旧元组（加载时被改写回模板）：`INSTALLATION_OWNED_PROFILE_TUPLES`。证据：`bundles.ts:28-34`；改写点 `<H>/packages/boot/app-boot/src/profile.ts:592-606`。
- 已退役 bundle（加载时从列表剔除）：`RETIRED_BUNDLES`。证据：`bundles.ts:36-41`；剔除点 `profile.ts:608-619`。
- Desktop 的 profile 名是 `desktop`（`$DSH_HOME/profiles/desktop`），bundle 列表复用 web 模板。证据：`<H>/apps/desktop/src/paths.ts:19`、`<H>/apps/desktop/src/project-manager.ts:31,75-77`。
- web 默认 preset：`default: standard`。证据：`<H>/packages/bundle/web-app/cordis.patch.yml:586-593`。
- 随发行版交付的 preset 文件按 `dsh.bundle.patch` 顺序应用：`standard` / `ptc` / `minimal` / `cordis`。证据：`<H>/packages/bundle/web-app/package.json:46-56`；每个文件插入一条 `@deepseek-ai/dsh-agent-preset` 行，例如 `<H>/packages/bundle/web-app/presets/standard.patch.yml:1-14`。
- 默认 preset 的解析：`default`（必填）+ `selectedDefault`（volatile），`defaultId = selectedDefault ?? default`。证据：`<H>/packages/preset/agent-preset-registry/src/index.ts:56-59,81-82`。
- headless 组合**不挂** preset registry，因此没有 preset 层。证据：`<H>/packages/bundle/headless/src/index.ts:207-208`（注释：该 bundle 不组合 `dsh-agent-preset-registry`）。

---

## 5. 手改配置文件 vs 宿主实际装配：分叉点

1. **后层覆盖前层，读文件的人容易只读 profile 层**：home 层与 `--patch` 在 profile 层之上；`config-editor` 保存时会重新合成并显式拒绝「被 home 补丁或命令行 overlay 覆盖」的编辑。证据：`<H>/packages/boot/config-editor/src/index.ts:134-140`；覆盖顺序 `<H>/packages/boot/app-boot/src/profile-context.ts:74-85`。
2. **`!!js` 表达式只在加载时求值**：patch 解析把它读成 `{ __jsExpr: string }`（`<H>/packages/boot/app-boot/src/index.ts:266,571-588`），静态 dump/`config-schema` 明确不执行（`<H>/packages/boot/app-boot/src/config-schema/collect.ts:60`），只有装载/挂载决策才给出真值，求值被拒时标 `'conditional'` 而不猜（`<H>/packages/preset/agent-preset-registry/src/composition-inventory.ts:87-110`）。证据：`<H>/apps/cli/src/dump-config.ts:2-6`。
3. **默认值不在文件里**：`includeHarnessIdentity` 等默认值由 schemastery 在插件加载时施加，文件缺键 ≠ 空值。证据：`<H>/packages/core/system-prompt/src/index.ts:437-444`。
4. **preset 作用域遮蔽部署 persona**：只读 `system-prompt` 行 config 会漏掉 preset 的 `deployment:persona-prefix`（同名遮蔽，甚至 `complete` 压掉全部段）。证据：`<H>/packages/preset/persona/src/index.ts:62-75`、`<H>/packages/core/system-prompt/src/index.ts:191-200,660-663`。
5. **profile 清单会被加载过程改写**：`normalizeShippedProfile` / `dropRetiredBundles` 在加载时回写 `package.json`，离线读文件可能读到改写前的列表。证据：`<H>/packages/boot/app-boot/src/profile.ts:592-619,743`。
6. **热重载只读文件、不读内存**：HMR 重合成时重新 `readProfilePatches`，手改文件在下一次重载/重启才生效。证据：`<H>/packages/boot/hmr/src/index.ts:930-942`；重合成入口 `<H>/packages/boot/app-boot/src/index.ts:305-308,382-390`。
7. **本仓自身还有一层**：`agent-atelier-assembly` 行在 agent scope 注册 `atelier:model-sys`（order -500）与同名 persona 行（order 0），会**遮蔽**部署级 persona。证据：`src/assembly/planner.ts:28-32,49-60,92-132`、`src/assembly/sink.ts:117-133`、`cordis.patch.yml:21-23`。

---

## 6. 来源 → 注册点 → 优先级 → 可否只读枚举

优先级从低到高（后者覆盖前者）：

| # | 来源 | 注册点 | 优先级 | 可否只读枚举 |
| --- | --- | --- | --- | --- |
| 1 | bundle 补丁里的 `system-prompt` 行 config（base 给初值，web-app 等覆写） | `<H>/packages/bundle/base/cordis.patch.yml:508-513`、`<H>/packages/bundle/web-app/cordis.patch.yml:17-20` | 最低（按 `dsh.profile.bundles` 顺序，后 bundle 压前 bundle） | 可：读各 bundle 的 `dsh.bundle.patch` + `composeEntries` 复算（`<H>/packages/boot/app-boot/src/profile.ts:747-762`） |
| 2 | profile 自己的 `cordis.patch.yml` | `<H>/packages/boot/app-boot/src/profile.ts:708-711` | 高于所有 bundle 层 | 可：纯文件读 + 合成；`!!js` 不求值 |
| 3 | `$DSH_HOME/cordis.patch.yml`（home 层） | `<H>/apps/cli/src/profile-boot.ts:67-75,215-217` | 高于 profile 层 | 可：同上 |
| 4 | `--patch` 叠加（可重复，argv 顺序） | `<H>/apps/cli/src/profile-boot.ts:234`、`<H>/apps/cli/src/args.ts:170-173` | 高于 home 层 | 可：路径来自 argv，文件可读 |
| 5 | `DSH_TELEMETRY_DISABLED` 派生补丁 | `<H>/packages/boot/app-boot/src/profile-context.ts:39-55,81-84` | 最高（补丁序最后） | 可：环境变量 + 现有行即可判定 |
| 6 | schemastery 默认值 | `<H>/packages/core/system-prompt/src/index.ts:437-444` | 作用于「缺键」，不覆盖显式值 | 否：只在插件加载时施加 |
| 7 | harness identity 固定串 | `<H>/packages/core/system-prompt/src/index.ts:456-462` | 段位 -1000；受第 1–4 层 `includeHarnessIdentity` 开关 | 部分：串是源码字面量，开关要合成补丁 |
| 8 | preset persona（`@deepseek-ai/dsh-persona`） | `<H>/packages/preset/persona/src/index.ts:62-75` | 高于部署级 persona（同段名、agent scope 遮蔽） | 可：`compositionInventory()` / `pluginInventory`（`<H>/packages/preset/agent-preset-registry/src/index.ts:400-413`、`<H>/packages/host/plugin-inventory/src/index.ts:104-120`） |
| 9 | `system-prompt/assemble` waterfall / `complete` 段 | `<H>/packages/core/system-prompt/src/index.ts:684-695` | 最高（运行时） | 否：需要挂载后的注册表与 waterfall |
| 10 | 运行时 context 文本（cwd、沙箱、审批…） | `<H>/packages/session/working-directory/src/index.ts:90-96` 等 | 组装时求值 | 否：provider 依赖 `context.agent` |
| 11 | 工具 schemas 与 `toolOrder` 排序 | `<H>/packages/core/tools/src/index.ts:113-118`、`<H>/packages/core/system-prompt/src/index.ts:233-247,675` | 组装时决定 | 否（工具集）；`toolOrder` 原始值可读、排序可离线复算 |

---

## 7. 未找到

- **未找到**「不挂载宿主、只读文件就能拿到 schemastery 默认值之后的 `system-prompt` 有效 config」的导出函数或命令；`--dump-config` 只给补丁合成后的原始条目（`<H>/apps/cli/src/dump-config.ts:32-42`），`--dump-default-config` 进一步剥掉 profile/home/overlay 层（`<H>/apps/cli/src/args.ts:173`）。
- **未找到** preset 覆写宿主 `system-prompt` **行 config** 的路径；preset 只能通过 `dsh-persona` 的 scoped section 遮蔽（`<H>/packages/preset/agent-preset/src/index.ts:12-29`）。
- **未找到** 一个公开 API 能列出「某 agent 最终生效的 runtime context 段清单」而不做一次组装；`refreshContext` 需要已有 `PromptAssembly`（`<H>/packages/core/system-prompt/src/index.ts:579-609`）。
- **未找到** 非 web 组合的默认 preset 配置：headless 明确不组合 preset registry（`<H>/packages/bundle/headless/src/index.ts:207-208`），仓库内无第二个 `agent-preset-registry` 的 `default:` 声明。
