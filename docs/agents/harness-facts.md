# Harness 事实（本 profile / 本机）

实施与验收时需要的 harness 事实。**票面里的具体标识先在这里/真机核一遍再用**。

## 路径

- **DSH 源码**（核锚点、读实现）：`$ProjectRoot/.vendor/deepseek-harness`（真实 checkout，非软链——见「LSP 与 vendor 树」）。可用 `DSH_SOURCE` 覆盖；`scripts/checklist/paths.mjs` 的默认值是 `~/repo/deepseek-harness`。
- **profile**：`$DSH_HOME/profiles/$DSH_PROFILE`（本机 `$DSH_HOME`、`$DSH_PROFILE` 由 DSH 注入）；装好的 bundle 在 `<profile>/node_modules/<包名>`。
- **路径记法**：文档一律写 `$ProjectRoot`（向上最近的 `.git`，找不到回退 cwd）与 `$DSH_HOME/.$ProjectName/`（按项目隔离的 harness 数据目录）。不写绝对路径——它们不可移植，且随本机布局失效。
- 本插件装入后是**软链**指向本 workspace ⇒ harness 加载的是 `lib/`：**改完 `src/` 必须 `pnpm run build`**，没有自动重编译。静态守卫不读 `lib/`，不受此影响。

## 读回通道（`cordis_inspect_query`，免审批）

Provider（host）：`Service.listService` / `Event.listEvents` / `Config.listConfigs` / `Tool.listTools`。

- 精确按 key 查是廉价路径；**无参 `Service.listService` ≈31.5KB**（会溢出到 `/tmp/dsh-spill-*`），只在需要 key 清单时用。
- **plain-object service 读不到，但可被 `inject` 消费**：目录只收录声明式契约的 service——原生 `webApp` 与本仓 `agentRegistry` 都不在目录里；2026-10-18 本仓探针验证 `ctx.provide('x', {…})` 后可被 `inject: ['x']` 的插件取到（仍不进目录）。要证明"注册点是活的"，用 loader entry（见下）＋真机单测，别在目录里找。
- `Config.listConfigs {name}` 返回 entry：`id` 形如 `include:<包名>`，`packageDir` 是解析后的安装位置；**`status: "absent"` = 该 row 未声明 Config**（现网 deck 同样如此），不是"未挂载"。
- 已占用的 service key（新服务勿撞）：`agents`、`agentTeams`、`agentPresets`、`agentDefaultModel`、`agentLoop`、`skills`、`tools`、`commands`、`systemPrompt`、`compaction`、`subagents`、`storage`、`web`、`webServer`、`workspaceFiles`。命名前先 `listService {service: "<key>"}` 确认。
- `dsh --profile web --dump-config` 在本 profile 无有效输出，别用。原因（2026-10-19）：它会先**规范化写入** profile 的 `cordis.yml`，沙箱对 workspace 外写入以 `EROFS: read-only file system` 呈现（不是 EACCES）⇒ 沙箱内必失败；判定挂载状态用 `set_bundle` 的返回 ＋ `Service.listService` 已足够。
- **inspect 工具 `input` 参数缺陷（2026-10-19 会话）**：`cordis_inspect_query` 携带任何 `input`（含 `{}`）一律被拒（`"input" must be an object`），无参调用正常 ⇒ 只能拿无参目录第一页；按 `root` 精查 slot 占用者、按 `name` 过滤 entry 都做不了，改用真机 route / boot 载荷替代验证，等上游修复。
- **`@deepseek-ai/cordis` 运行期**（2026-10-18，Q5=B / ADR-0004）：workspace 的 devDependencies 有它；profile 顶层 `node_modules/@deepseek-ai/` 没有 `cordis`，但本包是软链，Node 按 realpath 解析到 workspace ⇒ 当前安装形态可 import。`Service` 子类探针（`Context` ＋ `Service` ＋ `inject` ＋ `ctx.get`）通过；`ctx.get` 返回服务代理，不要断言对象身份。loader 加载探针（`Service.listService` 可见 / 卸载）归 P2。

