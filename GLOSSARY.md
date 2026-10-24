# Agent Atelier

DSH 插件 Agent Atelier（npm 包 `dsh-agent-atelier`）的领域词汇：一个面向用户的「Agent（专家）」层——agent 文档定义人设与模型选用，与模型别名层正交。术语随 grilling 裁决落地。

## Language

### 发现与身份

**Agent**:
一个可召唤的专家：人设、模型选用顺序、工具与预置技能需求，由一份 agent 文档完整定义。
_Avoid_: persona（指文档正文）、subagent / teammate（运行时形态，不是定义）

**Agent 文档**:
定义一个 Agent 的 markdown 文件：frontmatter 元数据 + 正文（persona）。

**Agent 目录（agent-name）**:
发现根下的 `<agent-name>/` 目录，一个目录一个 Agent。目录名是 Agent 的寻址键与跨层去重键；显示名缺省回退为目录名。`default` 为保留字。
_Avoid_: id（frontmatter 的 id 字段已废弃，身份来自路径）

**发现根**:
agent 目录所在的一层配置目录，分项目级与用户级；同名 Agent 项目级胜。
_Avoid_: 根目录（泛指）

**Rank**:
发现根的优先级数，低者胜，是跨根同名 Agent 的决胜规则。

**Source**:
Agent 来自哪个发现根（根标签：项目级 / 用户级 / 随包）。
_Avoid_: origin

**Origin**:
Agent 的出身：`built-in`（随包分发）或 `user`（用户或工作区）。
_Avoid_: source

**Agent 注册表**:
可发现 Agent 集合与其诊断的唯一查询面；解析、目录注入、UI 都从这里读。

**Provider（来源提供者）**:
一个定义来源的适配器（`ctx.agentProviders` 的成员）：只列原始条目、读原文，不做分类、frontmatter 解析、rank/trust 合并——那些全在 Agent 注册表。文件系统 Provider 是随包默认实现（4 个发现根 + bundled）；第三方来源经同一契约接入。
_Avoid_: 连接器（宿主副作用面叫 sink）、LLM provider（那只是模型字符串）

**ProviderId**:
条目与诊断上标注「来自哪个 Provider」的字段；跨来源同名时的归因依据，注册表只用 Provider 给的路径、不自行猜。

### 诊断与预置

**诊断**:
发现 / 解析期的非致命问题：跳过该文件并记录，不阻断启动，由 UI 呈现。被跳过的 Agent 不可见即不可用。
_Avoid_: 错误（硬错误另有所指，如链耗尽）

**预置技能**:
Agent 声明的技能名列表，召唤时预先带上，省去技能发现与加载的对话轮次；按名引用原生 skills 注册表，存在性只警告不保证。
_Avoid_: includes（旧字段名；旧义「相对路径引用 markdown 资源」已废弃）

**默认 Agent**:
内置的回退 Agent（agent-name `default`）：无人设、模型走 dsh-default 别名；召唤它等价于原生子代理调用，是替换机制的兼容桥。因其承担回退路径，`default` 是保留字。

### 模型与别名

**模型条目（model entry）**:
`registry.yaml` 的 `models:` 下一条真实模型：provider/model 对，加上 per-model 系统提示词与 `available` 开关。调优层（人设补充、可用性）挂在这里，不挂别名。
_Avoid_: 模型别名（那是别名，不是条目）

**别名（alias）**:
`registry.yaml` 的 `aliases:` 下一条**纯指针**，指向一个模型条目名；agent 的 `modelOrder` 按别名点名。别名自身不带 provider/model/提示词——v1 为单目标数组，池化（多目标）是 R1/R2 的落点。
_Avoid_: 模型（别名不是模型，是意图名）

**别名注册表（alias registry）**:
别名与模型条目合并后的唯一查询面（`ctx.aliasRegistry`），与 Agent 注册表正交：Agent 注册表管「谁在」，别名注册表管「用哪个模型」。解析引擎、目录注入与 UI 都从这里读。

**层（layer）**:
`registry.yaml` 的一个来源文件：工作区层（`<project>/.dsh/agents/registry.yaml`）压过全局层（`$DSH_HOME/agents/registry.yaml`），同名条目工作区胜。一层读坏即整层弃用并记诊断，绝不半合并。

**发现（finding）**:
跨层校验产出的数据（错误级或提示级）：悬空别名、模型目标不存在、raw `model:` 逃逸口、多对一。与诊断同为「不阻断」信号，但发现面向「可修」，由 UI 呈现。
_Avoid_: 错误（硬错误另有所指，如链耗尽）

**Dsh-default**:
指向 DSH 子代理默认模型对的内置别名（别名注册表范围）：装载时快照读取，`invalidate()` 是唯一刷新点；匹配不到已声明条目时合成隐式条目，保持「别名 = 纯指针」不变式。该名在 `models:` 与 `aliases:` 两处都是保留字。

### 组合与写面

