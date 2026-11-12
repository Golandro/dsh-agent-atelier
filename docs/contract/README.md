# Contract：跨域冻结契约

状态：**写实**（2026-11-12 按包抽象 1 布局核对）。面向任何要跨能力域编程的人：这一页说明哪些形状是冻结的、谁拥有它们、改动要落在哪里。实现细节不在这里，读对应域的分页。

本域只有一件职责：**承载跨域类型与字面量常量**。没有运行时逻辑、没有解析、没有 I/O、没有宿主类型；它不 import 目录之外的任何模块，只做包内 re-export 与 type-only 引用。因此它是环境中立的，可被浏览器翼安全引用。

## 公共入口

所有跨域读取只准落在 `src/contract/index.ts`。它按四个文件 re-export：

| 文件 | 承载 |
| --- | --- |
| `src/contract/types.ts` | 目录读面、alias / model 注册表、模型链解析与失败台账的 DTO |
| `src/contract/assembly.ts` | 组装规划、注册 sink 的窄切片与 `AgentAssembly` 基础面 |
| `src/contract/providers.ts` | provider 契约、`AgentProviders` 服务面与 `SERVICE_API_VERSION` |
| `src/contract/service-keys.ts` | 四个服务 key 常量 |

`src/index.ts` 也 re-export 这些名字，作为 bundle 兼容安装面的一部分；实现域不得从 `src/index.ts` 反向取形状。

## 服务 key

key 是跨 bundle 的唯一集成面。宿主 patch 与测试都按字面量读取，改名等于破坏安装面：

| 常量 | 字面量 | 定义文件 | 由谁 provide |
| --- | --- | --- | --- |
| `AGENT_REGISTRY_SERVICE` | `agentRegistry` | `src/contract/service-keys.ts` | core 插件行 |
| `ALIAS_REGISTRY_SERVICE` | `aliasRegistry` | `src/contract/service-keys.ts` | core 插件行 |
| `AGENT_CONTROL_SERVICE` | `agentControl` | `src/contract/service-keys.ts` | core 插件行（control 面与读面同一条行挂载） |
| `AGENT_ASSEMBLY_SERVICE` | `agentAssembly` | `src/contract/service-keys.ts` | assembly 行 |
| `AGENT_PROVIDERS_SERVICE` | `agentProviders` | `src/contract/providers.ts` | core 插件行 |
| `SERVICE_API_VERSION` | `1` | `src/contract/providers.ts` | provider 对象与服务对象都带它 |

`agentRegistry` 刻意不叫 `agents`：宿主已用该 key 注册原生 Agent 注册表，bundle 不得遮蔽原生服务。两个读面（`AgentRegistry` / `AliasRegistry`）以**形状本身**为契约，不带 `apiVersion`；当前只有 `agentProviders` 与 provider 对象带 `SERVICE_API_VERSION`，消费方先校验版本，不匹配按能力缺失处理，不猜。

## 关键符号

按符号族看，不按文件猜：

| 符号族 | 落点 | 代表符号 |
| --- | --- | --- |
| 目录读面 | `src/contract/types.ts` | `AgentDefinition`、`AgentRegistry`、`AgentDiagnostic`、`AgentSource`、`AgentLookupOptions` |
| alias / model 读面 | `src/contract/types.ts` | `AliasRegistry`、`AliasRegistrySnapshot`、`ModelDefinition`、`AliasDefinition`、`AliasFinding` |
| 模型链与台账 | `src/contract/types.ts` | `ChainResolutionInput`、`ChainResolutionReport`、`ChainResolution`、`ModelRoute`、`RouteObservation`、`RouteHealth` |
| 组装面 | `src/contract/assembly.ts` | `AssemblyPlan`、`AssemblySection`、`AssemblySession`、`AgentAssembly`、`PromptSection`、`SystemPrompt` |
| provider 面 | `src/contract/providers.ts` | `AgentProviders`、`AgentSourceProvider`、`SourceEntry`、`SourceRead`、`ProviderControl` |

`ChainResolutionContext`、`ChainItemEffort`、`SupportedEfforts` 是解析引擎的**注入上下文**，定义在 `src/resolve/model-chain.ts`，不在 contract；contract 只放跨域传递的输入、结果与报告。`FrontmatterField` 联合定义在 `src/contract/types.ts`，可编辑字段的运行时表在 `src/yaml/frontmatter-fields.ts`。

## 不在本域的形状

跨域边界容易放错的三组 DTO：

- **写面与客户端**：`ControlCore` 在 `src/control/core.ts`，`ControlClient` 在 `src/control/client.ts`，`DocumentEdit` / `RegistryEdit` / `WriteReport` 在 `src/control/types.ts`；它们经 `src/control/index.ts` 导出，由 control 域拥有。
- **文件系统端口**：`AgentFileSystem`、`AgentDirEntry`、`ControlFileSystem`、`FileSystemDependencies` 在 `src/catalog/ports.ts`；这是 catalog 的窄子入口，不是 contract 的形状。
- **服务实现对象**：`AgentProviders` 的实例由 providers 域构造，contract 只冻结接口；provider 行通过 plain object 注入，不需要 Cordis `Service` 目录。

判定规则：形状被**两个以上能力域**共同命名、且属于跨域协议时，才进 contract；某个域的写面、端口或实现细节留在该域入口。不要把 contract 变成「所有类型的垃圾桶」。

## 依赖方向

- contract 可 import：无。包内文件可以 type-only 互相引用，但目录外一律为零。
- 被所有层引用：yaml / catalog / resolve / providers / assembly / control / dsh 的矩阵行都把 `src/contract/index.ts` 列为允许入口；新增层必须同步加这一行。
- 没有运行时 import 意味着没有 `node:*`、没有 `@deepseek-ai/*`、没有 React / DOM；浏览器翼（dsh/client）可以安全引用契约类型。
- 依赖是单向的：实现域依赖 contract，contract 永不反向依赖实现域。反向引用是契约回退，不是方便。

## 测试 seam

- `test/plugin.test.ts`：静态断言五个 key 的字面量与互不相等（`agentRegistry` 不得是原生 `agents`），并钉住 `agentProviders` 的 `apiVersion` 与成员集合、provide / dispose 生命周期。
- `test/host-wiring.test.ts`：用 `AGENT_CONTROL_SERVICE` 注入测试 core 并驱动 wire 路由，证明常量就是宿主的查找 key。
- `test/providers-registry.test.ts`：独立验证 `SERVICE_API_VERSION` 与 `AgentProviders` 的成员面。
- 全仓 import：各域都从 contract 取形状，`pnpm run typecheck` 把任何签名漂移暴露在编译期；矩阵把深路径绕过暴露在静态检查期。

## 不做的事

- **不做运行时校验**：空值、枚举、必填组合由认识自己 schema 的读器 / 编译器负责；contract 只描述已成立的形状。
- **不做 schema 语言**：不引入 zod、JSON Schema 或第二套类型生成。
- **不 import 宿主**：不出现 Cordis、DSH 类型、`node:*`；宿主事实只按结构化切片进入实现域。
- **不重复定义 DTO**：实现域不得为同一协议保留第二份副本；需要扩展时在拥有该语义的域加字段，再决定是否提升为跨域契约。
- **不改名兼容**：服务 key 与既有读面形状冻结；破坏性变更用新 key / 新 ADR，不做静默改名。
- **不承载实现**：没有函数、没有环境读取；字面量常量仅限服务 key 与 apiVersion（数据，不是逻辑）。