## bundle 安装 / 回退（唯一通路）

- 安装：`plugin_manager { action: "install_bundle", target: "<workspace 绝对路径>" }` → 看返回的 `stage` 与 `application`：`applied` = 生效；`restart-required` / `overridden` / `failed` = 未生效。
- 回退：`plugin_manager { action: "remove_bundle", target: "<包名>" }` → profile `package.json` 引用与 loader entry 一起消失；`node_modules/<包名>` 软链可能残留到下次安装（无害）。
- 形态：bundle = `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` 的 `insert: [{ id, name, config }]`；Host 入口 `apply(ctx)` 或 service class（不混用），资源用 `ctx.effect` / `ctx.on` 注册并返回清理。
- 落点在 workspace 内：手写 profile 的 `package.json` / `cordis.patch.yml`，或在 profile 目录跑包管理器，都是禁止操作；profile 的变更只经上面两条 action 产生。
- 安装若报告 `pendingBuilds`：先向用户确认，再把选定的条目传进 `approvedBuilds`。
- **行入口契约（2026-10-19 真机教训）**：loader 以 `apply(ctx, config)` 调用行入口——入口第二参数**永远是行配置**，不得挪作他用（本仓 providers 行曾把配置 `{}` 误当移交实例 → 激活失败 `apiVersion undefined`）。要移交实例就在 all-in-one shell 里显式传参，行入口 `apply(ctx, _config?)` 专用化 ＋ 入口处形状校验双保险；测试要用 `ctx.plugin(row, {})` 补 loader 同形回归（无 config 时 cordis 传 `undefined`，测不出该坑）。
- **enable 诊断直读**：`set_bundle` 返回 `application: "failed"` 时 `error.diagnostic` 直接点名抛错 entry 与错误文本，是最快定位通道；`application: "applied"` ＋ `warnings: []` 即三行（全部 row）真活（HMR 把 bundle 全部 row 当 required，任一 pending 都进 warnings）。

## 工具链与沙箱

- 沙箱只允许写本 workspace，所以包管理器的 cache/store 必须落在 workspace 内：`.npmrc` 已设 `cache=.npm-cache`。**pnpm 陷阱**（2026-10-17 迁移后发现）：pnpm 未使用 `.npmrc` 的相对 `store-dir`（`pnpm store path` 仍指全局 `~/.local/share/pnpm/store/v11`）⇒ **DSH 会话沙箱内跑 `pnpm install` 会 `ERR_SQLITE_ERROR`**（全局 store 在 `~` 下不可写）；改依赖的操作在沙箱外跑，或 `--store-dir "$PWD/.pnpm-store"` 落进 workspace。
- 包管理器 = **pnpm workspace**（2026-10-17 由 npm 迁移：`pnpm-lock.yaml` + `pnpm-workspace.yaml`，check 脚本走 `pnpm run typecheck && pnpm test`）。测试 = vitest（`pnpm test`）；类型 = `pnpm run typecheck`；构建 = `pnpm run build`（tsc → `lib/`）。
- `.vendor/deepseek-harness` **必须是工作区内的真实 checkout**（`git worktree`），不能是软链——软链会让全部 LSP 调用失败。自检：`test -L .vendor/deepseek-harness && echo SYMLINK_BROKEN`。`vitest.config.ts` 已 exclude `.vendor/**`，防误拾上游测试套件。见下节「LSP 与 vendor 树」。
- Node 内置模块（`node:fs/promises`、`node:path`、`node:os`、`node:url`）的类型来自 devDependency `@types/node`（`^24`）。**运行时依赖纪律（2026-10-17 修订，维护者裁决「我们需要这些依赖」）**：第三方库**允许**进 `dependencies`（install_bundle 装入时随 pnpm add 进 profile，bundle entry 自身的 dependencies 进运行时解析——宿主 publish 纪律）；`@deepseek-ai/*` 宿主包仍**禁**（ADR-0001 import 边界；宿主共享实例走 peerDependencies + devDependencies）。守卫 `bundle` 项据此判定（`scripts/check.mjs` 的 `hostRuntimeDeps`）。
- **守卫**：`pnpm run check`（静态卫生 + typecheck + 单测）。`scripts/check.mjs` 只读 `src/` 并用 TypeScript AST 判定 import 矩阵，**不要求 `lib/` 已构建**；`.githooks/pre-commit` 依次跑 `node scripts/check.mjs --hook`、typecheck、单测。本仓无 CI、无远端，守卫挂在 `.githooks/pre-commit` 上，一次性接线：`git config core.hooksPath .githooks`。

