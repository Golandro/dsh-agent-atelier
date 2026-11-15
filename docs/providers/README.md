# Providers 来源与文件系统适配

状态：**2026-11-15 落定（包抽象 3）**。本页按当前代码写实 `agentProviders` 注册表与文件系统适配器；包抽象 3 不新增 default / writer 运行时插件行。

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

消费者方向：dsh/host 的 `src/dsh/host/core.ts` 构造注册表并 provide；`src/dsh/host/providers.ts` 把四个根加 bundled 根注册进去；catalog 的 agent registry 只消费注入的 `AgentProviders`；测试装配 `test/support/memory.ts`（簇 N 起迁出生产 bundle）用真实注册表与两个文件系统 provider 搭内存适配器，写路径用 `ControlFileSystem` 端口。providers 不反向 import control / resolve / catalog 入口。

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
- 不提供默认 provider 的模型链 / DSH 默认对独立插件行；现有模型链解析归 resolve / control，未来新增运行时行必须另立 ADR。

## 收口边界

- 不新增 default provider 运行时行，也不扩展 `AgentProviders` 形状。未来若确有需要，先以独立 ADR 决定服务 key、apiVersion、注册顺序与行为契约，再改矩阵和安装面。
- 不新增 writer 插件行：Node 写端口继续由 `src/providers/fs/write.ts` 的 `createNodeControlFileSystem` 提供，control 通过端口执行提交算法；这是包归属，不是待决的安装行。
- `src/providers/fs/index.ts` 保持唯一 fs 子入口；新增适配器先改入口与矩阵，禁止从 dsh/host 深路径 import。
- 包抽象 3 不改 `package.json` exports、`cordis.patch.yml` 或任何公共服务 key。
