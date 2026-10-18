# 0004 — 运行期使用 `@deepseek-ai/cordis` 的 `Service` 基类

Q5=B（2026-10-18）：允许运行期 `import '@deepseek-ai/cordis'`——**仅此一个宿主包**，以 `peerDependencies` ＋ `devDependencies` 声明，禁止进 `dependencies`。用途限于 `dsh/host` 的服务定义：`extends Service`、`static Config`（需要时）、服务目录可见性；`core` / `providers` / `contract` / `ui-*` 仍不得 import 任何 `@deepseek-ai/*`，core 只返回纯行为对象，由 `dsh/host` 包装成 Service。理由：Q1/Q2 要求跨 bundle 能力服务化；plain object 虽可被 `ctx.provide` / `inject` 消费，但不进 `Service.listService`，也没有 Config schema 与属性注入的声明式契约。ADR-0001 的边界由此收窄为「**除 `@deepseek-ai/cordis` 外的宿主包仍不可运行期 import**」；agent 发现仍结构照抄，不 import `@deepseek-ai/dsh-skill*`。

## 风险与门

- 本仓是**软链安装**：profile 顶层 `node_modules/@deepseek-ai/` 下没有 `cordis`；当前靠 Node 对 realpath 的解析走到 workspace 的 devDependency。若改为打包 / 拷贝安装，peer 解析可能失败。
- P2 的第一道门是 **loader 安装探针**：加载后 `Service.listService` 能看到服务、`inject` 属性访问正常、卸载后服务消失。失败则回退 plain object ＋ `ctx.provide`（已探针验证可 inject）并回报，不静默降级。

## Considered Options

- **plain object ＋ `ctx.provide`**（原推荐）：可 inject，但服务目录不可见、无 Config schema；Q5=B 否决。
- **所有 `@deepseek-ai/*` 都可运行期 import**：软链 / 打包安装不可靠，且把领域绑死到宿主实现；否决。
- **只允许 `cordis`（选定）**：满足 `Service` 基类与声明式契约；peer ＋ dev；core 仍纯。

## Consequences

- `scripts/check.mjs`：`hostRuntimeDeps` 仍禁 `dependencies` 里的 `@deepseek-ai/*`；import 矩阵允许 `@deepseek-ai/cordis` **且仅**在 `dsh/host` 运行期出现，其余层连 type-only 都只允许 `cordis` 类型（当前不需要）。
- `package.json` 增 `peerDependencies`（P2）；`@deepseek-ai/cordis` 已在 devDependencies，沙箱内不需要安装新包；peer 字段是清单元数据变更，仍由维护者在沙箱外确认。
- `ctx.get` 返回服务代理，不能断言对象身份；测试断言行为（`hello()` 等）。
- 安装形态变化（打包 / 非软链 / SEA）必须重跑探针；回退路径保留 plain object。