## LSP 与 vendor 树（2026-11-14，真机实测）

- **闸门是包含性检查，不是沙箱。** 官方 seam（`lsp/lsp-stdio/src/host.ts:91`）与已装的 `dsh-lsp-actions`（其 `lib/host.js` 第 63 行）都有同一道 `if (!fs.contains(workspace.target, target)) throw`。`fs.contains` 比的是 **realpath**（`fs-local/src/fsio.ts:184`），所以**指向工作区外的软链必然失败**：`source "<path>" resolves outside the workspace`。
- **提权无效。** `fs-sandbox` 的读操作完全透传（`fs-sandbox/src/index.ts:7-8`），`contains` 不看 `sandboxMode`；`danger-full-access` 也不会让软链通过。
- **可执行入口：`node scripts/vendor-worktree.mjs [--dry-run]`**（幂等、探测优先、默认不联网）。源 checkout 留在工作区外共享；脚本在工作区内物化 `git worktree` 并补 `node_modules` 软链。已有 checkout 直接复用，绝不重复克隆。细节见 README「Reading the DSH source」。
- **可用形态：`git worktree` 检出到 `$ProjectRoot/.vendor/<name>/`。** 文件真实位于工作区内 ⇒ realpath 在根下 ⇒ 闸门通过。实测：`lsp_diagnostics` 0 条、`lsp_symbols` 39 符号、hover/definition/references 与原仓库完全一致。
- **必须补 `node_modules` 软链。** worktree 只含受版本控制的文件，不含 `node_modules`；依赖解析会一路找到本仓的 `node_modules`，第三方包（如 `execa`）因此 `TS2307`。补 `ln -s <源仓库>/node_modules .vendor/<name>/node_modules` 后解析正常（`tsc` 通过；依赖解析沿软链生效，不受包含性检查约束）。
- **根的粒度要够。** 语言服务器需要**工程根**（有 `tsconfig` 的那层）才建索引。实测把根设成源仓库的**父目录**（无 tsconfig 的那层）时，`documentSymbol` / `hover` / `references` 全部**静默返回空**（90 秒静置仍为空）——不报错，比报错更危险。本仓文件挂在祖先根下同样归零，是普遍规律。
- **worktree 的代价**：在源仓库 `.git/worktrees/<name>/` 注册（`remove`/`prune` 必须回源仓库执行）；只能 detached HEAD（分支已被主 checkout 占用）；是快照，不自动跟随上游；占约 205 MB。
- **不要把 vendor 源码拷进工作区**：实测得到 6 条假诊断（模块解析全断）。
- **`.vendor/deepseek-harness` 是指针，不是内容。** 索引里是 submodule gitlink（`160000 66491b05e3…`，即 `dsh-v0.2.2-rc.1`），`.gitmodules` 配 `update = none`（`git submodule update --init` 是空操作：不会偷偷克隆 200 MB，也不会在会话运行时改写工作树）＋ `ignore = untracked`（容忍树内 `node_modules` 软链，`git status` 保持干净）。**新克隆拿到的是空目录**，跑 `node scripts/vendor-worktree.mjs` 即按索引里的 pin 检出；pin 比本地 checkout 新时脚本降级到该 checkout 的 `HEAD` 并明确报告。`.gitignore` 用 `.vendor/*` ＋ `!.vendor/deepseek-harness`，所以升 pin 是普通 `git add .vendor/deepseek-harness`，不需要 `-f`。

