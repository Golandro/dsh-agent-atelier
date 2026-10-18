# 0003 — Core 按层隔离，跨 bundle 能力经 Cordis 服务组合

包内按六层隔离：`contract`（types only）、`core`（目录 / 编排 / 写面）、`providers`（来源与写入适配器）、`dsh`（宿主 / 浏览器连接器）、`ui-core`（界面核心）、`ui-react`（React 组件库）。依赖单向指向 `contract`；宿主翼与界面翼不共享实现，只共享 `contract`，wire 是它的投影。跨 bundle 的能力一律做成 Cordis 服务：`agentProviders`（provider 注册表）、`agentRegistry` / `aliasRegistry`（已冻结读面）、`agentOrchestrator`（编排）、`agentControl`（写面）；纯算法、sink、UI 内部 module 不 provide。Provider 实例由 provider bundle 通过 `ctx.agentProviders.registerAgentProvider(...)` 注册（镜像原生 `ctx.skills.registerProvider`），core 的 catalogs 只消费注册表，不认识具体 provider 包。使用 Cordis 的 `inject` / `ctx.get` / `ctx.provide` / `ctx.effect` / `ctx.on`；不造自定义插件加载器。`Service` 基类需要运行期 import `@deepseek-ai/cordis`，与 ADR-0001 冲突，暂不用（plain object ＋ `ctx.provide` 同样可被 inject）。物理形态先单包多插件行（子路径导出 ＋ patch 多行），拆包与第三方 provider 由触发条件决定。详见 `docs/core-design.md`。

## Considered Options

- **单体插件、静态装配 provider**（2026-10-18 首版提案）：无法让 provider / control / UI 成为不同 bundle；用户已裁决改为 Cordis 服务组合。
- **每层一个 Cordis 插件 / 服务**：过度；纯算法与 UI 内部没有跨 bundle 消费者，provide 会冻结未验证接口。采用「按 bundle 边界部分服务化」。
- **每个 provider 提供自己的 service key，消费者按配置枚举**：Cordis 服务目录不枚举任意 key，顺序 / 去重 / 生命周期都要自己拼；原生 `skills.registerProvider` 已有注册表先例，直接镜像。
- **自定义 provider 加载器 / 注册中心**：重复 Cordis 的职责；只保留一个 provider 注册表，绑定 / 卸载交给 `ctx.effect`。
- **运行期 import `@deepseek-ai/cordis` 以继承 `Service`**：软链安装下宿主包解析不可靠（ADR-0001），且 `ctx.provide` 已满足 inject；暂不重开边界，列为 Q5。

## Consequences

- 服务 key 与 `apiVersion` 成为跨 bundle 契约；`agentProviders` / `agentOrchestrator` / `agentControl` 已核无 catalogued 占用。plain object 服务不进 `Service.listService`，注册点用 loader entry ＋ 单测证明。
- Provider 有生命周期：注册返回 disposer（插件用 `ctx.effect` 挂载）、`ProviderControl.signal` 卸载时 abort、`invalidate()` 触发 catalog 清缓存；重复 `id` / `source` 直接 throw。
- `core` 完全不碰 `node:fs` / `process.env` / project root；workspace 解析下沉到文件系统 provider，catalog 按 `cwd` 记忆化。
- P1 机械搬移仍要一次性更新约 29 处 `src/...` 锚点、测试 import 与 README 路径陈述，守卫全绿后再落服务行。
- 拆包 / 第三方 provider 前不建空壳；服务契约先放进 `contract`，拆包时 key 与 apiVersion 不变。
