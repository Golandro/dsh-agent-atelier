# 能力域索引

状态：**2026-11-12 落定**（包抽象 1；裁决见 [ADR-0008](adr/0008-domain-package-layout.md)）。本页是 `docs/` 的二级目录：一个能力域一行，指向该域的 README。分页负责职责、入口、依赖方向、符号与测试 seam；索引不复制分页结论。

## 能力域

| 能力域 | 状态 | 公共入口 | 一句职责 | 文档 |
| --- | --- | --- | --- | --- |
| contract | 写实 | `src/contract/index.ts` | 跨域冻结的 DTO 与服务 key；零外部 import、环境中立 | [contract/README.md](contract/README.md) |
| yaml | 写实 | `src/yaml/index.ts` | 在原始文本上做行级 YAML 手术，保留无法识别的字节 | [yaml/README.md](yaml/README.md) |
| catalog | 写实 | `src/catalog/index.ts`；窄子入口 `src/catalog/ports.ts` | 发现、agent 文档与 registry.yaml 读器、两个注册表、roots、文件系统端口 | [catalog/README.md](catalog/README.md) |
| resolve | 写实 | `src/resolve/index.ts` | 模型链解析与失败台账投影，纯函数、数据进数据出 | [resolve/README.md](resolve/README.md) |
| control | 骨架 | `src/control/index.ts` | 写面与编排：compose / plan / commit / registry 编辑 / session / summon / failures | [control/README.md](control/README.md) |
| assembly | 骨架 | `src/agent-assembly/index.ts` | 五通道组装规划、兼容 sink、目录投影与摘要 | [assembly/README.md](assembly/README.md) |
| providers | 骨架 | `src/providers/index.ts`；fs 子入口 `src/providers/fs/index.ts` | `agentProviders` 成员注册表与文件系统来源适配器 | [providers/README.md](providers/README.md) |
| client | 骨架 | `src/dsh/client/index.ts` | 浏览器面板壳、页面状态机与 chunk 契约（目标 client 包迁移中） | [client/README.md](client/README.md) |
| dsh | 骨架 | `src/dsh/host/index.ts`；浏览器侧 `src/dsh/client/index.ts` | DSH 连接器：宿主插件行、Cordis 服务、wire、slots、chunk-loader | [dsh/README.md](dsh/README.md) |

## 按任务找入口

| 你要改什么 | 先读哪个分页 | 常见落点 |
| --- | --- | --- |
| 加一个可编辑 frontmatter 字段 | yaml → catalog → control | 字段表在 yaml；读器投影在 catalog；编译器与 wire 在 control / dsh |
| 改模型链的尝试顺序、可用性或降级 | resolve | catalog 提供快照与台账数据；control 只做会话接线 |
| 加一个来源（新 provider） | providers → catalog | provider 实现接口；catalog 消费注册表并决定 rank / trust |
| 改 HTTP route 或编辑器写回 | control → dsh | control 的编辑算法；dsh 的 wire / 路由与错误映射 |
| 改侧栏面板或页面交互 | client → dsh | client 的页面与 chunk 契约；dsh 的 slots / chunk-loader |
| 加跨域 DTO 或服务 key | contract | 只加在 `src/contract/index.ts` 的 re-export 面上，不放实现 |
| 改组装行、通道或目录摘要 | assembly | 规划器与 sink 在 `src/agent-assembly/index.ts` 后面 |

## 状态怎么读

- **写实**：本页按当前代码逐符号核对；路径、关键符号、测试 seam 可以当事实读，改动前先看分页。
- **骨架**：可执行骨架——职责、公共入口、依赖方向已落，关键符号与测试 seam 留到该域收口时刷新。ADR-0008 把 control / assembly / providers 的文档写实列进包抽象 3，client 翼列进包抽象 2；dsh 跨两者。
- 状态描述的是**文档成熟度，不是代码完成度**：五个骨架域的代码都已在运行，只是分页还没按符号逐条核对。
- 能力域目录名跟着包名走；`src/agent-assembly/` 的文档目录叫 `docs/assembly/`，因为目标包名是 assembly。