## Web GUI 认证与真机 HTTP 验证（2026-10-19）

- GUI **全局 401**（连 `/` 都要认证；文案 "dsh web authentication required"）。launch token 由 `dsh web` 启动时打印（startup 日志里没有）；`GET /?token=<launchToken>` 换**持久签名 cookie** 后浏览器靠 cookie 认证。
- cookie 方案（`dsh-client-connection`，2026-10-19 复刻实测修正）：名 = `dsh-auth-<base64url(sha256(authority))>`（authority = 请求 Host 头，本机为 `127.0.0.1:3080`）；值 = `v1.<body>.<base64url(HMAC-SHA256(secret, body))>`，其中 **`body` = base64url(JSON.stringify(payload))，HMAC 的输入是 body 字符串本身，不是 payload 原始字节**（首测签错对象 → 401）；payload = `{version:1, authority, issuedAt, expiresAt}`（紧凑 JSON，键序如列）。校验窗：`issuedAt ≤ now < expiresAt` 且 `expiresAt-issuedAt ≤ maxAgeDays`。签名 secret 持久在凭证库记录 `client-connection/browser-session`（`~/.dsh/.credentials.yaml`，32 字节）⇒ **服务端验证脚本可复刻握手**：从 stdin 喂 `node --input-type=module -`，secret 只进内存、不落盘不回显（做法见 12 票验证轮）。
- **client bundle 投递**：裸包名行进 boot 载荷（index HTML 可 grep；模块条目 JSON 里是未转义的 `&rev=`，script-src 属性里才是 `&amp;`——两种形态都要认）；单文件运行时 URL 形如 `plugins/??<包名>/client.js&rev=<rev>`（`/plugins/` ＋ 查询串，`??` 不是笔误），批量 preload 为逗号并列；服务端投递 = 源文件**裁掉尾随 LF** ＋ 追加 `\n;\n//# sourceMappingURL=…\n`（带语句分隔符 `;`）——与 `lib/client.js` 做字节比对时剥掉整段追加、容忍末尾 LF 再比。
- **变更路由 marker**（本仓 wire，2026-10-19 实测）：仅非 state 请求强制 `x-dsh-agent-atelier: 1`（缺 → 403）与 `content-type: application/json`（缺 → 415）；GET state 免 marker（CSRF 纵深：跨站表单伪造不了自定义头）。服务 key 自占（下游勿复用）：`agentRegistry`、`aliasRegistry`、`agentProviders`、`agentControl`。
- **左侧栏全局面板注册面**（2026-10-19 实测）：`sidebar.panellist`（root 作用域 list，"Global panel icons"；选项 `{id, order?, label?}`，行组件收 `{size, active}`）＋ **同 id 寻址 root 作用域 `main` keyed slot**（"Central panel selected by sidebar entry id"）。现役面板：`plugins`=order 0（插件页）、`schedules`=10；本仓「智能体工坊」= `agent-atelier`/5。先例 = `@deepseek-ai/dsh-client-ui-schedule`（TaskManagerIcon / TaskManagerPage，`ctx.slots.inject('main', …)` 双注册）。活体 slot 拓扑走 client inspect，**provider id 是大写 `Slots`**（小写 `slots` 报 not registered）；无参 `listSubTree` 可用（`input` 参数仍是本会话已知缺陷）。

## 客户端工作区与作用域事实（2026-11-05，已装 0.2.2-rc.1 核对）

