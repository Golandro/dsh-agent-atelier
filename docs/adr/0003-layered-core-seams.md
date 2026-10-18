# 0003 — Core 按层隔离，端口/适配器插件化，不做运行期插件加载

包内按六层隔离：`contract`（types only）、`core`（目录 / 编排 / 写面）、`providers`（来源与写入适配器）、`dsh`（宿主 / 浏览器连接器）、`ui-core`（界面核心）、`ui-react`（React 组件库）。依赖单向指向 `contract`；宿主翼（core ＋ providers）与界面翼（ui-core ＋ ui-react）不共享实现，只共享 `contract`，wire 是它的投影。跨层只准走对方 `index.ts`，由 `scripts/check.mjs` 的 import 矩阵强制执行。插件化的单位是**一个可安装的 Cordis bundle**，不是每一层：运行期 provider 注册只在「第三方 provider 或跨 harness 适配器 ≥ 2」时做；物理拆 workspace 包只在构建 / 复用触发时做。详见 `docs/core-design.md`。本 ADR 只定边界与升级方向，不改 01/02 冻结读面、11 的 6 成员与 12 的 wire 语义。

## Considered Options

- **立即 pnpm workspace 多包**：与 `install_bundle` 装目录的方式冲突（`workspace:*` 在 profile 里不可解析，必须发布或内联），构建复杂度先于收益；推迟到触发条件。
- **每层一个 Cordis 插件 / 服务**：当前只有自家连接器消费，服务契约未经验证就会被冻结；且宿主服务目录读回本身有限制（`docs/agents/harness-facts.md`）。只保留 `agentRegistry` / `aliasRegistry` 两个冻结提供面。
- **只按文件分层、不做端口**：provider 无法替换，宿主 fs 与 Node fs 的差异会继续与领域规则缠在一起，跨 harness / 装配源没有落点；采用端口 ＋ 静态装配作为折中。
- **不做分层、继续平铺**：03/04/07/11/12 会把客户端与服务端逻辑混进同一批文件，原型已经证明界面会重算宿主语义。

## Consequences

- P1 是机械搬移：约 29 处 `src/...` 锚点、测试 import 与 README 路径陈述要一起改；一次性提交、`pnpm check` 全绿，不保留中间态。
- `contract` 必须保持 types only；任何需要环境 API 的代码都不能进来，否则浏览器翼被污染。
- `core/orchestrator` 的公开性待 Q1：默认包内深模块，不 provide；出现第二个消费者再升级为服务。
- `dsh` 是 adapter 层，不追求深度；领域规则留在 `core`，否则连接器会变成不可测的上帝模块。
- 拆包与运行期注册写有触发条件（`docs/core-design.md` §7）；触发前不建空壳、不预埋注册表。