**组合文档（ComposedAgentDocument）**:
控制核心 `compose` 的输出：一份 Agent 文档的域视图——身份字段 ＋ `frontmatterText`/`bodyText` 原始字节 ＋ 块序列 ＋ framing ＋ `baseText`。域形状，无编辑器字符偏移；写回以 `baseText` 为底，commit 靠它拒绝覆盖外部改动。
_Avoid_: 编辑器视图模型（偏移/折叠状态归 UI 层）、AgentDefinition（冻结读面的扁平形状，其 body 已 trim，不携带原始字节）

**块（Block）**:
组合文档里一段连续原文（`id` / `kind` / `file` / `text`）。v1 只有两种：`frontmatter` 与 `prose`（Q1 裁决：单文件 body，无切片）；`id` 是稳定派生键，行号与数组下标不是身份。
_Avoid_: 切片 / section（v1 不存在，归 14 票再议）

**写入计划（WritePlan）**:
`plan(doc, edits)` 的纯函数输出：逐文件 `{ file, content, blockIds, baseText }` ＋ 数据化拒绝（rejection，带 `editIndex`，永不 throw）。`commit` 逐条目原子落盘（temp ＋ rename、`0600`）、写后重读验证、覆盖冲突拒绝；所有失败都是 `WriteReport` 里的行，不是异常。
_Avoid_: 伪造行数 / 占位文件名（原型的 bug 面，禁止回归）

### 组装与通道

**组合会话（ComposedAgentSession）**:
控制核心 `composeSession` 的输出：一次会话启动的答案（route / reasoningEffort / persona / toolFilter / flavor）＋链解析报告＋选中的模型条目（其 per-model 系统提示词是组装的数据源）。组装规划的唯一输入面。
_Avoid_: 解析结果（泛指；正式名是它携带的链解析报告）

**节（Section）**:
组装结果里的一个具名内容单元：名字、放置次序（order）、文本、变维度标注（variesWith）各一。系统侧的节进 system 消息。
_Avoid_: 段（spec 旧词）、切片（另义，归 14 票再议）

**通道（Channel）**:
节的放置路由，五类：① system 节、② digest 门控 user 消息、③ pre-step、④ tools 字段、⑤ 首消息。通道选择即缓存策略：②内容变化才断、③⑤天然尾巴。
_Avoid_: 消息（通道含字段级路由，不都是消息）

**变维度（variesWith）**:
节依赖的变化来源，四个可变维度：`model` / `agent` / `registry` / `tools`。频率不一：切 Agent 高频（召唤即切）、切模型罕见（回退才发生）。
_Avoid_: 通道（通道是放置路由，不是变化来源）、顺序豁免（cacheIsolated 是 lint 豁免，不是变维度）

**缓存断点（Cache Breakpoint）**:
某变维度的断点 = 节序中第一个依赖该维度的节；该维度一变，前缀缓存自此处断开。纯建议性推演：Provider 层缓存不受本插件控制。
_Avoid_: 断点（泛指程序断点）

**组装规划（Assembly Plan）**:
组装规划器的输出：按推荐缓存分层排序的五通道节列表（含通道锚点）＋ 每变维度缓存断点 ＋ 顺序 lint。派生值、零落盘、确定性（同输入同输出）；顾问面板与警告消费同一份。
_Avoid_: 组装上下文（泛指会话上下文）

**通道锚点（Channel Anchor）**:
组装规划里代表一条非 system 通道的占位节（不可执行、文本为空），只用于缓存断点、顺序 lint 与面板呈现；通道内容由执行该通道的票决定。
_Avoid_: 占位节（泛称；锚点是规划概念）

**顺序豁免（cacheIsolated）**:
顺序覆盖配置条目上的布尔标记：豁免「易变节排在稳定节之前」的 lint；不改变放置、文本或运行时缓存行为，不是变维度。
_Avoid_: 缓存标记（会误读为可执行的缓存语义）

**组装注册（Assembly Registration）**:
把一份组装规划里标记为可执行的 system 节挂进某个 Agent 的 scoped 上下文（`agent.ctx`）的运行时面：同名节遮蔽部署级同名节，全量替换（先撤销旧注册再注册全部），返回 disposer；disposer 是服务端重载的析构点。
_Avoid_: 挂载（泛指生命周期）、sink（连接器副作用面的总称）

**兼容模式（Compat Mode）**:
组装的默认产品形态：以基础包实现，scoped 节注册进原版提示词注册表，复用原生遮蔽与 order；兼容优先。
_Avoid_: 基础模式（易混）、扩展模式（旧称）

**替换模式（Replacement Mode）**:
组装的额外包形态：经 `cordis.patch.yml` 停用兼容组装行并插入自己，替换原版实现，功能更多；接口是基础接口的宽子类型，本阶段不实现。
_Avoid_: 上游补丁（维护者已裁决不可行）

**宽子类型接口（Wide Subtype Interface）**:
基础成员全保留、只增不改的接口扩张。替换模式可以返回更丰富的值或增加成员，但下游只按基础面编码，无能力探测。
_Avoid_: 平行适配器（旧读法，已修正）、双接口（旧读法）