- 浏览器侧 `ctx.workspaces`（`@deepseek-ai/dsh-api-workspace-controller/client`，Service key `workspaces`）：`list.getSnapshot()` → `{ items, archivedSessionIds, pinnedSessionIds, state, phase, error }`，行 = `{ workspaceId, path, title, sessionIds, createdAt, updatedAt }`；`create` / `initializeDefault` / `rename` / `delete` / `insertBefore` 与归档、pin 会话同在这一个服务面。
- 会话侧 `ctx.sessions.list.getSnapshot()` → `{ ids, byId, phase, projectionsBySession }`；`byId[id]` 行有 `cwd?`、`updatedAt`、`retainedBy`（`mainView` 等来源计数；来源标签由各 client 包 declaration merge 注册）。
- 「最近活跃工作空间」原生规则：workspace 内 session 最新 `updatedAt`（无 session 用 `createdAt`）最大者（`client/ui-workspace/src/client/navigation.ts` 的 `recentWorkspace`）；「当前会话」判法 = `retainedBy.mainView > 0`（ui-session / ui-workspace 同款）。两者都可结构化照抄；客户端包不能 import（ADR-0001）。
- 宿主侧另有 `ctx.workspaceRegistry`（`@deepseek-ai/dsh-workspace`，`list(): Workspace[]`）与 `ctx.workspaceController`（Remote owner）；面板走浏览器侧服务，不碰宿主侧。

## 实施期约定（本仓特化）

- **票面事实先复核**：service key、`path:line`、根数这类断言，动工前在真机核一遍（`cordis_inspect_query` / grep），修正写回票面。`pnpm run check` 的 anchors 一项会兜住 `path:line` 漂移。
- **委托失败先验场**：子代理失败或中断后，先 `git status` 逐个复核它留下的半成品再继续。真实案例：某次 stub 清单声明了不存在的 `typescript@^6`，照装会炸。
- **deck 闸 defer 兜底**：`deck_*` 全部返回 `{"reason":"gate-defer"}` 时，按 `docs/agents/issue-tracker.md` 的 markdown 约定直接改 `Status:` / `## Comments`，并在 `map.md` 记下待补的 deck 上报。

## 子代理派发与失败诊断

- **错误**：未验证路由就并发派发多个重任务。**正确**：先派一个 PONG 级小任务烟测路由（兼探单槽占用）；**codebuddy ACP 路由并发 = 1**（实测：一次只能执行一个一次性子代理——实现缺陷，第二个并发调用会炸或排队）；该槽被占时，余下子代理按 `AGENTS.local.md` 备选路由（volcengine-plan）并行派发，不必等槽；烟测失败即切备选路由，不重试原路由。
- **错误**：把 dsh-tauri-acp 的 idleTimeout/通道死亡当任务失败并立刻重派。**正确**：该通道约 10 分钟零输出即被 idleTimeout 掐断，但 ACP 服务器侧会继续执行并把产物（提交/研究文档）写进共享工作树；长任务的交付只能按产物验收，服务器侧完成不会再有任何通知，靠定时复核抓取；判死要按任务时长给足观察窗。
- **错误**：派发后占回合继续执行或内联等待结果。**正确**：派发后主代理自觉停止执行（结束回合），收完成通知再继续；后台子代理跨回合存活，结束回合不会杀它们。
- **错误**：把结算通知（"failed/stopped before it finished"）当死因。**正确**：读子会话日志 `~/.dsh/sessions/<cwd-slug>/<childId>/session.v4.jsonl.zstd`，其 `turn/end` 的 `reason` 才是真实错误。
- **错误**：用 `zlib.createZstdDecompress` 解子会话日志。**正确**：日志是多帧 zstd，Node 流式只解第一帧；按 magic `28 B5 2F FD` 扫帧、逐帧 `zstdDecompressSync`（实现照抄 `dsh-session-persistence-jsonl/lib/index.js` 的 `scanZstdFrames`），或装 `zstd` CLI。
- **错误**：并行子代理提交时 `git add -A` / `git add .`。**正确**：只暂存自己的明确路径；他方未提交改动不碰、不回退、不裹挟进提交。
- **错误**：向连对话流都没有的死子代理（`session/new` 即挂或零输出被停）发消息复用会话。**正确**：重派一律用 `subagent()` 重新创建全新会话，死会话只读日志取死因、不续用。
- **错误**：并行会话下用 `GIT_INDEX_FILE` 指向 /tmp 做隔离暂存，再 `git add` 相对路径。**正确**：空索引 + 相对路径会产出「删光全树」的提交；隔离提交用 pathspec：`git commit -m … -- <自己的明确路径>`（绕开索引）；出事立即 `git reset --soft <好提交>`，工作树不受影响。
- **错误**：在 volcengine-plan 上并发多个重子代理当无上限。**正确**：volcengine 有账户级限流（429 AccountRateLimitExceeded），两个并发重任务可致其中途夭折；重任务尽量串行，429 死亡读子会话日志确认后重派。

