# Catalog：发现与目录读面

状态：**写实**（2026-11-12 按包抽象 1 布局核对）。这一页写给改动 agent 发现、agent 文档读取或 registry.yaml 读取的人：读面的两个服务面在这里，写面与解析后的使用在别处。

本域只有一件职责：**把来源适配器交来的原始条目变成冻结的读模型**。它拥有发现、文档解析、registry 层读取、两层的合并与 roots；它不解析模型链、不组装提示词、不落盘、不碰宿主上下文。

## 公共入口

- `src/catalog/index.ts`：跨域读取的唯一入口，导出两个注册表服务、文档读器、registry 读器、roots 与少量类型。
- `src/catalog/ports.ts`：显式窄子入口，只给文件系统端口类型。providers 与 dsh/client 只需要端口，不需要整个 catalog，所以矩阵为它们开的是这个入口而不是 index。
- 深模块（`src/catalog/lazy-load.ts`、`AgentDocumentError`、`modelGroupOf` 等）不跨域暴露；跨域只用上面两个面。

## 文件与职责

| 文件 | 职责 | 是否跨域可见 |
| --- | --- | --- |
| `src/catalog/discovery.ts` | 按 provider 注册表扫描、分类、rank/trust 合并，提供 `AgentRegistry` 服务面 | 是（index） |
| `src/catalog/registry.ts` | 同步的内存定义容器：`size` / `register` / `list` / `get` | 是（index） |
| `src/catalog/frontmatter.ts` | agent 文档的 fence 切分与最小 YAML 子集读器 | 是（index） |
| `src/catalog/registry-file.ts` | 单层 registry.yaml 的校验读器、`DEFAULT_ALIAS_NAME` | 是（index） |
| `src/catalog/alias-registry.ts` | 两层加载与合并、built-in `dsh-default`、分层投影、纯检查 | 是（index） |
| `src/catalog/roots.ts` | 项目根走查与两个 home 的解析 | 是（index） |
| `src/catalog/ports.ts` | 读 / 写文件系统端口与依赖注入形状 | 是（ports 子入口） |
| `src/catalog/lazy-load.ts` | 两个注册表共享的按项目根懒加载与失效 | 否 |

## 依赖方向

矩阵给 catalog 的允许面是 contract、yaml 和 `node:path` / `node:os`；没有 `node:fs`，没有 Cordis，没有第三方包。文件 I/O 全部经注入的 `AgentFileSystem`，由 provider 或 Node adapter 实现；catalog 直接发出的文件调用只有项目根走查时的 `pathExists` 探测。

消费方向有两级：

- `src/control` 与 `src/dsh/host` 经 `src/catalog/index.ts` 读两个注册表、读器与 roots；control 的 compose / commit 与 registry 编辑复用同一套读器与合并规则，不另写 YAML 实现。
- `src/providers` 与 `src/dsh/client` 的 catalog 读取面被矩阵限定为 `src/catalog/ports.ts`。当前 `src/providers/fs/` 的适配器确实只从 ports 取 `AgentFileSystem` / `ControlFileSystem`；`src/dsh/client/chunk-contracts.ts` 此刻只引用 contract，ports 是它日后需要文件端口时的唯一入口。
- 反向依赖不存在：catalog 不 import resolve、providers、assembly、control、dsh。发现需要的 `AgentProviders` 是**接口注入**，不是 import 实现。

## 关键符号与落点

| 符号 | 落点 | 契约 |
| --- | --- | --- |
| `createAgentRegistryService` | `src/catalog/discovery.ts` | 注册 `agentRegistry` 的读模型：`list` / `get` / `diagnostics` / `invalidate`；首次查询按项目根扫描并记忆 |
| `createAgentRegistry` | `src/catalog/registry.ts` | 同步容器，供内存测试与扫描结果落地；服务面没有 `size` 是刻意的 |
| `parseAgentDocument` | `src/catalog/frontmatter.ts` | 文档文本 → typed frontmatter + body；已知键来自 yaml 字段表，另加 legacy `model` |
| `splitAgentFence` | `src/catalog/frontmatter.ts` | 保留 opening / frontmatterText / closing / body 原始字节，供写面逐字节重组 |
| `readRegistryLayer` | `src/catalog/registry-file.ts` | 单层 registry.yaml → `models` / `aliases`，或整层拒绝与全部失败原因 |
| `DEFAULT_ALIAS_NAME` | `src/catalog/registry-file.ts` | `dsh-default`；在 models / aliases 两张表里都保留，用户声明它是校验错误 |
| `createAliasRegistryService` | `src/catalog/alias-registry.ts` | 注册 `aliasRegistry`：`snapshot` / `layers` / `getAlias` / `getModel` / `diagnostics` / `invalidate` |
| `aliasRegistryLayers` | `src/catalog/alias-registry.ts` | 每项目根的层路径表（workspace 优先、global 其次），写面按 source 找落点 |
| `inspectAliasRegistry` | `src/catalog/alias-registry.ts` | 纯检查：unknown alias / unknown model target / raw escape / fan-in / pool 混合；只产出 finding，不 throw |
| `findProjectRoot` | `src/catalog/roots.ts` | 从 cwd 向上找最近的 `.git`，找不到回退 cwd |
| `resolveDshHome` / `resolveAgentsHome` | `src/catalog/roots.ts` | 显式路径 > 环境变量（`DSH_HOME` / `DSH_AGENTS_HOME`）> 默认 home；支持 `~` |

