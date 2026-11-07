# 用户自助可观测框架：宿主观测事件与带外接管能力（研究，票 #40）

> 票：[#40](https://github.com/Golandro/dsh-agent-atelier/issues/40)。父地图：[#38](https://github.com/Golandro/dsh-agent-atelier/issues/38)。
> 日期：2026-11-07。作者：研究子代理（volcengine-plan/deepseek-v4.1-flash）。
> 一手源：DSH 源码树 `~/repo/deepseek-harness`（现场 commit `fcc0ad4`，2026-11-04，release 0.2.2-rc.1 合并提交；运行期版本 0.2.2-rc.1），本仓工作树 `9d5a2c2`（2026-11-05，分支 `research/host-observability`），本机 profile `~/.dsh/profiles/web`。
> 边界：只读；未改 `src/`、`GLOSSARY.md`、GitHub；未做真机实验；复用 R2-obs（#34）失败码结论，不重复研究。

**路径约定**：下文 `packages/...:行号` 相对 `~/repo/deepseek-harness`；`src/...:行号` 相对本仓工作树；profile 路径为绝对路径。行号是 2026-11-07 现场读到的版本，实施时以锚点复核为准。

## 1. 范围与源码修订

### 1.1 问题与边界

本票只回答一个问题：当前安装的 DSH / Cordis 与本仓接线，哪些宿主能力可以支撑“用户自助可观测框架”，哪些没有，哪些只能由插件自建。逐项给出 primary source、负载/API、稳定性、限制与运行时验证建议；区分浏览器侧与宿主侧。**不预设 API 存在**，不把推断写成事实。

不在本票内：失败码分类（复用 R2-obs）、具体 UI 视觉、产品实现、宿主内部修改。

### 1.2 源码修订与安装态

| 项 | 值 | 来源 |
|---|---|---|
| DSH 源码 commit | `fcc0ad4`（2026-11-04，Merge PR #7873，release 0.2.2-rc.1 到 master） | `git -C ~/repo/deepseek-harness rev-parse HEAD` 与 `log -1` |
| DSH 运行期版本 | `0.2.2-rc.1` | 本会话 runtime context；`packages/bundle/base/package.json` 版本 |
| 本仓工作树 | `9d5a2c2`（2026-11-05，fix(dsh-client) 范围切换误报） | `git rev-parse HEAD` |
| 当前分支 | `research/host-observability`（无 upstream） | `git branch -vv` |
| 已装 bundle | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 在 profile bundle 列表 | `~/.dsh/profiles/web/package.json:31-56`（base 32，web-app 33） |
| 已装导出/统计/轮廓 | `session-log-download`、`session-stats`、`session-turn-outline` 行 | `packages/bundle/web-app/cordis.patch.yml:66-68`、`:96-104` |
| 已装存储/遥测 | storage + json + domain；session-telemetry-otel | `packages/bundle/base/cordis.patch.yml:179-190`、`:218-232` |
| 本仓已装形态 | profile `node_modules` 中 `dsh-agent-atelier` 软链回本 workspace | `readlink -f ~/.dsh/profiles/web/node_modules/dsh-agent-atelier` |

**事实**：profile 中 `session-log-export` 与 `session-stats`/`turn-outline` 是 web-app 行，不是本插件提供的；它们的可用性取决于 profile，不应被本插件当作无条件存在。

### 1.3 方法与证据口径

- 宿主源码：逐文件读 + 行号核对；本仓 `src/` 先用 LSP 符号工具取轮廓（本会话 LSP 可用，`lsp_symbols` 对 `src/dsh/client/index.ts`、`src/control/core.ts` 等返回了真实符号），再读内容；没有“无 LSP 却默默 grep”的降级。
- 未做运行时实验：没有启动独立 profile、没有发请求、没有改 profile。所有“应可/可能”都放在推断或未验证。
- **稳定性三类**（本报告口径，不是 DSH 的兼容承诺）：
  - **公开契约**：在 `declare module` 中声明的事件、导出的接口/类型、`@Remote` 方法、JSDoc 明说给消费者用的服务；跨包有第二个消费者或 README 说明。
  - **内部形态**：可从运行期对象结构读取，但不是为第三方 bundle 声明的扩展点；或受仓库内部 gate/实验命名空间约束。
  - **缺失**：没有 API，或被占位（如唯一 backend 已被占用），或只有全量导出而没有本票需要的形状。
- 标记：【事实】有源码；【推断】由事实组合；【建议】按本仓约束给出的落点；【未验证】需要 spike。
- **重要前提**：DSH 目前没有“第三方 in-process 插件 API 的版本承诺”。本报告的“公开契约”只表示“宿主自己声明并消费的扩展点”，不等于跨版本稳定；ADR-0001 禁止本仓 import `@deepseek-ai/*`，所以全部按结构读取。

### 1.4 结论速览

1. **宿主事件面足够支撑“Agent/session/turn/step/tool/LLM”生命周期观测**：`agent/*` 是 Cordis 事件，`turn/step/tool/request` 是 session 事件，`tools/*` 是 Cordis 事件，`llm/stream` 是 waterfall；均有导出类型与行号（§2.1）。失败码直接复用 R2-obs，不重复。
2. **浏览器侧不是“只能看摘要”**：本地 owner 可通过 `remote.session.follow` / `observeEvent` 拿到原始 session 事件与 assistant-stream 帧（§2.2 B2），并能读 `sessionStats`、`turnOutline`、`inbox`、`modelSelection`、`permissions` 等投影；但宿主侧的工具管线事件与 `llm/stream` 不在浏览器侧。
3. **主选项卡能力是现成的，编辑器上下文跳转 slot 不存在**：`sidebar.panellist` + 根级 keyed `main` 是公开契约（本仓已用，`src/dsh/client/index.ts:107-114`）；`ctx.layout.selectPanel` 是唯一的跨面板跳转原语，但不带 payload；没有“Agent 编辑器”宿主 slot（§4）。
4. **本地有界存储没有宿主配额**：`storageDomain` 可开插件自有 KV 域，投影注册可得到每会话一份的持久 checkpoint；两者都不自带上限/TTL，必须由插件实现；全量导出只有 `session-log-export` 的 ZIP（含附件/子会话、无脱敏/无 manifest）（§5）。
5. **带外 Agent 有两条真实路径**：宿主 `ctx.agents.create` 不需要父 Agent，但由插件持有并在 dispose 时移除会话；`subagents.startActivation` 要求“精确存活的父 Agent”；浏览器 `ctx.sessions.create` 能建普通会话但没有工具白名单，只能用 `/permission read-only` 这类会话级边界（§6）。
6. **最关键缺口**：`llm/stream` 没有 turn/step/attemptId 关联；`agent/request` 已对新监听者废弃；session 没有 durable `workspaceId`；工具执行事件没有 turn/step/开始时间；没有“诊断包/脱敏/manifest”API；`sessionTelemetry` 是单 backend 且已被 OTel 占用（§7）。

## 2. 能力矩阵

侧代码：**H** = 宿主侧（Cordis 宿主插件可见）；**B** = 浏览器侧（client bundle 可见）；**H+B** = 两侧都有不同形状。验证建议列引用 §9 的 spike 编号。

### 2.1 宿主事件与投影面

| ID | 能力 | 侧 | primary source | 负载 / API | 稳定性 | 限制与验证 |
|---|---|---|---|---|---|---|
| H1 | Agent 生命周期 | H | `packages/core/agent/src/runtime-types.ts:274-336` | `agent/created` `{agent, source, signal?}`；`agent/disposed` `{agent}`；`agent/status` `{agent, status}`；`agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded` | 公开契约 | 事件无 `time`；root 收全部，agent-scoped 只收该 agent（JSDoc :287-307）；S1 |
| H2 | Agent 步/请求钩子 | H | `packages/core/agent/src/runtime-types.ts:337-429` | `agent/pre-step` `{agent,messages,turn,step,signal,modelSelection}`；`agent/request` `{agent,turn,step,signal}`；`agent/request-error` `+ provider/failure/retryPolicy`；`agent/turn-stopping`；`agent/error` | 公开契约，**`agent/request` 已废弃**（:362-366） | 新监听者不要用 `agent/request`；失败钩子必须委派 `next()`；S1 |
| H3 | 实时助手流 | H | `packages/core/agent/src/runtime-types.ts:154-188`；`packages/core/agent-loop/src/assistant-stream.ts:45-108` | `agent/assistant-stream` `{agent, frame}`；frame = start `{attemptId,revision,turn,step}` / chunk `{attemptId,revision,index,time,chunk}` / end `{attemptId,revision,index,outcome}` | 公开契约 | 进程内临时发布，非持久；每 token/chunk 一条，负载高；attemptId 只在 Agent 生命周期内唯一；S1 |
| H4 | Session 生命周期与事件面 | H | `packages/core/session/src/index.ts:56-76`；`packages/core/session/src/types.ts:287-436` | `session/created`(session)、`session/disposed`(session)、`session/event`(session,event)、`session/flush`；event `{type,seq,time,data,ignorable?,surfaceOp?,sourceEventSeqs?}` | 公开契约 | post-commit、逐监听者隔离；含全部内容/参数；`snapshotEvents` 已对新调用废弃（:720-727）；S1 |
| H5 | Tool 管线事件 | H | `packages/core/tools/src/events.ts:6-58` | `tools/pre-execute`(exec,next)、`tools/execute`(exec,next)、`tools/post-execute`(exec,result,next)、`tools/result`(exec,result)、`tools/change` | 公开契约 | 前三个是 waterfall，观察者必须 await next() 并原样返回；`tools/result` 是 emit、监听失败被 contain；无 `time`/`turn`/`step`；S1 |
| H6 | Tool 执行字段 | H | `packages/core/tools/src/contracts.ts:174-234`；`packages/core/tools/src/batch.ts:243-266` | `ToolExecution` = `{callId,rootCallId,name,arguments,agent,toolSet?,parent?,signal,token}`；结果 `{value,content,error,meta,additionalContexts,concludesTurn}` | 公开契约 | `arguments` 是已解析值（session 里另有原始字符串）；`token` 是 process-local symbol；turn/step 只在 session `tool/call`/`tool/result`；S1 |
| H7 | LLM 调用流 | H | `packages/llm/llm/src/index.ts:75`、`:1170-1184`；`packages/llm/llm/src/types.ts:564-606` | `llm/stream`(this: LlmRuntime, options: GenerateOptions, next) => AsyncIterable<StreamChunk>；options 含 provider/model/messages/tools/sessionId/purpose/signal | 公开契约 | 每次模型调用（含重试）；**无 turn/step/attemptId**；携带完整 prompt/tool schema；scope 过滤未验证（沿用 R2 残差 6）；S1 |
| H8 | LLM 失败事实 | H | `packages/llm/llm/src/types.ts:48-66`；`packages/core/agent-loop/src/agent.ts:505-524` | `LlmFailure` `{message,code,status?,providerRetryAfterMs?,requestId?,offloadImages?}`；`turn/end.reason.error`；`finish` chunk 的 `reason.failure` | 公开契约 | **复用 R2-obs**：不重复研究；成功请求没有 provider requestId；S1 |
| H9 | Session telemetry | H | `packages/session/session-telemetry/src/index.ts:20-44`、`:65-91`、`:98-135`、`:148-172`；`packages/bundle/base/cordis.patch.yml:218-232` | `sessionTelemetry` 单 backend；`SessionTelemetryRecord` `{sourceEvent?,channel,time,severity,attributes,body}`；`session-telemetry/record` 脱敏 waterfall | 公开契约，但 **key 唯一且已被 OTel 占用** | 不能加第二个 backend；profile 默认 FEEDBACK_ONLY（可被 `DSH_TELEMETRY_MODE` 覆盖），普通活动不上传；插件只能监听 `session/event` 自建，不能复用该 sink；S6 |
| H10 | Session 投影注册 | H | `packages/session/session-projection/src/index.ts:83-133`、`:322-336`；`packages/session/session-stats/src/projection.ts:107-206`；`packages/session/session-turn-outline/src/projection.ts:85-138`；`packages/core/agent-loop/src/inbox.ts:27,60-61` | `ctx.sessionProjections.register(def)` -> `ProjectionHandle`；def `{key,stateSchema,init,apply,wire?,stateVersion}`；现成 key：`sessionStats`、`turnOutline`、`inbox`、`modelSelection`、`permissions`、`subagent` | 公开契约 | 必须同步/纯函数/plain JSON；对**所有** session 逐事件 fold；任意 key 的 `wire` 类型上被 `never`（:104-125），外部插件难做浏览器可见视图；S2 |
| H11 | 插件记录 | H | `packages/core/session/src/index.ts:469-501` | `appendPluginRecord(session, type, data)`；type 形如 `plugin:...`；读取 `pluginRecordOf` | 内部形态（实验命名空间；宿主仓库 gate 只许 packages/experimental 生产调用） | 外部包运行期可调用，但非稳定契约；迁移只 best-effort；不入模型面；S3 |
| H12 | 工作空间身份 | H | `packages/workspace/workspace/src/types.ts:16,69-100`；`packages/workspace/workspace/src/index.ts:292` | `WorkspaceId`（uuid，非路径）；`Workspace` `{id,path,title,createdAt,updatedAt,sessionIds,status()}`；`list(): Workspace[]` | 公开契约 | session header **没有** `workspaceId`；成员关系靠 `cwd` 与 `path` 实路径匹配（:73-78,89-100）；S2 |
| H13 | 子代理 lineage | H | `packages/subagent/subagent/src/types.ts:95-109,144-191,249-279`；`packages/subagent/subagent/src/index.ts:131-167,267-292` | `subagent/start`(SubagentRunInfo)、`subagent/end`(RunEndInfo)；`RunInfo` `{runId,provider,parentSessionId,id,local}`；start request `{cwd,agentPreset?,label,prompt,parent,signal,...}` | 公开契约 | `subagents.startActivation` 要求**精确存活父 Agent**（:275-277 UNAUTHORIZED）；child approval 固定 `never`，sandbox 只继承父显式 override；S3 |
| H14 | 本地 KV 存储 | H | `packages/storage/storage-domain/src/index.ts:69-174`；`packages/storage/storage-domain/src/domain.ts:20-137`；`packages/storage/storage-json/src/index.ts:28-36,109-118` | `ctx.storageDomain.open(spec)` -> `Domain`；`Domain.global`、`table(name).get/put/delete/update`；backend json root=`$DSH_HOME/storages` | 公开契约 | **无配额/TTL/上限**；domain/表名受 `UNIT_NAME_RE`；一次一 domain；单 layout 适合小数据，per-record 适合大量记录；S5 |
| H15 | 冷读、lineage 与全量导出 | H+B | `packages/session-query/session-query/src/index.ts:174-198,310-331,327`；`packages/session-query/session-log-export/src/routes.ts:8-17`、`:173-234`、`packages/session-query/session-log-export/src/archive.ts:1-22` | `sessionQuery.readSession/listSessions/traceSession/listEvents/readSurface`；HTTP `GET /api/session.export?sessionId=...&includeDescendants=true` 输出 ZIP | 公开契约 | 导出是**全量**（日志+附件+子代理），无脱敏/manifest/大小上限；route 没有逐 session `remoteAccess` 检查（只有连接级鉴权）；S5/S6 |
| H16 | 带外顶层 Agent 创建 | H | `packages/core/agent/src/index.ts:66-121,146-163,410-435`；`packages/core/agent/src/runtime-types.ts:220-270` | `ctx.agents.create({sessionId,meta?,seed?,agentOptions?,setup?,signal?})` -> `AgentHandle`；`setup(agentCtx, agent)`；`agent.followup/inject/send/whenIdle/status` | 公开契约 | 不要求父 Agent；插件持有 handle；`dispose()` 停止/注销并把 session 移出 store；live 期间仍会出现在 browser session list；S3 |

### 2.2 浏览器侧

| ID | 能力 | 侧 | primary source | 负载 / API | 稳定性 | 限制与验证 |
|---|---|---|---|---|---|---|
| B1 | Session 列表与状态 | B | `packages/api/session-controller/src/types.ts:154-167`；`packages/api/session-controller/src/client/sessions/service.ts:26-70`；`packages/api/session-controller/src/index.ts:224-247` | `ctx.sessions.list.getSnapshot()` -> `{items,state,phase,projectionsBySession}`；行 `{agentAvailable,formatStatus,sessionId,updatedAt,running,blank,parentSessionId?,origin?,cwd?,projections?}`；事件 `api-session/added`、`removed`、`status`、`activity`、`error` | 公开契约 | summary 不含 turn/step/工具统计；`running` 是 Agent 状态；`lastAgentError` 只在打开会话的 snapshot，user-safe；S4 |
| B2 | 原始 session 事件与助手流 | B | `packages/api/session-controller/src/index.ts:553-556,564-567,609-612`；`packages/api/session-controller/src/types.ts:460-470,492-550,559-570,660-667` | `remote.session.observeEvent(address)` -> `ready` + SessionEventFrame；`remote.session.follow(address, assistantStream:true)` -> snapshot + event entries + `assistant-stream` frames；frame 形同 H3 | 公开契约（Remote wire） | 需要 session 地址/已 retain；本地 owner 全通，远端 peer 受 `remoteAccess` 策略；事件含内容/参数；S4 |
| B3 | 投影值 | B | `packages/api/session-controller/src/client/sessions/service.ts:61-70`；`packages/api/session-controller/src/client/contract/session.ts:57-65`；`packages/api/session-controller/src/types.ts:48-61` | `byId[id].projectionValues`（summary 集）；`projectionsBySession[id].values`（attached 全集）；`session.projections.faceOf(key).getSnapshot()` | 公开契约 | 只有 **wire** 投影；`sessionStats`/`turnOutline` 明确 `summary:false`，要从 `projectionsBySession` 或 retain 后读；插件自有 key 的 wire 类型受限（H10）；S2/S4 |
| B4 | 工作空间与导航 | B | `packages/api/workspace-controller/src/client/service.ts:35-115`；`packages/client/ui-workspace/src/client/navigation.ts:40-102,293-321,552` | `ctx.workspaces.list.getSnapshot()` -> `items/archived/pinned/state/phase/error`；`ctx.uiWorkspace.openSession(target)`；`openWorkspace/startSession/connectWorkspace` | 公开契约 | `openSession` 会改最近导航；`selectPanel(null)` 回会话；没有“带 payload 的跳转”；S4 |
| B5 | 建会话与发目标 | B | `packages/api/session-controller/src/client/contract/sessions.ts:88-93`；`packages/api/session-controller/src/client/contract/session.ts:98-103`；`packages/api/session-controller/src/types.ts:268-277,324-337` | `ctx.sessions.create({workspaceId?,cwd?,sessionId?,agentPreset?})` -> id；`session.prompt(content, mode, signal?, requestId?)`；`session.command(line)` | 公开契约 | 创建请求**没有** sandbox/tool allowlist；只能先建再 `/permission`；没有“隐藏会话”选项；S4 |
| B6 | 一级主选项卡 slot | B | `packages/client/ui-layout/src/client/index.ts:59-75`；`packages/client/ui-sidebar/src/client/contract/slots.ts:43-49`；先例 `packages/client/ui-plugin-manager/src/client/index.ts:129-173` | `sidebar.panellist` list `{id,order?,label?}` + 同 id 的根级 `main` keyed `{key,store?,inject?,children?}` | 公开契约 | 同一 id 两座；`main` 同一 key 同一 priority 只一个 occupant（`packages/client/ui-slots/src/index.ts:1259-1264`，priority 可覆盖）；order 冲突不报错但排序不稳；本仓已用 `agent-atelier`；S4 |
| B7 | 面板切换 | B | `packages/client/ui-layout/src/client/service.ts:28-54,72-85`；`packages/client/ui-layout/src/client/index.ts:49-52` | `ctx.layout.panelInfo`、`selectPanel(id 或 null)`、`beginNavigation(): AbortSignal`、`toggleSidebar` | 公开契约 | `selectPanel` 未注册 id 会 throw；无 payload/上下文；后一次导航会 abort 前一次；S4 |
| B8 | 编辑器/上下文跳转 slot | B | — | **无** | **缺失** | 宿主没有“Agent 编辑器” slot；client 包的 `editor` 指输入框/设置编辑器；只能由插件内共享 store 或自有 route；S4 |
| B9 | 全量导出入口 | B | `packages/session-query/session-log-export/src/routes.ts:8-17`；`packages/session-query/session-log-export/src/index.ts:66-115,173-234` | `GET /api/session.export?sessionId=...&includeDescendants=true`（GET/HEAD），ZIP 下载；`/export` 命令与 Markdown 复制 | 公开契约（浏览器可下载） | 全量、无脱敏、无 manifest；依赖 sessionQuery/persistence/attachments；S5/S6 |

### 2.3 负载、隐私与量级

| 类别 | 事件/API | 是否含原始内容 | 量级 | 默认采集建议 |
|---|---|---|---|---|
| 高敏 + 高量 | `session/event`、`llm/stream`、`tools/result`、`agent/assistant-stream` | 是（prompt/回复/tool 参数/结果/文件引用/流片段） | 每 token/chunk、每事件一条 | **不落原文**；只取元数据/码/计数/时间 |
| 中敏 | `turn/end.reason.error`、`subagent/end.lastAssistantMessage`、`api-session/error` | 可能（provider 错误文本、最后助手消息） | 每 turn/每 run | 只取 `code/status/name`；消息文本先脱敏/截断 |
| 低敏 | `agent/created`/`disposed`/`status`、`session/created`/`disposed`、`subagent/start`/`end`（除上）、`turn/start`/`step/start`/`step/end`、`request/header`、投影值 `sessionStats`/`turnOutline` | 否（header 有 provider/model/工具 schema，不含 messages） | 低 | 可默认采集 |
| 现有摘要 | `SessionSummary`、`sessionStats`、`turnOutline` | 否（turnOutline 有 prompt/response 预览，仍属内容） | 低/中 | `sessionStats` 可默认；`turnOutline` 预览需按隐私策略裁剪 |

**事实**：`session/event` 的 `data` 是完整事件负载（包括 `user/message` 内容、`tool/call.arguments` 原始串、`tool/result.message.content`、`assistant/message.stream`）；`tools/result` 的 `result` 是深层冻结的 `ToolExecutionResult`。**建议**：本插件默认采集“元数据投影”，原文只在用户点开某条详情时按需读取，且不持久化。

**事实**：`agent/*` 事件没有 `time` 字段；`session/event`/`tools/result` 的时间来自 event `time` 或本地时钟；要做时长，必须用 session `tool/call`→`tool/result` 的 `time` 差（`session-stats` 正是这么做的，`packages/session/session-stats/src/projection.ts:161-175`）。

### 2.4 稳定性分布

- 公开契约：H1-H10、H12-H16、B1-B7、B9。
- 内部形态：H11（plugin record）、H10 的任意 key `wire`、B2 的第三方 client 使用方式（Remote 是公开的，但没给第三方 bundle 的文档/类型入口）。
- 缺失：B8、诊断包/脱敏/manifest、session 上的 `workspaceId`、LLM 成功 requestId、工具 turn/step/开始时间、`sessionTelemetry` 的本地第二 sink、atelier 模板身份到 session 的稳定关联。

## 3. 生命周期关联标识

### 3.1 标识清单

| 标识 | 归属/范围 | 字段与来源 | 稳定性 | 限制 |
|---|---|---|---|---|
| Agent 身份 | 进程内 | `Agent.id` 就是 `SessionId`，见 `packages/core/agent/src/types.ts:16-19`；`ctx.agents.get(sessionId)` 返回 `Agent` | 公开契约 | 1:1 且不可再生；session 恢复后 id 不变；Agent 对象本身是进程内句柄 |
| Session 身份 | 持久 | `SessionId`（`packages/core/session/src/types.ts:21-30`）；header `id`（:106-108） | 公开契约 | 日志/持久化/会话列表的唯一键；不含 workspace 前缀 |
| Session 序号 | 持久 | `SessionEvent.seq`（`packages/core/session/src/types.ts:501-524`）；`time`（epoch ms） | 公开契约 | 每 session 单调、连续；**无全局序**；time 可并列 |
| Turn/Step | 持久 | `turn/start`、`step/start`、`turn/end`、`step/end` 的 `data.turn`/`data.step`（`packages/core/session/src/types.ts:294-308`） | 公开契约 | 编号每 session 从 0/1 起；跨 session 不可比 |
| Message 身份 | 持久/进程内 | `MessageId`（`packages/llm/llm/src/brand.ts:15-25`）；`createMessage` 生成 | 公开契约 | 同一消息在 inbox/log/request 边界稳定 |
| Tool call 身份 | 持久/进程内 | `ToolCallId`（`packages/llm/llm/src/brand.ts:27-40`）；session `tool/call.callId`、`tool/result.message.toolCallId`；`ToolExecution.callId/rootCallId` | 公开契约 | provider 分配，可重复/可合成（`mock`）；必须与 sessionId 联合唯一；嵌套调用用 `rootCallId` |
| LLM attempt | 进程内 | `LlmAttemptId`（`packages/llm/llm/src/brand.ts:54-64`）；`agent/assistant-stream` start frame 的 `attemptId`（`packages/core/agent/src/runtime-types.ts:154-188`；`packages/core/agent-loop/src/assistant-stream.ts:45`） | 公开契约 | 只在一次 Agent 生命周期内唯一；id 形如 `sessionId:attempt`; 重启后不保留 |
| Provider request | 失败时 | `ProviderRequestId`（`packages/llm/llm/src/brand.ts:42-52`）；只出现在 `LlmFailure.requestId`（`packages/llm/llm/src/types.ts:48-66`） | 公开契约 | **成功请求没有**；不是所有 provider 都给 |
| 父会话/来源 | 持久 | `SessionHeader.parentSession`、`origin`、`delegationDepth`、`agentPreset`（`packages/core/session/src/types.ts:107-135`） | 公开契约 | 只表达直接创建者/粗粒度 origin；fork 与 summon 都可能是 `parentSession` |
| 子代理 run | 进程内 | `SubagentRunInfo.runId`、`parentSessionId`、`id`、`provider`（`packages/subagent/subagent/src/types.ts:95-109`）；`subagent/start`/`end`（`packages/subagent/subagent/src/index.ts:158-166`） | 公开契约 | runId 只在 live 事件里；不写入 session header；进程重启后不可恢复 |
| 工作空间 | 持久 | `WorkspaceId`（uuid）与 `Workspace.sessionIds`（`packages/workspace/workspace/src/types.ts:16,69-100`） | 公开契约 | session 上没有 `workspaceId`；只能按 header `cwd` 与 `Workspace.path` 匹配（:73-78,89-100） |
| 模型路由 | 持久/投影 | `request/header` 的 `config.provider/model`；`modelSelection` 投影（`packages/core/agent/src/model-selection.ts:73-90`） | 公开契约 | 是“本步/下一次”选择，不等于实际请求成功；失败码另见 R2 |
| Atelier 模板身份 | 无宿主字段 | 本仓 `agentName`（`src/control/types.ts:231`）只在注册表；没有写进 session | **缺失/插件自建** | 需要自建 `sessionId -> agentName` 索引，或写 `plugin:` 记录（H11） |

### 3.2 关联链

**（事实）Agent 与 Session 是同一身份**：`Agent.id` 的定义就是 session-backed identity（`packages/core/agent/src/types.ts:16-19`），`Session.id` 来自 header（`packages/core/session/src/index.ts:548-551`）。所以“跨 Agent 关联”首先是 `sessionId`；不需要第二个 agentId 字段。

**（事实）Turn/Step 关联**：
- 每个模型步由 `step/start` 打开、`step/end` 关闭（`packages/core/agent-loop/src/agent.ts:361,388`）；`turn/start`/`turn/end` 包住多个 step（:336,422）。
- 工具调用与结果以 `turn`/`step` 写入 session（`packages/core/tools/src/batch.ts:243-266`），并在 `tool/call` 上先于执行提交。
- `assistant/message`、`assistant/attempt` 事件也带 `turn`/`step`（`packages/core/session/src/types.ts:349-383`）。
- **（推断，需 S1）** 若在 root 监听 `session/event`，`tool/call` 一定早于对应 `tools/result` 到达（因为 batch 在执行前 append call，执行后 commit result，:243-266）；据此可建立 `callId -> (turn, step, startedAt)` 的桥，供 H5/H6 使用。

**（事实）LLM 请求关联**：
- `llm/stream` 的 `GenerateOptions.sessionId` 由 loop 写入（`packages/core/agent-loop/src/agent.ts:735-742`；`packages/llm/llm/src/types.ts:595-599`），因此至少能关联到 session。
- 请求本身**没有** `turn`/`step`/`attemptId`（推断/事实见 H7）；`agent/request` 虽带这些字段，但已对新增监听者废弃（`packages/core/agent/src/runtime-types.ts:362-366`）。
- **（推断，需 S1）** 可行桥：root 监听 `session/event` 的 `step/start`/`step/end`，按 sessionId 维护当前 step；`llm/stream` 到达时按 `options.sessionId` 取当前 step。重试仍属同一 step，故 (turn, step) 稳定；辅助模型调用（如 session-title）不在 step 内，不能强绑。
- **（事实）** 每次尝试的 `attemptId` 由 `AssistantStreamAttempt` 生成（`packages/core/agent-loop/src/assistant-stream.ts:45`），start frame 带 `turn`/`step`（:49-57）；所以“流内容 -> attemptId -> turn/step”是可得的，但要把 `llm/stream` 的 chunk 与某个 attempt frame 对上，仍需顺序或对象身份桥（S1）。

**（事实）Tool 关联**：
- 模型响应的 `ToolCallBlock.id` -> session `tool/call.callId` -> `ToolExecution.callId` -> `tool/result.message.toolCallId` 是同一 provider 分配 id（`packages/llm/llm/src/types.ts:111-119`；`packages/core/session/src/types.ts:369-383`；`packages/core/tools/src/contracts.ts:174-234`）。
- 嵌套 PTC 调用用 `rootCallId` 表达父子（`packages/core/tools/src/contracts.ts:219-234`）；`token` 是进程内 symbol，不可持久化。
- **（推断，需 S1）** 若只拿 `tools/result`（无 turn/step），可用上面 `callId` 桥从 session `tool/call` 补 turn/step；若工具结果在 turn 被取消时没有 `tool/result` 事件，需要 turn/end 的收尾处理（见 R2 的 `TOOL_OUTCOME_UNKNOWN`）。

**（事实）召唤/子代理关联**：
- `SubagentRunInfo` 带 `runId`、`parentSessionId`、`id`、`provider`（`packages/subagent/subagent/src/types.ts:95-109`），`subagent/start`/`end` 成对（`packages/subagent/subagent/src/index.ts:158-166`）；子会话 header 带 `parentSession`/`delegationDepth`/`origin`（`packages/core/session/src/types.ts:107-135`）。
- **限制**：runId 不写 session header；`subagent/end` 还带 `lastAssistantMessage`（内容），默认不应入库。
- **（缺失）** 宿主没有“atelier agentName / summon source”字段；本仓只能自建索引或写 `plugin:` 记录（H11），后者是实验形态。

**（事实）工作空间关联**：
- `Workspace` 有稳定 uuid 和 `sessionIds`（`packages/workspace/workspace/src/types.ts:16,69-100`），但 session header 只有 `cwd`（:95-136）。成员关系由 registry 对 header `cwd` 做 realpath 校验（`packages/workspace/workspace/src/index.ts:73-78,89-100`）。
- **（推断，需 S2）** 先用 `agents.list()/sessions.list()` 的 `cwd` 反向匹配 `workspaceRegistry.list()` 的 `path`，可以得到当前 workspaceId；workspace 被删除/路径消失时没有 durable 关联可恢复。

### 3.3 关联缺口

1. **Session 没有 durable workspaceId**：见上；这是诊断包跨工作空间聚合时最容易丢的维度。
2. **LLM 请求没有 turn/step/attemptId**：`llm/stream` 只有 sessionId；`agent/request` 已废弃；成功请求也没有 provider requestId。
3. **工具执行事件没有 turn/step/开始时间**：session 事件有，Cordis `tools/*` 没有；跨面关联需要插件桥。
4. **atelier 模板身份没有宿主字段**：session 不知道它是由哪个 `agent.md` 召唤的；`agentPreset` header 只表达宿主 preset，不应挪用。
5. **子代理 runId 不持久**：只能从 live `subagent/start` 得到；诊断包若在事后生成，只剩 header `parentSession`/`delegationDepth`。
6. **全局排序不存在**：每条 session 的 seq 独立；跨 session 只能按 `time` 排，且同毫秒会并列。

### 3.4 建议的最小关联键（本插件内部）

**（建议）** 诊断流的每条记录至少带：

    { schema: `atelier.diag.v1`,
      sessionId, agentName?, workspacePath, workspaceId?,
      turn?, step?, seq?, at,
      kind, code?, toolCallId?, attemptId?, parentSessionId? }

- `sessionId` 为主键；`agentName` 由本插件索引补；`workspacePath` 从 header `cwd` 来；`workspaceId` 尽力从 registry 匹配，匹配不到就留空并标 `unresolved`。
- `turn`/`step` 只在事件源有则填；不要用“当前 step”猜测历史事件。
- `toolCallId` 与 `attemptId` 只在对应事件/流出现时填；与 sessionId 联合构成唯一。
- 排序用 `at + sessionId + seq`；不要假设跨会话的 seq 可比较。

## 4. 主选项卡与跳转

### 4.1 宿主事实

**（事实）一级主选项卡 = 两座同 id**：
- `sidebar.panellist` 是 root 级 list 座（`packages/client/ui-sidebar/src/client/contract/slots.ts:43-49`）；
- `main` 是 root 级 keyed 座（`packages/client/ui-layout/src/client/index.ts:59-75`）；保留 key `conversation` 承载 Conversation，`selectPanel(null)` 选择它。
- 先例 `ui-plugin-manager` 用同一 id `plugins` 注册两座，并在 `main` 注册里带 `store`/`children`（`packages/client/ui-plugin-manager/src/client/index.ts:129-173`）。
- **事实**：同一 key 同一 priority 只能有一个 occupant，重复注册会 throw，可用 priority 覆盖（`packages/client/ui-slots/src/index.ts:1259-1264`）；`main` 未注册的 id 会被 `selectPanel` 拒绝（`packages/client/ui-layout/src/client/service.ts:72-78`）。

**（事实）跳转原语**：
- `ctx.layout.selectPanel(id | null)`：切中央面板，不改当前 Session；未注册 id 抛错（`packages/client/ui-layout/src/client/service.ts:28-54,72-78`）。
- `ctx.layout.beginNavigation()`：返回一个 `AbortSignal`，被下一次导航或布局释放中止；调用方在提交 UI 状态前检查（:37-41,81-85）。
- `ctx.layout.panelInfo`：只暴露 `activePanelId`（:19-22），**没有导航 payload**。
- `ctx.uiWorkspace.openSession(target)`：选中会话并显示 Conversation（`packages/client/ui-workspace/src/client/navigation.ts:40-45,293-321`）；它内部会用 `selectPanel(null)` 回会话（:552）。
- `ctx.slots.register` 的 `store`/`inject` 是面板私有状态的宿主座位；`hookContext` 是渲染 occurrence 的上下文，不是导航 payload（slot 注册字段 `store`/`inject` 见 `packages/client/ui-slots/src/index.ts:775-776`；`hookContext` 见 `:133,206,320-343`）。

**（事实）没有“编辑器 slot”**：
- client 包的 `editor` 主要是消息输入框（Conversation composer）或设置编辑器；没有面向第三方 Agent 编辑器的 `SlotMap` 键。
- 本仓的 Agent 编辑器是自有的 `src/dsh/client/page.tsx` + `pane.tsx` 体系，不是宿主 slot。
- 因此“编辑器上下文跳转”不是“找一个现成 slot”，而是“插件内共享导航状态 + 面板切换/会话打开”。

### 4.2 本仓现状

**（事实）** 本仓只注册了一个主面板：
- `src/dsh/client/index.ts:98` 只 inject `slots`；`:107-112` 注册 `sidebar.panellist` 行 `agent-atelier`（order 5）；`:113-114` 注册同 id 的 `main` keyed 面板。
- 页面内部已有页签状态 `agents`/`history`/`config`（`src/dsh/client/page.tsx:134-135`）；现有“顾问”是 `advisorOpen` 覆盖页（:133；`src/dsh/client/advisor.tsx:103`），是静态组装诊断，不是运行时观测。
- `ClientContext` 只声明 `slots` 与 `get(name)`（`src/dsh/client/index.ts:85-95`），没有 `layout`/`sessions` 的类型面；需要新增结构读取。

### 4.3 结论

- **（事实）** “顾问作为智能体工坊一级主选项卡”有两种落法：
  1. **工坊面板内部的一级页签**：不需要新 slot；在 `page.tsx` 的 `PanelTab` 里加 `advisor`，用共享 store 带上下文。这与 map 的“编辑器只保留带上下文跳转”最贴合。
  2. **全局新主面板**：注册第二个 `sidebar.panellist` + `main` id（例如 `agent-atelier-advisor`），用 `ctx.layout.selectPanel` 跳。它会是工坊之外的全局面板，不是“工坊的一级页签”。
- **（缺失）** 没有宿主提供的“editor -> advisor with context”slot；上下文必须由插件携带。

### 4.4 建议

**（建议）** 采用方案 1：
- 在工坊主面板内新增顶级页签（与 `agents`/`history`/`config` 同级），顾问视图与编辑器共享一个模块级 client store：`selectedAgentName`、`workspaceCwd`、`focusSessionId?`、`focusTurn?`。
- 编辑器的“查看该 Agent 的顾问视图”按钮只做两件事：写共享 store + `setTab('advisor')`（不需要 `selectPanel`）。若未来顾问独立成面板，再加 `ctx.layout.selectPanel('agent-atelier')`。
- 若需要从顾问跳到某个会话：用 `ctx.uiWorkspace.openSession(sessionId)`；这是唯一需要的跨面板会话跳转。
- **不要**为“上下文跳转”新建 slot；`main` 的 keyed store 已经够用，但跨工坊面板时仍要插件自建 store（宿主无 payload）。
- **（未验证，S4）** 第三方 client bundle 是否可直接 `ctx.get('layout')` 并调用 `selectPanel`；类型上 `ILayout` 是导出的，运行期应可，但需真机。

## 5. 本地存储与导出

### 5.1 宿主存储面

**（事实）存储是“hub + backend + domain”三段**：
- `ctx.storage` 是服务（`packages/storage/storage/src/index.ts:30-98`），自己不做 IO；backend 注册在 `storage.backend`。
- 基础 profile 同时装 `storage`、`storage-json`（root=`$DSH_HOME/storages`）、`storage-domain`（backend=`json`）（`packages/bundle/base/cordis.patch.yml:179-190`）。
- 插件可开自有 domain：`ctx.storageDomain.open(spec)`（`packages/storage/storage-domain/src/index.ts:69-174`），spec 需要 zod `valueSchema`（`packages/storage/storage-domain/src/spec.ts:14-72,107-147`）；domain 名/表名受 `UNIT_NAME_RE`。
- Domain API：`global.get/set`、`table.get/entries/keys/size/put/delete/deleteMany/update`（`packages/storage/storage-domain/src/domain.ts:20-137`）；写先落盘后改内存、再发 `domain/changed`（`packages/storage/storage-domain/src/domain.ts:1-10`）。
- `storage-json` 一个 unit 一个文件或一记录一文件，root 必填，无默认（`packages/storage/storage-json/src/index.ts:22-36`）。

**（事实）没有配额/TTL**：storage 与 json backend 的配置只有 `root`（:28-36），domain spec 只有 schema/layout/version（`packages/storage/storage-domain/src/spec.ts:35-72`）。上限、保留期、容量都要插件自己做。

**（事实）会话持久化与导出是另一条路**：
- `session-persistence-jsonl` 把日志写到 `$DSH_HOME/sessions`（base patch :140-141；具体实现不在本报告范围）。
- `sessionQuery` 可冷读、列会话、查 lineage、读事件窗口、读 surface（`packages/session-query/session-query/src/index.ts:174-198,310-331,327`）；它不激活 Agent。
- `session-log-export` 的 ZIP 是唯一现成的“打包导出”（routes :8-17；handler :173-234；zip 逻辑 `packages/session-query/session-log-export/src/archive.ts:1-22`），含 `subagents/<id>/session[.vN].jsonl` 与 `media/<attachmentId>`（`packages/session-query/session-log-export/src/archive.ts:8-10`），无 manifest。

### 5.2 投影缓存：一条被低估的持久化通道

**（事实）** `session-projection-cache` 持久化“每个 projection unit 的 state”，每 session 一条记录，存在 `session_projcache` domain（`packages/session/session-projection-cache/src/index.ts:1-16`）；写点在 session 创建、`turn/end`、session disposal，外加每 200 事件/5 秒的节流（base patch :196-200；cache 配置 :76-86）。**（事实）** 注册的 unit 即使没有 `wire` 也会 checkpoint（`packages/session/session-projection/src/index.ts:327-336`）。

**（建议）** 对“有界、按会话、重启后还在”的元数据，优先注册一个 **host-only projection**（无 wire），例如 `atelierDiagnostics`：
- state 只放计数/最后错误码/最后活动时间/最近 N 条**元数据**记录；数组在 `apply` 内硬截断；总 JSON 字节也设上限。
- 宿主侧通过 `ProjectionHandle.stateOf(session)` 读；浏览器侧由本插件自己的 HTTP route 返回（避免 H10 的 wire 类型缺口）。
- 代价：该 unit 对**所有** session 逐事件 fold，必须保持 O(1)/事件、纯函数、无 IO；版本变更要 `stateVersion`。

**（事实/限制）** 若坚持让浏览器直接读该投影：`SessionProjectionMap` 的 `wire` 条件在任意 key 上解析为 `never`（`packages/session/session-projection/src/index.ts:104-125`），外部包必须做声明合并；ADR-0001 又禁止 import 宿主包。结论：**不推荐**，用自己的 route 更干净。

### 5.3 导出

**（事实）全量导出**：
- `GET /api/session.export?sessionId=...&includeDescendants=true`（routes :8-17；handler :173-234），ZIP；`/export` 命令与 Markdown 复制（`packages/session-query/session-log-export/src/index.ts:66-115`）。
- 内容：根会话日志 + 子代理日志 + 引用附件；无 manifest、无脱敏、无大小上限；读取前对 live session 做 flush（`packages/session-query/session-log-export/src/archive.ts:58-70`）。
- **（事实）** 该包只从 query 取 `sessionId` 与 `descendants`，没有逐 session `remoteAccess` 检查；它依赖连接级鉴权（`connection.fetch.register`，:89-114）。远程 peer 的授权语义未在源码中额外收窄。

**（缺失）** 没有“诊断包”API：
- 没有 manifest、没有设备/版本/插件清单、没有脱敏策略参数、没有“只导元数据”的模式。
- `sessionTelemetry` 的 `session-telemetry/record` 是现成的脱敏 waterfall（`packages/session/session-telemetry/src/index.ts:20-44`），但它只服务唯一 backend，本插件不能把自己的 redaction 挂到别人的导出上；而且 profile 的 backend 是 OTel（默认 FEEDBACK_ONLY，可被 `DSH_TELEMETRY_MODE` 覆盖）。

### 5.4 “有界”应怎么定义

**（建议）** 本插件的默认诊断存储至少四条硬界：
1. **条数界**：每 session 最近 N 条元数据记录（N 可按 500 或 1000）；每 workspace 最近 M 个 session。
2. **字节界**：每记录最大字节（例如 2 KB）；每 session 总字节（例如 256 KB）；全局总字节（例如 16 MB）。
3. **时间界**：保留 T 天（例如 7/30 天），到期删除；或按“最近一次打开”淘汰。
4. **内容界**：默认不存 prompt/回复/tool 参数/结果/文件正文/环境变量/凭据；只存 code/status/名称/时间/计数/关联 id。

**（建议）** 落盘位置：
- 方案 A（推荐）：`$DSH_HOME/reports/atelier/` 下单文件 JSON/JSONL + 索引；宿主插件直接写文件，不走 storage domain；路径稳定、容易给带外 Agent。
- 方案 B：`ctx.storageDomain` 的 `atelier_diag` 域，适合 KV 索引/可查询；但要自己处理容量。
- 方案 C：宿主投影缓存（5.2），适合“每会话聚合”，不适合“每 workspace 索引”。

### 5.5 导出形状建议

**（建议）** 诊断包 v1（本地 JSON，用户可导出/给带外 Agent）：
- `manifest`：schemaVersion、createdAt、DSH 版本、profile、工作空间 path/id、会话 id、插件版本、脱敏策略、记录条数/字节数、截断标记。
- `session`：header（id/cwd/parent/origin/depth/preset/createdAt）、workspace 匹配结果、路由（provider/model）、turn/step 统计、最后错误码、工具调用计数/耗时、子代理 lineage。
- `events`：只含元数据（type/seq/time/turn/step/name/callId/code/status/duration），**默认不含 content/arguments/message**。
- `atelier`：命中的 agentName、模型链/组装发现、route observation 摘要（若可用）。
- **（建议）** 全量 ZIP 只作为“用户显式全量导出”按钮，链接到 `/api/session.export`；不放进默认诊断包。

### 5.6 隐私红线

**（事实）** 以下字段天然含原文，默认必须过滤：
- `session/event` 的 `user/message.content`、`assistant/message.content/stream`、`tool/call.arguments`、`tool/result.message.content`、`system/message.content`、`developer/message.content`、`feedback/record.text`。
- `tools/result.result.value/content`、`llm/stream.options.messages/tools`、`agent/assistant-stream.chunk`、`subagent/end.lastAssistantMessage`。
- `turn/end.reason.error.message` / `api-session/error` 可能带 provider 文本或路径；只取 `code/status/name`，文本截断/脱敏。
- `SessionHeader.cwd` 是绝对路径；是否入库由用户策略决定（默认可以留，因为它是关联键；但要标为 potentially sensitive）。

## 6. 带外 Agent 启动和上下文注入

### 6.1 宿主顶层创建（推荐给“面板内的一次性只读顾问”）

**（事实）** `ctx.agents.create(options)` 不需要父 Agent：`CreateAgentOptions` 只有 `sessionId`、可选 `meta`、`seed`、`agentOptions`、`signal`、`setup`（`packages/core/agent/src/index.ts:66-121`）；`AgentRegistry.create` 在 :410-435 调用工厂并返回 `AgentHandle`。`meta` 支持 `cwd`、`parentSession`、`isSeeded`、`origin`、`delegationDepth`、`agentPreset`（:80-87）。

**（事实）`setup(agentCtx, agent)` 在发布前运行**（`packages/core/agent/src/index.ts:54-57`；JSDoc :104-120）：
- `agentCtx` 是未发布的 agent scope；可注册 scoped 工具、prompt section、restriction、监听器。
- `agent.session` 已在 setup 期间可写；setup 的 append 在失败回滚时仍留在 session 里（:104-114）。
- `setup` 只做组合，“不驱动 Agent”；调用方在 create 返回后再 `followup`（:116-119）。

**（事实）驱动/注入方法**（`packages/core/agent/src/runtime-types.ts:190-271`）：
- `agent.followup(message)`：新开一个普通 turn 并唤醒；一条消息独占该 turn。
- `agent.send(message, target, wakeup)`：可指定 `next-turn`/`next-step`，可控制是否唤醒。
- `agent.inject(message)`：只放入下一 step 的模型面上下文，不唤醒。
- `agent.steer(message)`：在最近 step 边界送入 steering。
- `agent.model.select(selection)`：替换下一步的完整 provider/model/effort（`packages/core/agent/src/runtime-types.ts:54-72`）。
- `agent.status` / `agent.whenIdle()` / `agent.runMaintenance(task)`。
- `agent.session` 是可直接读写的 Session 对象（:194-195）。

**（事实）生命周期与可见性**：
- 创建会发 `session/created`，session-controller 立刻 `api-session/added`（`packages/api/session-controller/src/index.ts:224-226`），所以浏览器列表会看到这个会话（未挂 workspace 的会以 cwd 分组/未分组呈现）。
- `AgentHandle.dispose()` 停止 loop、注销 Agent、把 session 移出 store、再拆 scope（`packages/core/agent/src/index.ts:146-163`）。**不能**通过 `ctx.agents.get(id)` 再拿到 handle；只有创建者持有 disposer。
- **（推断，未验证）** dispose 只是把 session 移出 live store，持久日志可能仍在磁盘；dispose 后是否还能从 session list/持久层冷读、是否会被 workspace 账号引用，必须由 S3 验证。
- 若 `setup` 抛错，session 事件保留、Agent 不发布（:104-114）；插件要自己清理或复用。

**（事实）`agents.create` 没有强制 preset/白名单**：
- 不传 `agentPreset` 就是宿主默认组合（全局工具目录）。
- `agentOptions` 只给路由，不给工具权限。
- 因此**工具白名单必须在 setup 里做**；见 6.4。

**（推断）** 这是“面板内只读顾问”的最干净落点：创建 → 设 read-only/never/allowlist → `followup(objective)` → 收结果 → dispose/导出。没有父会话、不进入 workspace 账号；但仍会出现在浏览器会话列表（H16），dispose 后才移除。

### 6.2 子代理路径（有父 Agent 时可用）

**（事实）** `ctx.subagents.startActivation(spec)` 需要 `spec.parent` 且要求它是**精确存活的 Agent**：`ctx.get('agents')?.get(spec.parent.id) !== spec.parent` 直接抛 `UNAUTHORIZED`（`packages/subagent/subagent/src/index.ts:267-292`，校验 :275-277）。没有 parent-less 形态。

**（事实）** 子代理策略（`packages/subagent/subagent/src/child-agent.ts:249-279`）：
- `approvalPolicy` 固定 `never`（有 approval 服务时），无论父策略。
- `sandboxMode` 只继承父的**显式** `sandbox/mode` override；不继承部署默认，也不继承一次性 grant。
- `permissionPreset` 只在父为 `auto`/`danger-full-access` 时继承。
- `toolFilter` 只在“冷恢复”时从历史 descriptor 重放（:161-164,205-218）；**新启动请求没有 toolFilter 字段**（`packages/subagent/subagent/src/types.ts:144-191`）。
- `agentPreset` 可挂宿主 preset（:192-200）；无 preset 时沿用父的 composition。

**（事实）** 子代理结束后 `subagent/end` 带 `stopReason` 与 `lastAssistantMessage`（`packages/subagent/subagent/src/types.ts:115-124`），后者是内容，默认不能入库。

**（推断）** 若父会话没有显式 read-only 覆盖，子代理默认拿到部署的 workspace-write；因此“只读顾问”**不要**默认走子代理路径，除非先确保父会话是 read-only 或给子代理挂一个只读 preset。用子代理还要考虑 `maxActiveSubagents`/`maxDepth`（`packages/subagent/subagent/src/index.ts:186-191`；profile `subagent` 行 maxDepth 2 / 6 active）。

### 6.3 浏览器会话路径（用户可见、可接管）

**（事实）** 浏览器能建普通会话：`ctx.sessions.create({workspaceId?,cwd?,sessionId?,agentPreset?})`（`packages/api/session-controller/src/client/contract/sessions.ts:88-93`）；然后 retain 拿到 `SessionReference`（:25-33），`await reference.ready` 得 `SessionBinding`，其 `.session` 是 `SessionFace`（`packages/api/session-controller/src/client/sessions/service.ts:104-112`）。

**（事实）** 发目标：`session.prompt(content, mode, signal?, requestId?)`（`packages/api/session-controller/src/client/contract/session.ts:98-103`）；`session.command(line)` 走 slash command（:148-158）。

**（事实）** 权限切换命令是 `/permission <preset>`：handler 调 `this.apply(agent.session, name, policy => ctx.approval.setPolicy(agent, policy))`（`packages/interaction/permission-presets/src/index.ts:254-275`；:403-418）；`apply` 写 `permission/preset`、`sandbox/mode`、`approval/policy` 三个 durable 事件。profile 的 `read-only` preset = sandbox read-only + approval ask（`~/.dsh/profiles/web/cordis.patch.yml:38-48`）。

**（事实）** 浏览器建会话没有 sandbox/tool 参数（`packages/api/session-controller/src/types.ts:268-277`）；没有“隐藏会话”参数；会话会进 workspace 账号/列表。建完立刻 `/permission read-only` 再 prompt，存在“命令与 prompt 的 RPC 顺序”要求（两条都是 async；必须等 command 返回再 prompt）。

**（推断）** 这是“用户可见的只读接管”的最佳落点：read-only + ask 允许用户在需要改代码时显式批准升级（sandbox escalation / 切 workspace-write），符合地图的“经用户授权修改代码”。代价是没有工具白名单（用户能看到工具调用，但只读边界只挡写，不挡读/网络/进程）。

### 6.4 授权边界：三个可用的“闸”

| 闸 | 宿主 API | 适用范围 | 关键事实 | 限制 |
|---|---|---|---|---|
| 沙箱模式 | `setSandboxMode(session, mode)`（`packages/sandbox/sandbox-policy/src/session-mode.ts:53-54`）；写 `sandbox/mode` 事件 | 文件写效果 | `read-only` 拒绝一切 mutation；`workspace-write` 允许 workspace root + extra roots；`danger-full-access` 跳过 confinement（`packages/sandbox/sandbox/src/index.ts:24-30`） | **读不受限**（`packages/fs/fs-sandbox/src/index.ts:20,160-161`）；网络/进程可见性不在 sandbox 词汇内；session 的 cwd 是 workspace-write 根（`packages/sandbox/sandbox-policy/src/index.ts:197-204`） |
| 审批策略 | `ctx.approval.setPolicy(agent, policy)`（`packages/interaction/user-approval/src/index.ts:211-217`）；写 `approval/policy` 事件 | 交互式审批 | `never` 自动拒绝每个 ask，不弹窗（:60-68,117-122）；`ask` 交给 answerer，没有则 fail-closed | `never` 下无法“临时授权”；要授权必须切 `ask` 或换会话 |
| 工具限制 | `agentCtx.tools.restrict({allow?,deny?})`（`packages/core/tools/src/index.ts:162-188`） | 工具可见性 | 必须在 **agent-scoped ctx** 调用；不能全局；不能命名 `run_code`（PTC 传输，:177）；未知全局名会 throw（:182） | 只影响本 agent 的可见工具；PTC 嵌套调度的 scope 传播**未验证**（S3）；不是“进程隔离” |

**（事实）** 三者正交：sandbox 管文件写效果，approval 管 ask 交互，tools 管模型可见/可调度工具。只设一个都不是完整的“只读分析边界”。

**（建议）** “面板内一次性顾问”用：
- `sandbox/mode: read-only` + `approval/policy: never` + `tools.restrict({allow: [read, grep, glob, ...]})`（具体工具名按部署；allowlist 只放 end-capability 工具，不要放 bash/subagent/write/edit；`run_code` 是 PTC 传输，restrict **不能**命名它，见 6.4 的限制）。
- 或者：read-only + ask + 无工具白名单，但那需要用户在场回答审批，不适合纯后台。

**（建议）** “用户可见、可接管”用：
- 浏览器建会话 → `/permission read-only` → prompt；用户要改代码时显式批 escalation/切 preset；插件把这次切换记进诊断流（谁在何时授权）。
- 若要同时有工具白名单，浏览器路径做不到；只能由宿主插件代为创建（6.1），再把 session 交给用户（但 6.1 的会话不挂 workspace，dispose 即消失——见 S3）。

### 6.5 上下文注入

**（事实）** `setup` 可注册 agent-scoped prompt section：`agentCtx.systemPrompt.section({name, order, text})`（`packages/core/system-prompt/src/index.ts:476-493`）；order 可用 `getSectionOrder(...)` 或自定义有限数。persona 就是一段 section。

**（事实）** objective 走 `followup`（普通 user turn）或 `send`（指定目标）；注入诊断包路径是普通文本块，没有“路径参数”API。**（推断）** 路径是否可读只取决于目标 Agent 的 sandbox/read 策略；read-only 不拦读。

**（事实/内部形态）** 宿主没有 service 级消息工厂：`createUserMessage`/`createMessage` 是 `@deepseek-ai/dsh-llm` 的导出函数（`packages/llm/llm/src/message.ts:221-260`），本仓不能 import。因此 `followup` 的 `UserMessage` 只能按公开 JSON 结构自建 `{id, role:'user', content, source}`；`Session.append` 的校验只要求 id/role/source/content 形状（`packages/core/session/src/index.ts:334-357`）。这是内部形态，版本变化时以 S1 的实测 payload 为准。

**（事实）** 消息源 `source.kind` 是 merge-extensible 的（`packages/llm/llm/src/message.ts:110-136`）；插件可声明自己的 kind，但外部包不能 import 宿主类型。运行期只要求 lossless JSON；`user/message` 的 source.kind 只校验为非空字符串（`system`/`assistant`/`tool` 另有固定 kind）。**（建议）** 用户手写目标用 `kind: user`；插件生成的诊断路径/说明用单独的 notice/context 或 developer 消息，并在 UI 标明来源。

**（建议）** 组合顺序：
1. 先写诊断包（host 文件），拿到绝对路径。
2. `agents.create`（或浏览器 create）。
3. `setup` 里注册 persona section + 工具 allowlist；在 setup 内 append `sandbox/mode: read-only` + `approval/policy: never`（若 setup 不可用，则创建返回后立刻 append；host path）。
4. 再 `followup` 一条 **user** 消息：
   - 目标（手写，原文保留）；
   - 仓库绝对路径 + 工作空间说明；
   - 诊断包绝对路径 + “先读 manifest 再看 events”；
   - 授权边界（“只读；不要写文件；不要请求 escalation”）；
   - 期望输出（结论/证据/后续建议，不粘贴原文）。

**（事实/限制）** 在 `setup` 内 append `sandbox/mode`/`approval/policy` 是可行的：Session 在 setup 期间可写（`packages/core/agent/src/index.ts:104-114`）；permission-presets 的 `agent/created` 监听器会在发布时补齐缺失 knob（`packages/interaction/permission-presets/src/index.ts:233-235,429-457`），不会覆盖已写入的 sandbox；它可能补一个 `permission/preset`（若 knob 组合匹配 preset）或留 custom。**（未验证）** 该顺序在真机的 `agent/created` prepend 监听器下是否完全按预期；S3。

### 6.6 诊断包路径与交付

**（事实）** 没有“把路径传给 Agent”的宿主 API；路径就是 prompt/context 文本。没有“诊断包对象”API；包由插件生成。

**（建议）** 位置：
- `$DSH_HOME/reports/atelier/<bundleId>/diagnostic.json`（插件自建目录；不污染仓库；需确认 `$DSH_HOME` 可写，S5）。
- 或选定的 workspace 内 `.scratch/atelier/<bundleId>/diagnostic.json`（便于带外 Agent 在同一个 workspace-write 根下读写；但会进 git status，需 .gitignore）。
- 若带外 Agent 是 read-only，路径在 `$DSH_HOME` 也能读；若未来要 workspace-write 修改代码，bundle 放 workspace 内更省摩擦。

**（建议）** 包的权限：文件 0600；目录 0700；manifest 里记录 sha256；不要把内容写进 session 日志（否则诊断包本身又被导出）。

### 6.7 两条路径的选择

| 需求 | 宿主 `agents.create` | 浏览器 `sessions.create` |
|---|---|---|
| 父 Agent | 不需要 | 不需要 |
| 会话可见/可恢复 | live 期间列表可见；dispose 后消失；未挂 workspace | 可见、持久、可挂 workspace、可 resume |
| 工具白名单 | **可以**（setup restrict） | **不可以** |
| sandbox 预设 | 可以（setup append） | 需要 `/permission` 命令（异步、二次 RPC） |
| 审批 | 可 `never`（无人值守） | 默认 `ask`（用户在场） |
| 用户授权改代码 | 需要另建/改策略 | 用户可直接批 escalation/切 preset |
| 适用 | 面板内自动扫描、一次性顾问、隐私优先 | 用户可接管、可继续对话的顾问 |

**（建议）** 同一个“顾问”功能可以提供两档：默认“面板内只读扫描”（host path），用户点“接管/继续”时再开一个“用户可见会话”（browser path），把诊断包路径和摘要带过去。这样既满足“独立带外 Agent”，又满足“用户授权修改代码”。

## 7. 能力缺口与最小上游请求

### 7.1 缺口表

| ID | 缺口 | 证据 | 对本框架的影响 | 最小上游请求 | 优先级 |
|---|---|---|---|---|---|
| U1 | `llm/stream` 无 turn/step/attemptId；`agent/request` 对新增监听者废弃 | `packages/llm/llm/src/index.ts:75`；`packages/llm/llm/src/types.ts:564-606`；`packages/core/agent/src/runtime-types.ts:362-366` | 模型请求无法与 step/attempt 稳定关联；只能靠 step/start 猜测 | 给 loop-built `GenerateOptions` 加可选 `correlation: {turn, step, attemptId}`，或发一个非废弃的 `agent/model-request` emit 事件（仅元数据，不带 messages） | P0 |
| U2 | 无诊断包/脱敏/manifest API；只有全量 ZIP | `packages/session-query/session-log-export/src/archive.ts:1-22`；`packages/session-query/session-log-export/src/index.ts:173-234`；`packages/session/session-telemetry/src/index.ts:20-44,148-172` | 默认隐私不能直接用全量导出；插件只能自建 JSON | 提供一个 host `DiagnosticBundle` 服务/helper：manifest + 可选字段白名单 + 脱敏 hook + 字节上限；或给 `session-log-export` 加 `includeContent: false` | P0 |
| U3 | Session 无 durable workspaceId | `packages/core/session/src/types.ts:95-136`；`packages/workspace/workspace/src/types.ts:16,69-100` | 诊断包跨工作空间聚合只能靠 cwd；路径删除/移动即丢 | SessionHeader 增加可选 `workspaceId`（attach 时写），或提供 `sessionId -> workspaceId` 的 durable 读 API | P0 |
| U4 | 工具执行事件无 turn/step/开始时间 | `packages/core/tools/src/contracts.ts:174-234`；`packages/core/tools/src/batch.ts:243-266`；`packages/core/tools/src/executor.ts:44-47` | `tools/result` 不能单独定位到 turn/step，也不能直接算时长 | 在 batch 边界把 `log.turn`/`log.step` 和 `startedAt` 复制进 `ToolExecution`（可选字段，向后兼容） | P0 |
| U5 | `sessionTelemetry` 单 backend，已被 OTel 占用 | `packages/session/session-telemetry/src/index.ts:148-172`；`packages/bundle/base/cordis.patch.yml:218-232` | 本插件无法作为第二个本地 sink；只能自己监听 session/event | 允许注册附加 sink（`sessionTelemetry.addSink(local)`），或引入独立的 `diagnosticSink` 服务 key | P1 |
| U6 | 任意 key 的 `wire` 在类型上是 `never` | `packages/session/session-projection/src/index.ts:104-125,322-336` | 外部插件能做 host-only 投影，但难让浏览器直接读 wire | 允许 string-key 重载接受 `wire`（S2 验证 runtime 是否接受外部传入），或给外部插件一个“无类型 wire”注册入口 | P1 |
| U7 | `appendPluginRecord` 是实验/宿主 gate | `packages/core/session/src/index.ts:469-501` | 外部包不能把“召唤来源”写成稳定日志记录 | 为已安装 bundle 提供一个稳定的 plugin-record API，或官方扩展事件命名空间 | P2 |
| U8 | 带外 Agent 可见/所有权/dispose 语义无第三方文档 | `packages/core/agent/src/index.ts:146-163,410-435`；`packages/api/session-controller/src/index.ts:224-229` | 产品上“面板内 Agent 是否该出现在侧栏/能否冷读”不确定 | 文档化 `agents.create` 的第三方用法；或提供 `visibility: panel 或 session`/`attachToWorkspace` 选项 | P2 |
| U9 | 成功模型请求无 provider requestId | `packages/llm/llm/src/types.ts:48-66`（只在 failure） | 用户排障时无法拿成功请求的 provider id 对账 | 让 adapter 在 `assistant/message.source`/`assistant/attempt` 里记录可选 requestId | P1 |
| U10 | 浏览器 `remote.session.follow` 只对核心 UI 公开，未声明为第三方 client 面 | `packages/api/session-controller/src/index.ts:553-556,609-612` | 第三方 client bundle 的可用性靠结构读取，缺文档/类型 | 文档化 `ctx.remote.session` 的 client contract，或加一个 `ctx.sessions.follow` 包装 | P2 |

### 7.2 最小请求集（只提 4 条）

**如果只能提 4 条**：U1（模型请求关联）、U4（工具 turn/step/时长）、U3（workspaceId）、U2（诊断包/脱敏）。这四条直接决定“能不能在不复制原文的情况下，把一次故障关联到会话/步/工具/模型请求，并形成一个可交给带外 Agent 的本地包”。其余可延后。

### 7.3 不该请求的

- 不要请求“默认记录 prompt/回复/工具参数/结果”——这与地图的本地优先/隐私默认冲突。
- 不要请求“远程遥测平台”或“自动上传”。
- 不要请求“修改宿主内部实现”来伪造 turn/step；U1/U4 是加字段，不是改语义。
- 不要请求“全局 session 排序”；跨会话按 time + sessionId + seq 足够。

## 8. 对本插件适配接缝的建议

### 8.1 分层与行

**（建议）** 新增一个宿主行（或扩展现有 core 行），不要塞进 `ui-host` 的 HTTP 行：
- 行 id：`agent-atelier-observe`；`inject: [webServer, agentControl, sessionProjections]`，在 apply 内按需 `ctx.get` `agents`、`sessionQuery`、`storageDomain`（lifecycle 顺序不保证，按本仓惯例在**使用点**解析）。
- 提供 plain-object 服务 `agentObservability`（`ctx.provide`，不进 Service 目录；harness-facts 已记录 plain object 可被 `inject` 消费）。
- 路由命名空间：`/agent-atelier/observability/*`，继续用 `x-dsh-agent-atelier: 1` + `connection.requestRejection` + body 上限（复用 `src/dsh/host/ui-host.ts:49-70`、`src/dsh/host/wire.ts:58` 的模式）。
- **不要**占用已占用的 service key：`agents`、`sessions`、`storage`、`tools`、`subagents`、`sessionProjections`、`sessionTelemetry`（harness-facts:18 列了前一批；本报告新增确认 `sessionProjections` 与 `sessionTelemetry` 也被宿主占用）。

**（事实）** 本仓现有宿主行只 inject `webServer`/`agentControl`（`cordis.patch.yml:23-27`）；core 行提供自有服务（`src/dsh/host/core.ts:29-90`）。扩展点就在这里，不需要改 `src/` 之外。

### 8.2 采集面

**（建议）** 宿主 root 订阅（全部 root-scope，收到所有 Agent/Session）：
- 生命周期：`session/created`、`session/disposed`、`agent/created`、`agent/disposed`、`agent/status`。
- turn/step：`session/event` 过滤 `turn/start`、`step/start`、`turn/end`、`step/end`（只取元数据）。
- 工具：`session/event` 的 `tool/call`/`tool/result`（补 turn/step/时长）+ `tools/result`（补 exec 字段，可选）。
- 模型：`session/event` 的 `request/header`/`request/context`、`agent/assistant-stream`（attemptId/turn/step/finish 码）、`llm/stream`（仅在 S1 证明 scope 可达后；否则不依赖）。
- 召唤：`subagent/start`、`subagent/end`（只取 runId/parentSessionId/id/provider/stopReason；不取 lastAssistantMessage）。
- 错误：`turn/end.reason.error`（R2 的 LlmFailure）+ `agent/error`（只取 name/message 截断）+ `api-session/error` 不需要（宿主已有）。

**（建议）** 用一张“事件白名单表”驱动过滤：每个事件类型只允许列出的字段；其余字段在归一化时丢弃。这样避免以后宿主加字段时意外入库。

### 8.3 关联索引与存储

**（建议）** 内存索引（不持久，重启可从 session 事件重建）：
- `sessionId -> {agentName?, workspacePath, workspaceId?, parentSessionId?, lastTurn, lastStep, lastErrorCode?, lastActivityAt}`
- `callId + sessionId -> {turn, step, name, startedAt}`
- `attemptId -> {sessionId, turn, step}`（来自 assistant-stream start）
- `runId -> {parentSessionId, childSessionId, provider, startedAt}`（来自 subagent/start）

**（建议）** 持久层二选一：
- **首选**：host-only projection `atelierDiagnostics`（5.2），每 session 一份 state；有界、重启后由 projection cache 恢复；浏览器通过本插件 route 读。
- **补充**：`storageDomain` 的 `atelier_diag` 域，存跨 session 的“诊断包索引/最近 N 个 bundle”这类不按 session 走的数据；不要存事件原文。

**（建议）** 所有数组/字符串在 `apply` 内截断；为 projection state 定一个“最大 JSON 字节”并在测试里用大 payload 压。

### 8.4 面板与跳转

**（建议）** 沿用本仓现有主面板 `agent-atelier`，把“顾问”作为**面板内一级页签**：
- `src/dsh/client/page.tsx:134-135` 的 `PanelTab` 加 `advisor`；视图与编辑器共享一个模块级 store；不新开 sidebar 行。
- 编辑器 -> 顾问：写 store 的 `selectedAgentName`/`workspaceCwd` + `setTab('advisor')`。
- 顾问 -> 会话：`ctx.get('uiWorkspace').openSession(sessionId)`（B4）；顾问 -> 某 turn：保留 `turn/start` seq，用 `session.loadThrough(seq)`（`packages/api/session-controller/src/client/contract/session.ts:146-151`）再定位。
- 如果产品最终要求“顾问是全局一级主选项卡”：再加 `sidebar.panellist` + `main` 的第二个 id；用 `ctx.layout.selectPanel` 跳；这两座都是公开契约，不需要宿主改动（B6/B7）。
- **不要**找“编辑器 slot”；不存在；也不要给 `main` 塞导航 payload（B7 没有 payload）。

### 8.5 诊断包

**（建议）** 宿主 route 生成，浏览器只下载/展示：
- `/agent-atelier/observability/bundle` POST：请求 `{cwd, sessionId?, agentName?, includeFull?: boolean}`；返回 `{path, manifest, bytes, truncated}`。
- 生成器从 8.2 的元数据 + 8.3 的索引 + `sessionQuery.readSession`/`traceSession`（H15）读结构，按 5.5 的 schema 写 JSON；不读 `content/arguments/message` 字段。
- 默认不调用 `/api/session.export`；只有用户点“全量导出”才给这个链接。
- 包路径写进 `manifest.path` 并返回给浏览器；带外 Agent 的 objective 直接引用该绝对路径。
- **（建议）** 包内附 `redaction` 说明（哪些字段被丢弃）、`truncated` 标记、`sourceRevisions`（DSH commit/版本/插件版本）。

### 8.6 带外顾问

**（建议）** 双档：
1. 面板内“扫描”按钮 -> 宿主 `agents.create`（6.1）：setup 里 section persona + `tools.restrict` allowlist + append `sandbox/mode: read-only` + `approval/policy: never`（若 setup 不允许 append，则在 create 后、`followup` 前 append）；`followup` 目标 + 包路径；`whenIdle` 后读 session 事件摘要；`dispose` 前导出 transcript 到包目录。
2. 用户点“接管” -> 浏览器 `ctx.sessions.create`（6.3）：`/permission read-only` 后 prompt 目标 + 包路径；用 `ctx.uiWorkspace.openSession` 显示；用户后续批 escalation/切 preset 时，插件记录授权事件。

**（建议）** 两条路径共用同一个“目标模板”和同一个“诊断包 manifest”，只是边界不同；不要把宿主路径的 allowlist 误当成浏览器路径也生效。

### 8.7 隐私与测试

- 单测：字段白名单/归一化/截断/redaction；用真实事件形状（从 R2 的 payload 与 fixtures 抄），不要只测自造对象。
- 集成：fake `sessionProjections`/`agents`/`tools` 服务，断言 root 监听、scope、顺序、失败隔离；不要在测试里 import 宿主包。
- 真机：S1-S5；每个 spike 都记录“事件数量/字节数/耗时/失败码”，作为有界参数依据。
- 隐私：默认关闭原文；提供“诊断详情”按需读取；日志里不打 path 以外的内容；诊断包 0600。
- 兼容：把所有宿主形状集中到一个 `host-facts.ts`（本仓已有先例），按 S1-S5 的实测结果更新；不要在业务代码里散落 `ctx.get` 形状断言。

### 8.8 不做什么

- 不 import `@deepseek-ai/*`（ADR-0001）；只用结构读取。
- 不把 `agent/request` 作为新监听点；用 `step/start`/`assistant-stream`。
- 不把 `plugin:` 记录当稳定契约；若用，标记为“可丢”。
- 不把全量 ZIP 当默认诊断包；不做自动上传。
- 不给“编辑器”造宿主 slot；不修改 `main` 的宿主契约。

## 9. 未验证项与后续 spike

### 9.1 未验证项

| ID | 未验证 | 为什么未验证 | 影响 | 验证方式 |
|---|---|---|---|---|
| V1 | root-scope 监听 `llm/stream` 是否收到 | R2 残留 6；未做真机 | 若收不到，U1 的桥只能靠 `assistant-stream`，模型请求关联更弱 | S1：注册 root listener，跑一次普通 turn，记录是否触发 |
| V2 | `session/event` `tool/call` 一定早于 `tools/result` | 源码顺序如此，但未真机 | 关联桥可能错位 | S1：同时注册两个监听，记录 callId 与顺序 |
| V3 | `agents.create` 的 setup 内 append `sandbox/mode`/`approval/policy` 是否被 `agent/created` 的 prepend 监听器覆盖 | 只读源码 | 只读边界可能失效 | S3：创建后读 session 事件/策略投影，跑一次写工具看是否 deny |
| V4 | `tools.restrict` 对 PTC `run_code` 嵌套调度是否生效 | JSDoc 只说不能 restrict `run_code` 本身，嵌套 scope 传播未见测试 | 只读顾问可能通过 run_code 调用被 allowlist/deny 的 end-capability 工具 | S3：allowlist 只含 read/grep/glob，让 Agent 用 run_code 内嵌调用 bash/write，确认被拒；再测 deny 一个具体工具 |
| V5 | 外部 bundle 注册 host-only projection 是否稳定（key 任意） | runtime 允许，未真机 | 存储方案可能失败 | S2：注册 `atelierProbe`，跑 turn/end 后 `stateOf`；重启后读 cache |
| V6 | 浏览器 `remote.session.follow` 对第三方 client bundle 可用 | 源码是 @Remote，未第三方真机 | 面板实时流可能只能靠自己的 host route | S4：client bundle 里 `ctx.get('remote').session.follow`，观察 ready/事件/assistant 帧 |
| V7 | `SessionReferenceSource` 是否接受插件自定义 label | 类型是 merge-extensible，运行时未见校验 | 浏览器路径可能只能借用 `gateway`/`controllerOperation` | S4：retain 传 `agent-atelier`，看是否报错 |
| V8 | `agents.create` 会话 dispose 后是否仍可冷读/是否出现在列表 | 源码只说移出 store | 面板内顾问的 transcript 可能丢失 | S3：创建→跑→dispose→查 session list/sessionQuery/persistence |
| V9 | `session-query` 在 base `openAt: never` 下精确读是否仍可用 | base 注释说可以，未真机 | 诊断包冷读可能失败 | S5：对 cold session 调 `readSession`/`traceSession` |
| V10 | `session-log-export` 在远程 peer 上的授权语义 | 源码无 `remoteAccess` 检查 | 全量导出可能被非 owner 访问 | S6：两台客户端，非 owner 试 GET；看 401/403/200 |
| V11 | 投影 cache 对新增 host-only unit 的 checkpoint 频率/大小 | 源码说 every unit，未真机 | 有界存储的实际写放大未知 | S2：注册计数器，观察 200 事件/5 秒与 turn/end 写入 |
| V12 | `agent/created` 监听器是否允许 setup append 后不补 `permission/preset` | 源码推导，未真机 | 策略投影可能出现 custom/不一致 | S3：读 `permissions` 投影/事件序列 |

### 9.2 Spike 清单

**S1：宿主事件探针（P0）**
- 一次性 host 行（或临时测试 harness）注册 root 监听：`session/event`、`agent/status`、`tools/result`、`agent/assistant-stream`、`llm/stream`（try/catch 记录是否收到）。
- 跑一次普通 turn：一次成功模型调用、一次工具调用、一次失败（可用 mock adapter/断网）。
- 记录：事件顺序、scope、payload 字段、turn/step/callId/attemptId 对应、字节数、是否出现 call->result 倒序。
- 产出：V1/V2 结论；本插件事件白名单表。

**S2：关联/投影探针（P0）**
- 注册 host-only projection `atelierProbe`，fold 计数 + last code + 最近 5 条元数据；在测试里用真实 session 事件。
- 读 `stateOf`；重启/恢复后读 cache；观察写放大。
- 同时验证“step/start -> llm/stream”桥；记录成功率（辅助调用干扰）。
- 产出：V5/V11 结论；投影 schema/上限参数。

**S3：带外宿主 Agent 探针（P0）**
- `agents.create`，cwd=临时目录，setup 注册 persona section + allowlist（只含 read/grep/glob；不含 bash/write/edit；不命名 run_code，restrict 会拒绝）；setup 内 append read-only + never（失败则 create 后、prompt 前 append）；`followup` “读 X 报告并总结”。
- 跑一次写文件工具，确认 deny；跑一次 run_code 嵌套写，记录 V4；读 session 事件确认策略；dispose 后查列表/冷读（V8）。
- 产出：V3/V4/V8/V12 结论；只读边界的最小可行组合。

**S4：浏览器 follow/跳转探针（P1）**
- client bundle 里 `ctx.get('remote').session.follow(address, assistantStream:true)`，对一个运行中的 session；记录 ready/snapshot/event/assistant 帧。
- `ctx.get('layout').selectPanel('agent-atelier')`；`ctx.get('uiWorkspace').openSession(id)`；retain source 自定义 label（V7）。
- 产出：V6/V7；浏览器侧可用事件集。

**S5：诊断包探针（P0）**
- 用 `sessionQuery.readSession` + `traceSession` + `atelierProbe` 状态生成 metadata-only JSON；校验无 `content/arguments/message` 字段；测 1k/10k 事件的字节与耗时；cold session 读（V9）。
- 产出：包 schema/上限/截断策略。

**S6：全量导出与 telemetry 探针（P1）**
- `/api/session.export` 本地/远程两种连接；检查 ZIP 内容、子代理、附件、无脱敏；非 owner 是否可访问（V10）。
- `sessionTelemetry` 是否可加第二个 backend（预期不能）；记录错误码。
- 产出：导出授权/隐私结论。

### 9.3 停止条件与失败回退

- 若 V1 失败（root 收不到 `llm/stream`）：放弃“llm/stream 桥”，只用 `assistant-stream` + `step/start`；U1 保持 P0，并补充“scope 不可达”的证据。
- 若 V3 失败（setup append 被覆盖）：host 路径改为 create 后、prompt 前 append；若仍有竞态，改用浏览器路径（命令先于 prompt）。
- 若 V4 失败（PTC 绕过 allowlist）：不能通过 `restrict` 命名 `run_code`；替代方案是 deployment 不启用 PTC executor，或只让 allowlist 含 end-capability 工具并接受“run_code 始终可能被模型看到”的风险；记为 profile 级风险。
- 若 V5 失败（外部投影不可注册）：退回 storage domain 或自有 JSON 文件；不依赖 projection cache。
- 若 V6 失败（第三方 client 不能 follow）：面板改用本插件自己的 host route + SSE/轮询；不改宿主。
- 若 V10 失败（非 owner 可导出）：在插件文档中把全量导出标为“仅本机 owner”；不自动暴露链接。

### 9.4 本报告的边界

- 本文没有运行任何宿主代码、没有改 profile、没有触发工具/模型调用；所有“限制”都是源码/文档事实或明确标注的推断。
- 失败码分类、重试判断、`next()` 返回值语义直接复用 R2-obs（#34），不在此重复。