## 安装包 rc.1 与源码树漂移（2026-11-09，实测）

- **源码树 ≠ 已装版本**：`~/repo/deepseek-harness` 是 `dsh-v0.2.2-rc.1` tag **之后 811 个提交**的 master；票面/事实复核要用安装包，不能用 checkout 的 HEAD。安装包位置：`node_modules/@deepseek-ai/dsh-*`（本仓 devDeps）或 `~/.local/share/pnpm/store/v11/links/@deepseek-ai/<pkg>/0.2.2-rc.1/*/node_modules/@deepseek-ai/<pkg>`。
- **子代理激活形状**：已装 rc.1 `ctx.subagents.startActivation` 收 `{provider, label, childId?, request: {prompt, parent, agentOptions?, maxDepth?, cwd?}, signal, delivery}`；`request` 是嵌套对象，不是 master 的平铺形状。`SubagentActivation` 只有 `childId/messageId?/result/dispose`，没有 `name`；原生 tool 返回 `{kind:'activation', subagentId}`。
- **本地后端判定**：provider 有 `prepareContinuable` 方法才接受保留 `childId`，否则抛 `reserved child ids require a local backend`；外部 provider 不创建本地 Agent，`agent/created` 关联与 persona 挂载只对本地 provider 成立。
- **子代理 header**：`SessionHeader` 的 `origin`/`delegationDepth` 在 header 顶层（`header.origin === 'subagent'`），不在 `header.meta`。
- **本地激活依赖持久化**：`delivery:'parent'` 的本地激活要求 `sessionPersistence`；测试用 `mountAgentLoopTestDependencies(ctx,{workingDirectory:true})` + `@deepseek-ai/dsh-session-persistence-jsonl`（`mkdtemp` 临时 root）。
- **agent/created**：rc.1 payload 是 `{agent, source, signal?}`；本仓宿主镜像只需读 `agent`。

## 进程内宿主验收测试（2026-11-09）

- **依赖形态**：宿主服务与 testkit 以 devDependencies 安装（范围 `^0.2.2-rc.1`，不 pin）；`cordis` 对齐 `^4.1.0`。它们不进 bundle 运行时，符合“宿主共享实例走 peer + dev”的既有纪律。
- **挂载**：`new Context()` → `mountAgentLoopTestDependencies(ctx,{workingDirectory:true})` → `mountAgentLoopTestHarness(ctx)` → 可选 `SubagentRuntime` / `JsonlSessionPersistence({root: mkdtemp})`；用 `ownContext` 统一 `ctx.fiber.dispose()`。
- **tsc 隔离**：`test/host-*.test.ts` 与 `test/support/host.ts` 从 `tsconfig.json` 排除——宿主包会声明合并 Cordis `Events`，与本仓刻意不 import 宿主包的结构镜像冲突；生产代码仍全量 typecheck，宿主测试由 vitest 运行。
- **`pnpm run check` 的沙箱注意**：pnpm 11 的 `verify-deps-before-run` 会先跑 `pnpm install`；沙箱内 store 在 `~` 下不可写（SQLite EROFS）。校验脚本用 `pnpm_config_verify_deps_before_run=false pnpm run check`，或在沙箱外跑原命令。