## 依赖方向

- `contract` 是零外部 import 的叶子；所有域只经 `src/contract/index.ts` 读它。
- `yaml` 只读 contract；`catalog` 读 contract 与 yaml，外加 `node:path` / `node:os`；`resolve` 只读 contract。
- `control` 读 contract、yaml、catalog、resolve、providers；`assembly` 只读 contract。
- `providers` 读 contract 与 catalog 的 ports 子入口；`dsh/host` 是连接器，读各域公共入口；`dsh/client` 只读 contract、catalog 的 ports 子入口与 control 入口。
- 跨域只准落在对方声明的公共入口或显式子入口；层内可以深引用。唯一执行面是 `scripts/checklist/matrix.mjs` 的 AST 矩阵。

## 不是能力域的目录

| 目录 | 放什么 | 为什么不在上表 |
| --- | --- | --- |
| `docs/adr/` | 裁决记录：结构、路径身份、文本手术、双模、作用域、领域包布局 | 一个裁决可以横跨多个能力域，不归属单一域 |
| `docs/agents/` | 协作规则：issue tracker、triage labels、domain 文档约定、宿主事实 | 是人与 agent 的工作约定，不是产品能力 |
| `docs/reference/` | 参考设计：core 设计、agent-assembly 过渡索引 | 设计快照，符号真相仍在代码与能力域分页 |
| `docs/research/` | 带日期的研究记录（R1 / R2 / 07a 等） | 历史证据与推导，不是规范 |

能力域目录之下只放该域的 README；跨域裁决、协作规则、参考设计与研究记录都不塞进能力域目录。

## 维护约定

1. 新增能力域：先在 `src/` 下建 `<domain>/index.ts` 公共入口、矩阵层行与 self-test，再在本页加一行、建分页。
2. 子入口是显式窄面，不叫 index 的深路径不算入口。当前允许的典型子入口：`src/catalog/ports.ts`、`src/providers/fs/index.ts`、`src/control/client-errors.ts`、`src/control/http-client.ts`、`src/dsh/client/chunk-contracts.ts`。
3. 文档里反引号包裹的 `src/...` 令牌会被 anchors 守卫逐条检查，只写已存在的路径；不写 `path:line` 锚点（行号会漂）；不存在的未来路径不要放进反引号。
4. 移动代码时同步改入口、矩阵、测试 import 与本页链接，不要靠放宽扫描过关。
5. 禁止 `utils/`、`shared/`、`common/` 垃圾抽屉；共享代码必须归某个能力域。

## 文档目录骨架

- `docs/<capability>/README.md` 是二级目录的标准形状：状态行、职责、公共入口、依赖方向、关键符号与落点、测试 seam、不做的事。
- 索引页只回答「去哪一页」；分页回答「这个域的边界在哪、符号叫什么、由谁测」。
- 交叉引用用相对链接，不复制签名；签名真相在 `src/` 的源文件。
- 写实页以当前代码为准；骨架页保留明确待补的段落，不假装已经核对。

## 变更记录

- 2026-11-12：按 ADR-0008 建能力域二级目录；contract / yaml / catalog / resolve 写实，其余五页留可执行骨架，待包抽象 2 / 3 刷新。

## 本页不做的事

- 不复制各域的内部模块清单、符号签名与测试用例；细节读分页。
- 不把 ADR、协作规则、参考设计或研究记录当能力域；它们不设索引行。
- 不把目标布局当现实现状：client 的目标目录仍在迁移，路径以当前 `src/dsh/client/` 为准。
- 不维护 `package.json` 的 exports、`cordis.patch.yml` 的行语义；那是 ADR 与安装面的事。
- 不替能力域决定内部结构；分页没写清的边界回到该域的收口票。
