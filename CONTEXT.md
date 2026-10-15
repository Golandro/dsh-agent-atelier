# Agents Manager

DSH 插件 agents-manager 的领域词汇：一个面向用户的「Agent（专家）」层——agent 文档定义人设与模型选用，与模型别名层正交。术语随 grilling 裁决落地。

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

### 诊断与预置

**诊断**:
发现 / 解析期的非致命问题：跳过该文件并记录，不阻断启动，由 UI 呈现。被跳过的 Agent 不可见即不可用。
_Avoid_: 错误（硬错误另有所指，如链耗尽）

**预置技能**:
Agent 声明的技能名列表，召唤时预先带上，省去技能发现与加载的对话轮次；按名引用原生 skills 注册表，存在性只警告不保证。
_Avoid_: includes（旧字段名；旧义「相对路径引用 markdown 资源」已废弃）

**默认 Agent**:
内置的回退 Agent（agent-name `default`）：无人设、模型走 dsh-default 别名；召唤它等价于原生子代理调用，是替换机制的兼容桥。因其承担回退路径，`default` 是保留字。

**Dsh-default**:
指向 DSH 子代理默认模型对的内置别名（别名注册表范围）。