## 失败台账两条腿（2026-11-09，真机探针）

- **`llm/stream` 不被 scope 滤掉**：`this: LlmRuntime` 只是类型位；Cordis 只在 emitter 带 `Context.filter` 时过滤（`cordis src/events.ts:162-171`），`Service` 级 filter 只比 **`llm` 服务隔离标签**（`cordis src/service.ts:61`），bundle 行与 runtime 同域 ⇒ 收到。若未来某插件 `isolate('llm')` 另供 runtime，行监听者收不到那份实例的事件。
- **`agent/request-error` 的 scope filter 放行未打标签的 ctx**：carrier 由 `dsh-scope` 的 `scopeTarget` 构造（`dsh-agent lib/types/dispatch.js:19-42`），规则为「未打标签 ⇒ 全局；打标签 ⇒ 同键或祖先键」（`dsh-scope lib/types/index.js:327-335`）。bundle 行 ctx 无标签 ⇒ 收所有 Agent 的失败；挂在 Agent scope 里则只收该 Agent 及其子。
- **失败请求的 model**：`session.requestContext()`（最近一条 `request/context` 折叠，在 stream 之前追加，`dsh-agent-loop lib/index.js:1075`）；`agent.model.current()` 是「下一步」选择（`pending ?? lastUsed`），不能当失败路由；`turn/end.reason.error` 只有 `LlmFailure`、无 route。
- **腿 B 的 route 最权威**：`llm/stream` 的 `GenerateOptions` 自带本次尝试 `provider/model`，且 waterfall 同样包住 `preparedCall.stream` 路径；但终局判定（是否会重试）只能由腿 A 的 `next()` 返回值给出。
- **证据与复现**：`test/host-llm-events.test.ts`（真实 LlmRuntime/AgentLoop/Session + 假 adapter，2 例）；完整结论见 `docs/research/2026-11-09-07a-llm-stream-scope.md`。

## 失败台账记录器 07b（2026-11-09，已落地）

- **口径**：`failures` 只计「请求终局」的 transient 类（server/timeout/transport/empty-response），按 `(sessionId, turn, step)` 去重，一个请求记 1 次；`RATE_LIMIT` 不进 `failures`（否则两次限流就绕过 `rateLimitStreak ≥ 3` 的门槛），只喂请求级、窗口内的 streak。
- **不入账**：`UNKNOWN`、未知码（`transient-unknown`）、`INVALID_REQUEST`、`CONTEXT_WINDOW_EXCEEDED`。`AUTH`/`QUOTA` 只写展示字段，不写计数器（v1 投影没有 provider 级计数）。
- **腿 A 顺序**：`await next()` 原样返回后再记录；`terminal = action === undefined`；route 取 `session.requestContext()`，取不到就不记（不 fallback 到 `agent.model.current()`）。
- **腿 B 只记尝试**：`finish{reason:{kind:'error'}}` 记 `terminal:false`，只更新展示字段；非 Agent 调用（compaction/title）没有 request 身份，不伪造归属。记录异常吞进 warn，绝不打断被观察的流。
- **接线**：summon 行内 `ctx.effect(() => mountFailureLedger(ctx, recorder, { now: clock }))`；`composeSession` 新增可选 `observations`/`now`，空 ledger 不传（保持无台账时的报告形状）。
- **证据**：`test/failures.test.ts`（16 例）、`test/failures-wiring.test.ts`（8 例）、`test/control-failures.test.ts`（3 例，阈值+窗口）、`test/host-failures.test.ts`（2 例真机：两条腿合流后一个请求只记一次）。
- **工作树副本**：vitest 会把 `.agents/`、`.dsh/`、`.trae/` 下的 worktree 测试当成本包套件收集（重复且易因内部构建状态失败）；`vitest.config.ts` 需显式排除。

