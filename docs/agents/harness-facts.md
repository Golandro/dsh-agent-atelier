# Harness 事实（本 profile / 本机）

实施与验收时需要的 harness 事实。**票面里的具体标识先在这里/真机核一遍再用**。

## 路径

- **DSH 源码**（核锚点、读实现）：`~/repo/deepseek-harness`，monorepo 布局 `packages/<分组>/<包名>/src`。可用 `DSH_SOURCE` 覆盖。
- **profile**：`$DSH_HOME/profiles/web`（`DSH_HOME=/home/gg/.dsh`）；装好的 bundle 在 `<profile>/node_modules/<包名>`。
- 本插件装入后是**软链**指向本 workspace ⇒ harness 加载的是 `lib/`：**改完 `src/` 必须 `npm run build`**，没有自动重编译。

## 读回通道（`cordis_inspect_query`，免审批）

Provider（host）：`Service.listService` / `Event.listEvents` / `Config.listConfigs` / `Tool.listTools`。

- 精确按 key 查是廉价路径；**无参 `Service.listService` ≈31.5KB**（会溢出到 `/tmp/dsh-spill-*`），只在需要 key 清单时用。
- **plain-object service 读不到**：目录只收录声明式契约的 service——原生 `webApp` 与本仓 `agentRegistry` 都不在目录里。要证明"注册点是活的"，用 loader entry（见下）＋真机单测，别在目录里找。
- `Config.listConfigs {name}` 返回 entry：`id` 形如 `include:<包名>`，`packageDir` 是解析后的安装位置；**`status: "absent"` = 该 row 未声明 Config**（现网 deck 同样如此），不是"未挂载"。
- 已占用的 service key（新服务勿撞）：`agents`、`agentTeams`、`agentPresets`、`agentDefaultModel`、`agentLoop`、`skills`、`tools`、`commands`、`systemPrompt`、`compaction`、`subagents`、`storage`、`web`、`webServer`、`workspaceFiles`。命名前先 `listService {service: "<key>"}` 确认。
- `dsh --profile web --dump-config` 在本 profile 无有效输出，别用。

## bundle 安装 / 回退（唯一通路）

- 安装：`plugin_manager { action: "install_bundle", target: "<workspace 绝对路径>" }` → 看返回的 `stage` 与 `application`：`applied` = 生效；`restart-required` / `overridden` / `failed` = 未生效。
- 回退：`plugin_manager { action: "remove_bundle", target: "<包名>" }` → profile `package.json` 引用与 loader entry 一起消失；`node_modules/<包名>` 软链可能残留到下次安装（无害）。
- 形态：bundle = `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` 的 `insert: [{ id, name, config }]`；Host 入口 `apply(ctx)` 或 service class（不混用），资源用 `ctx.effect` / `ctx.on` 注册并返回清理。
- 落点在 workspace 内：手写 profile 的 `package.json` / `cordis.patch.yml`，或在 profile 目录跑包管理器，都是禁止操作；profile 的变更只经上面两条 action 产生。
- 安装若报告 `pendingBuilds`：先向用户确认，再把选定的条目传进 `approvedBuilds`。

## 工具链与沙箱

- 沙箱只允许写本 workspace，所以包管理器的 cache/store 必须落在 workspace 内：`.npmrc` 已设 `cache=.npm-cache` 与 `store-dir=.pnpm-store`。
- 测试 = vitest（`npm test`）；类型 = `npm run typecheck`；构建 = `npm run build`（tsc → `lib/`）。
- Node 内置模块（`node:fs/promises`、`node:path`、`node:os`、`node:url`）的类型来自 devDependency `@types/node`（`^24`）；运行时依赖仍必须为空（守卫只管 `dependencies`）。
- **守卫**：`npm run check`（静态卫生 + typecheck + 单测）。本仓无 CI、无远端，守卫挂在 `.githooks/pre-commit` 上，一次性接线：`git config core.hooksPath .githooks`。

## 实施期约定（本仓特化）

- **票面事实先复核**：service key、`path:line`、根数这类断言，动工前在真机核一遍（`cordis_inspect_query` / grep），修正写回票面。`npm run check` 的 anchors 一项会兜住 `path:line` 漂移。
- **委托失败先验场**：子代理失败或中断后，先 `git status` 逐个复核它留下的半成品再继续。真实案例：某次 stub 清单声明了不存在的 `typescript@^6`，照装会炸。
- **deck 闸 defer 兜底**：`deck_*` 全部返回 `{"reason":"gate-defer"}` 时，按 `docs/agents/issue-tracker.md` 的 markdown 约定直接改 `Status:` / `## Comments`，并在 `map.md` 记下待补的 deck 上报。
