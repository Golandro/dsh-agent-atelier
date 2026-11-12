# 0008 — 领域包布局：src/ 按能力域拆包，跨包只走公共入口

状态：**2026-11-12 落定**（地图 #21 / 票 #71 包抽象 1；维护者同日裁定「清理期间按领域拆 `src/` 子包，`docs/` 以能力域为二级目录同步维护」）。本 ADR 是后续 client 翼、control/assembly/providers 收口切片的裁决依据。

`src/` 的层名不再按技术分层表达（`core` / `control` / `providers` 这类名字只说明「在流水线的哪一段」），改按**能力域**拆包。每个包一个职责、一个公共入口（`index.ts`，或显式列出的窄子入口），跨包只准落在入口上；包内部可以深引用。依赖方向由 `scripts/checklist/matrix.mjs` 的 AST 矩阵强制执行，矩阵与 self-test 是唯一执行面。

## 目标布局

| 包 | 职责 | 公共入口 | 可 import | 文档 |
| --- | --- | --- | --- | --- |
| contract | 跨包的数据形状、服务 key、DTO；types and 字面量常量 only | `src/contract/index.ts` | 无（运行时 import 禁止） | `docs/contract/` |
| yaml | 原始 YAML 的行级手术：行工具、scalar 规则、frontmatter 字段表 | `src/yaml/index.ts` | contract | `docs/yaml/` |
| catalog | 发现、frontmatter / registry.yaml 读器、alias registry、roots、文件系统端口 | `src/catalog/index.ts`；端口窄子入口 `src/catalog/ports.ts` | contract、yaml、`node:path`、`node:os` | `docs/catalog/` |
| resolve | 纯算法：模型链解析、失败台账投影 | `src/resolve/index.ts` | contract | `docs/resolve/` |
| control | 写作核心：compose / plan / commit / frontmatter 与 registry 编辑 / session / chain 查询 | `src/control/index.ts`；子入口 `src/control/client-errors.ts`、`src/control/http-client.ts` | contract、yaml、catalog、resolve、providers | `docs/control/` |
| assembly | 装配规划与目录注入渲染（当前目录 `src/agent-assembly/`，目标名 assembly） | `src/agent-assembly/index.ts` | contract | `docs/assembly/` |
| providers | `agentProviders` 注册表 + 文件系统 provider | `src/providers/index.ts`；`src/providers/fs/index.ts` | contract、catalog 的 ports 子入口、`node:*` | `docs/providers/` |
| client | 浏览器界面翼：ui-core / ui-react / features / chunks | 目标 src/client/index.ts（迁移中；当前仍在 dsh/client） | contract、control 的公共入口 | `docs/client/` |
| dsh | DSH 连接器：宿主插件行、wire、slots、chunk-loader | `src/dsh/host/index.ts`；浏览器侧入口 `src/dsh/client/index.ts` | 宿主翼可读各领域包；界面侧只读 contract、catalog/ports、control 入口 | `docs/dsh/` |

禁止 `utils/`、`shared/`、`common/` 垃圾抽屉：共享代码必须属于某个领域包（例如原始 YAML 规则归 yaml，文件系统端口归 catalog）；「不知道放哪」意味着包边界还没想清楚，不是新建抽屉的理由。

## 本票已落地（包抽象 1）

- 旧 src/core/catalog/* → src/catalog/*，旧 src/core/resolve/* → src/resolve/*；新增两个 `index.ts` 公共入口。
- 旧 src/core/ports.ts → `src/catalog/ports.ts`，保留为窄子入口：providers 与 dsh/client 只需要端口类型，不需要整个 catalog。
- 旧 src/core/providers-registry.ts → `src/providers/registry.ts`，`createAgentProviders` 经新入口 `src/providers/index.ts` 暴露。
- 旧 src/core/ 目录删除（core/index.ts 不再存在）；消费者按符号归属分流到 catalog 或 resolve，没有兼容转发层。
- 矩阵删除 `core` 层、新增 `catalog` / `resolve` 层；self-test 补一条「resolve 走 catalog 深路径」越界断言。
- 行为保持：公共符号名与签名不变（`src/index.ts` 导出名集合不变）；测试 635 / 43 文件与迁移前一致；`package.json` exports 与 `cordis.patch.yml` 行语义未动。

## 后续切片

- **包抽象 2（client 翼）**：`src/dsh/client` 的泛 UI 移入 client 包（ui-core / ui-react / features），三个根 chunk 目录（client-editor / client-list / client-registry）收进 client 包；`dsh/client` 只留 slots / chunk-loader / 宿主服务读取。与簇 G / Q 的先后关系写在新票。
- **包抽象 3（control / assembly / providers 收口 + docs 全量刷新）**：`src/agent-assembly/` 更名 assembly（若矩阵与导出面允许），providers 的 default / writer 行归位，全部骨架文档写实。与簇 M+N+P 的先后关系写在新票。

## client 与 dsh 的耦合线

dsh 不再承载泛客户端 UI。client 翼需要 DSH 结构时，只经 `src/dsh/client/` 暴露的 slots / chunk-loader / 宿主服务读取面接触宿主；宿主翼（`src/dsh/host/`）是唯一可运行期 import `@deepseek-ai/cordis` 的包。两翼之间不共享实现，只共享 contract 的 DTO（wire 是它的投影）。这条线是包抽象 2 的验收口径。

## Considered Options

- **保留 `core` + 子目录（只搬目录不改矩阵）**：依赖方向仍然糊在同一个层里，providers 仍可从 core 任意深路径取类型；否决——矩阵无法表达「catalog 与 resolve 互不依赖」。
- **按技术分层拆（读 / 写 / 适配 / UI）**：与领域职责交叉（frontmatter 读器与编辑器必须共享 yaml 规则），拆完还是要跨层走入口；否决。
- **一次搬完 client 翼与 control/providers 收口**：单票过大，且与仍在进行的簇 G/Q、M+N+P 测试改造冲突；否决——按当前落地顺序拆成 1/2/3 三片。
- **按打包产物拆（chunk 目录独立成包）**：chunk 是构建产物布局，不是领域；否决——chunk 源码归 client 包，构建根保持现状直到包抽象 2。

## Consequences

- 包名即文档目录名：`docs/README.md` 是能力域索引，`docs/<capability>/README.md` 是二级目录；移动代码时同步重指文档锚点（anchors 守卫扫描 `.scratch` / `docs` / README 的 `path:line` 与裸 `src/...` 令牌，不得靠放宽扫描过关）。
- 新包边界需要新入口时，先改矩阵与 self-test，再写代码；深路径绕过矩阵视为契约回退。
- `src/index.ts` 仍是兼容入口，`package.json` exports 子路径本票不动；改变导出面要独立 ADR 与人工确认。
- 未来若 DSH 连接器与 client 翼进一步解耦，ADR-0001 的结构化读取原则不变：宿主服务只按形状读取，不 vendor DSH 源码。
