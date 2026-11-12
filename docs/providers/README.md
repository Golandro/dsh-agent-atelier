# Providers 来源与文件系统适配

状态：**骨架：2026-11-12 建立，包抽象 2/3 收口时写实**。本页写已落地的 `agentProviders` 注册表与文件系统适配器；模型层 / 默认对等 provider 行尚未落地，留 TODO 给包抽象 3。

## 职责

providers 是「来源适配」域，两类职责彼此分离：

1. **成员注册表**：`createAgentProviders()` 返回 `ctx.agentProviders` 的 plain object 实现。它只管成员关系——注册、注销、按 rank 列出、变更通知；不解析 frontmatter、不合并层、不判断 trust。
2. **文件系统适配器**：把 Node 与宿主 `fs` 两种后端包装成 `AgentFileSystem` / `ControlFileSystem` 端口，并按根注册成 `AgentSourceProvider`。根由宿主行解析后传入，provider 自己不 walk 项目根、不读环境变量、不碰 `homedir`。

边界事实：provider 是纯 source adapter——列直接子项、按标准文档读一条；分类、rank / trust 合并、诊断映射都留在 registry。缺路径是 absence（`undefined`），不是错误。

## 公共入口

- `src/providers/index.ts`：只 re-export `createAgentProviders`。跨包只准读这里。
- `src/providers/fs/index.ts`：文件系统适配器窄子入口，导出 `createNodeFileSystem`、`createHostFileSystem`、`isHostFileSystem`、`createFileSystemAgentProvider`（及 `FileSystemAgentProviderOptions` 类型）、`createNodeControlFileSystem`。
- 内部模块不扩大公共面：`src/providers/registry.ts` 是入口实现；`src/providers/fs/source.ts`、`src/providers/fs/node.ts`、`src/providers/fs/host.ts`、`src/providers/fs/absence.ts`、`src/providers/fs/write.ts` 都经 fs 入口暴露所需面。

## 依赖方向

矩阵给 providers 的 entries 是 `src/contract/index.ts` 与 `src/catalog/ports.ts`（窄端口，不需要整个 catalog）；node 为 true，cordis 为 false。本层因此可以 I/O，但不能读 catalog 的发现 / 读器实现，也不能 import 宿主包。

消费者方向：dsh/host 的 `src/dsh/host/core.ts` 构造注册表并 provide；`src/dsh/host/providers.ts` 把四个根加 bundled 根注册进去；catalog 的 agent registry 只消费注入的 `AgentProviders`；control 的 `src/control/memory.ts` 用真实注册表与两个文件系统 provider 搭测试适配器，写路径用 `ControlFileSystem` 端口。providers 不反向 import control / resolve / catalog 入口。

## 关键符号与落点

| 落点 | 关键符号 / 事实 |
| --- | --- |
| `src/providers/registry.ts` | `createAgentProviders`。`apiVersion` 固定为 `SERVICE_API_VERSION`；`registerAgentProvider(create)` 先造 `ProviderControl`（`signal` + `invalidate`），重复 `id` 或重复 agent `source` 时 abort 并 throw；注销时 abort signal、移出列表并通知；`listAgentProviders` 按 rank 升序、并列按注册序；`onChange` 在每次成员或数据变更时触发。 |
| 契约（`src/contract/providers.ts`） | `AGENT_PROVIDERS_SERVICE = 'agentProviders'`、`SERVICE_API_VERSION = 1`；`ProviderLookupOptions.projectRoot` 由 registry 每查询解析一次后传入；`SourceRead` 的 miss 带 `absent` / `not-text` / `unavailable` 三种原因。 |
| `src/providers/fs/source.ts` | `createFileSystemAgentProvider`：选项 `id` / `source` / `rank` / `trust` / `origin` / `resolveRoot` / `selectFileSystem`。列根的直接子项并读一条标准文档，不做过滤、frontmatter 解析或 rank 判断；`selectFileSystem` 在每次 list / read 时取端口，bundled 根固定走 Node。 |
| `src/providers/fs/node.ts`、`src/providers/fs/host.ts` | `createNodeFileSystem` 用 `node:fs/promises`；`createHostFileSystem` 把宿主 `fs` 的 resolve / listDir / stat / readText 映射成端口，并复用 `isHostFileSystem` 做形状探测。 |
| `src/providers/fs/absence.ts` | `absentAs` 把 `ENOENT` / `ENOTDIR` / `EISDIR` / `FS_NOT_FOUND` / `FS_NOT_DIRECTORY` 折成 `undefined`；`dirEntry` / `dirKind` 统一目录项形状。 |
| `src/providers/fs/write.ts` | `createNodeControlFileSystem`：目录内 `.commit-<uuid>` 临时名、`wx` 独占写入、调用方 mode（`0600`）、rename 覆盖目标；read 仍按 absence 语义。 |

## 测试 seam

- `test/providers-registry.test.ts`：注册 / 注销 / 重复 id 与重复 source 拒绝 / rank 排序 / `invalidate` 与 `onChange`。
- `test/source-provider.test.ts`：文件系统 source provider 在真实临时目录与内存端口换装下的一致行为；根缺席返回 `undefined`，缺文档给出 typed miss，意外错误上抛。
- `test/plugin.test.ts`：provider 插件行把四个根与 bundled 根注册进 `agentProviders`，rank 与 bundled 目录固定。
- `test/control-node-write.test.ts`（control 侧）：Node 写端口的 temp / rename / absence 语义，证明提交算法对端口而非后端编程。

## 不做的事

- 不解析 frontmatter、不分类、不合并层、不判 trust：这些是 catalog registry 的职责。
- 不解析项目根、不读环境变量、不碰 `homedir`：根由 dsh/host 行解析后传入。
- 不做 Service 子类、不 import Cordis；`agentProviders` 故意是 plain object（2026-10-18 探针）。
- 不做默认 provider 的模型链 / DSH 默认对逻辑（尚未落地，见待收口）。

## 待收口项

- TODO（包抽象 3）：default provider 行（模型层 + DSH 默认对）还没落地；`src/contract/providers.ts` 明确把 model / default 留在设计文档。落地时先定服务 key、apiVersion 与注册顺序，再改矩阵，不得在 providers 里私自扩 `AgentProviders` 形状。
- TODO（包抽象 3）：writer 行归属未定。目前 Node 写端口由 `createNodeControlFileSystem` 提供、control 直接构造，并无独立插件行；它是否应升为 provider 行、放在本域还是 control，由票面裁决后写实。
- TODO（包抽象 3）：复核 `src/providers/fs/index.ts` 作为唯一 fs 子入口的导出集合；新增适配器先改入口与矩阵，禁止从 dsh/host 深路径 import。
- TODO（docs 收口）：本页状态转「落定」，与包抽象 3 的 docs 全量刷新同批。