端口面由 `src/catalog/ports.ts` 定义：`AgentDirEntry`、`AgentFileSystem`、`FileSystemDependencies`（Node 回退、宿主 `fs` 解析器与 warn 汇），以及写面用的 `ControlFileSystem`。端口是**原语**：唯一性、原子性与权限策略由 control 的提交序列拥有，catalog 不替它决定。

## 行为要点

- **缺席是数据**：根不存在、文件缺失、目录不是目录，都以 `undefined` / `false` 表达，不抛错；registry 缺层就是空层。
- **一层全读或全丢**：registry.yaml 的语法错误汇总为 `unparseable-registry`，schema 错误各报一条 `invalid-registry`；坏层不半合并，诊断与层投影一起交给调用方。
- **rank / trust 来自 provider 声明**：按 provider 的 `rank` 升序，第一个认领 agent 名的来源胜出；trusted 根上的硬错误抛 `AgentDocumentError`，非 trusted 的硬错误只是一条诊断，`unexpected-id` / `no-model-order` 是可见的软诊断。
- **合并面即生效面**：两层按层序合并，首次出现的名字胜出，同名最多一条；`layers` 保存被遮蔽的声明只供 UI 展示层间阴影，任何消费方不得自己按层重算。
- **built-in `dsh-default` 是加载期快照**：它跟随宿主提供的默认 provider/model 对；找不到匹配条目时合成一个 `dsh-default` 模型，保证指针永远指向一个 model entry。只有 `invalidate()` 会重读默认对。
- **modelGroup 折叠**：某个 group 任一 entry 声明 `available: false`，合并后的整组读作 false；引擎仍是逐 entry 判断。
- **没有 watcher**：首次查询按项目根记忆，provider 的 register / unregister / invalidate 会清缓存；并发查询共享在途加载，失败的加载不缓存。

## 测试 seam

- `test/registry.test.ts`：同步容器的注册、替换、列表与按名查找。
- `test/discovery.test.ts`：四根扫描、provider rank / trust、诊断分类、项目根走查、懒加载与失效；用真实临时目录与注入端口各测一遍。
- `test/frontmatter.test.ts`：fence 切分、已知键形状、引号 / 注释 / literal block / flow / block 序列、未知键保留、不可表达构造的诊断。
- `test/registry-file.test.ts`：模型与 alias 两张表的 schema、布尔、重复名、未知字段、整层拒绝与失败聚合。
- `test/alias-registry.test.ts`：workspace 覆盖 global、built-in 与合成、分层投影、两个诊断码、findings 的纯判定。
- `test/source-provider.test.ts`：文件系统 provider 对着 `AgentFileSystem` 端口的行为；同一算法能换内存端口测试。

## 不做的事

- **不引 YAML 库**：不 import `js-yaml` / `zod`，不解析整份 YAML；只读 agent 文档与 registry.yaml 需要的最小子集。
- **不直接碰 `node:fs`**：文件访问只经注入端口；providers 拥有 Node / host `fs` 的选择策略。
- **不认识宿主上下文**：不 import Cordis，不读 `ctx`，不注册服务；服务接线在 dsh/host。
- **不做模型链解析或组装**：链解析归 resolve，提示词规划归 assembly，写盘归 control。
- **不写文件**：editor / registry 编辑使用本域读器与 `src/yaml/` 的手术规则，但提交序列与落盘是 control 的职责。
- **不做 watcher / 轮询**：失效只能由 `invalidate()` 或 provider 变更触发，不做文件监听。
- **不判断环境策略**：四个根的路径、home 覆盖与 provider 注册顺序由 dsh/host 组装，catalog 只消费解析好的根。
