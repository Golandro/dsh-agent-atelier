# 12 — 接线：宿主 HTTP 通道与双适配器（去掉 fixtures）

Status: resolved
Type: task
Blocked by: 11

## 背景

11 冻结核心接口；本票把它接到真实宿主与真实文件：宿主侧 exact route（05 票 Q3-A 裁决的通道 A），client 侧 fetch 适配器，删除 fixtures 直连。

原型证据（为什么必须有这一步）：`App.tsx` 行 49–53 直接 import fixtures 当数据源，行 102 `useMemo(composeDocument)` 在客户端做组合，行 66–68 用三个内存 map（`agentOverrides` / `clipOverrides` / `savedFiles`）冒充磁盘，行 297 的 `invalidate()` 只写日志，行 298–306 的「外部手改」直接改内存——全链路没有 fetch、没有 async、没有 loading/error。合成本身是**宿主知识**（v1 裁决：无切片，见 11 票），客户端不该拥有切片解析与按 kind 分文件的写路由。

## 范围

1. **wire 契约（冻结）**：请求/响应形状 = 11 核心接口的投影，另加错误体与请求上限。草案（实现期定稿）：
   - `GET  /agents-manager/state?cwd=…` → 四类数据 ＋ 归一化 findings ＋ diagnostics
   - `POST /agents-manager/compose` `{ agentName }` → 组合文档（域形状）
   - `POST /agents-manager/plan` `{ edits[] }` → 写入计划 ＋ 逐条拒绝原因（**只读，不落盘**，供 UI 预览「将要写哪些文件」）
   - `POST /agents-manager/commit` `{ edits[] }` → 逐文件写入结果（原子落盘）
   - `POST /agents-manager/registry` `{ edit }` → registry 写结果（判别联合与 11 一致）
   - `POST /agents-manager/invalidate` → 重读（D24；无 watcher）
   上限：请求体大小、单次 edits 数量；响应里带 `cwd` 与扫描代号，防串台。
2. **宿主侧**：`ctx.webServer` exact route（05 Q3-A）；handler 只做「校验入参 → 调 11 的核心 → 序列化结果」，不重复领域规则；读走 `ctx.agentRegistry`（`src/contract/types.ts:117`）与 `ctx.aliasRegistry`（`src/contract/types.ts:224`）；`@deepseek-ai/*` 一律不 import（ADR-0001）。
3. **client 侧**：fetch 适配器实现与内存适配器**同一接口**；`settings.section` 整页注册（05 brief 的双面面包：`dsh.client` ＋ `exports['./client']` ＋ 构建产物）；页面加载/失败/重试状态。
4. **错误语义**（逐条有测试或手测记录）：
   - `400` — 逐条 edit 的拒绝原因（未知块、跨 agent 块、字段越界）
   - `404` — 未知 agent / model / alias
   - `409` — 被 home patch 或命令行 overlay 覆盖（文案与 config-editor 一致：`Configuration for "<id>" is overridden by a home patch or command-line overlay`）
   - `5xx` — 宿主内部失败；客户端保留草稿、可重试
   - 全部支持 `AbortSignal` 取消（切换 agent/页签时取消在途请求）
5. **去掉 fixtures**：组件不再 import fixtures；fixtures 降级为 `test/` 的固定数据（内存适配器用）。
6. **行为对齐清单（逐条勾，与原型对照）**：列表查询（筛选/排序/搜索字段）、编辑器分块保存与回退、registry 层合并（工作区/用户/合并）、别名重映射即时影响、findings 三族呈现、`invalidate` 后反映外部手改、未保存改动切换 agent 的行为、`plan` 预览与实际写入一致。
7. **Desktop 兼容**：浏览器直连 route 要通；Desktop 经 `forwardWebRequest` 转发任意 pathname 并带 host cookie（05 票已核实）。

## 验收

- [x] wire 契约冻结并回写 `## 契约（冻结）`；host 与 client 两侧都按它实现（无第三份形状）
- [x] 真机：`install_bundle` 后页面出现，`GET state` 有数据（真机验证走 loader entry，见 `docs/agents/harness-facts.md`）——三行 `application: applied`、`GET state` 200 真实数据、client bundle 进 boot 图并 200 送达；页面视觉确认待浏览器刷新一次（机制链路已全部实证）
- [x] 编辑落盘：写真实 `agent.md` / `registry.yaml`（v1 无切片，不写 `sections/*.md`）；原子写（temp ＋ rename，`0600`）；注释与未知键保留（D14）——同值 `commit` 真机 200 往返、git 干净；注释/未知键保留由 11 的往返单测覆盖
- [x] 手改文件后 `invalidate` → UI 反映；无 watcher（与 01/02 一致）——真机 `probe-agent` 外部手改实证；页面 Reload 按钮消费同一 route
- [x] 四类错误路径各有可复现记录；在途请求可取消——真机实测 403/404/405/415/400/200；409/413/499/500 单测（`test/host-wiring.test.ts`）＋ abort parity（`test/control-client.test.ts`）
- [x] 组件不再 import fixtures；`pnpm run check` 全绿——`src/` 零 fixtures 引用；171 测试 / 14 文件
- [x] 行为对齐清单逐条勾完——**改判（Q6=A 已裁决）**：清单条目是 UI 行为，归 05 消费（05 已 `Blocked by: 11, 12`，两票 resolved 后解锁）；本票 wire 对每项行为都有对应 route/plan/commit 语义，05 消费时逐条勾

## 已知约束

- **复用现成 wire 形状**：写入结果用原型已经定过的 `FileWrite` 形状（`prototype/settings-ui/src/types.ts` 的 `FileWrite` ＋ `model.ts` 的 `saveWrites` 语义），别新造第二套；`plan` 返回的每文件 `content` 让客户端不必知道块→文件路由。
- **两个必删项（否则两份真相）**：① UI 侧的层合并重算（原型 `model.ts` 行 137–148）——宿主 `ctx.aliasRegistry.getAlias` / `getModel`（`src/contract/types.ts:224`）已解析层；② 客户端按 `block.kind` 的写路由（原型 `App.tsx` 行 135–149）——改由宿主 `plan`/`commit` 决定。
- **键对齐**：v1 无切片，原型的 `clip-${name}` 存储编码不进 route；`EntityKey` seam 只保留 entry / registry 键（见 11 票）。
- **不新建 Remote 命名空间**（strict codec ＋ Typert monorepo 布局缺口，05 票 out of scope）；只用 `ctx.webServer` exact route ＋ client fetch。宿主读面已 provide 但 **HTTP 投影不存在**（`cordis_inspect_query` 读不到 plain-object service，见 `docs/agents/harness-facts.md`）⇒ 本票第一件产物是宿主 side route，不是改 UI。
- 依赖归置：client 第三方库走 bundle 内容（tsdown 内联／shell platform 表），与宿主共享实例的 dsh 包走 peer ＋ dev；沙箱内不改依赖（敏感操作，见 `docs/agents/harness-facts.md`）。
- 插件专用路径前缀与冲突策略（若与 DSH 其他设置页路由同前缀）在实现期确认。
- 本票不改 01/02 的读面契约；不改 11 的核心接口（要改先回 11 改契约）。

## 契约（冻结）

2026-10-19 实施完成时冻结。线路形状 = 11 核心接口的 HTTP 投影 ＋ 错误体；实现：`src/dsh/host/wire.ts`（纯派发器）、`src/dsh/host/ui-host.ts`（传输适配）、`src/control/http-client.ts`（client 侧同形状）。

### 路由（六条 exact route，挂 `ctx.webServer`）

- `GET  /agents-manager/state?cwd=…` → `200 {cwd, scanId, snapshot}`
- `POST /agents-manager/compose` `{agentName, cwd?}` → `200 {cwd, document}`；未知 agent → `404 not-found`
- `POST /agents-manager/plan` `{edits[], cwd?}` → `200 {cwd, plan}`（只读预览，不落盘）
- `POST /agents-manager/commit` `{edits[], cwd?}` → `200 {cwd, report}`；任一 edit 被拒 → `400 edit-rejected ＋ rejections`（不写任何文件）
- `POST /agents-manager/registry` `{edit, cwd?}` → `200 {cwd, report}`；`404 not-found` / `409 conflict` / `read-only` 按 11 报告映射
- `POST /agents-manager/invalidate` → `200 {ok:true, scanId}`

### 错误面（统一 `{error:{code,message}, …}` JSON）

`400 invalid-request|edit-rejected`、`403 forbidden`（变更缺 marker）、`404 not-found`、`405 method-not-allowed`、`409 conflict`、`413 payload-too-large`、`415 unsupported-media-type`、`499 aborted`、`500 internal`；401 归宿主连接层（`connection.requestRejection`）。

### 传输约定

- 变更请求（非 state）必须带 `x-dsh-agents-manager: 1` ＋ `content-type: application/json`；读免 marker（CSRF 纵深：跨站表单伪造不了自定义头）。
- 上限：body 1 MiB、edits ≤ 200、agentName ≤ 128、文本 ≤ 512 KiB、字段值 ≤ 64 KiB、字段项 ≤ 64、cwd ≤ 4096；cwd 须绝对路径。
- `scanId` 每请求单调并回显；`res.close` → AbortController → `499`；handler throw → 500（宿主 webServer 无自带 auth/body 上限/AbortSignal）。
- client 适配器 `createHttpControlClient({baseUrl?, cwd?, fetchImpl?, headers?})` 与 `createMemoryControlClient(core)` 共享 `ControlClient` 六成员接口（`src/control/client.ts`）。

## Answer（2026-10-19）

**交付面**：
- wire 派发器 `src/dsh/host/wire.ts`（校验 → 11 核心 → 序列化，纯函数可单测）；传输适配 `src/dsh/host/ui-host.ts`（六条 exact route、`connection.requestRejection` 源站栅栏、有界 body、close→abort）；ui-host 行进 `cordis.patch.yml`（**裸包名行**，`config.role: ui-host`——client-modules 只扫裸包名行）。
- client 侧：`ControlClient` 六成员接口 ＋ `createMemoryControlClient` / `createHttpControlClient`（Node-free）；`settings.section` 页面注册（id `agents-manager`、order 40，加载/失败/重试/重载 shell）；`lib/client.js` 由 `scripts/build-client.mjs` 生成（tsc transpile ＋ CJS factory 包裹，零新依赖，react 平台 require）。
- fixtures 全部移出 `src/`（grep 零命中）；测试数据内联。
- 守卫：check.mjs 增 `dsh/client` 层与两个新公共入口；**171 测试 / 14 文件全绿**。

**实施期修正（宿主真机抓到）**：loader 以 `apply(ctx, config)` 调用行入口——providers 行旧写法 `export const apply = applyProviders`（第二参数＝实例移交）把行配置 `{}` 误当服务实例 → `apiVersion undefined` 激活失败。修正：行入口专用化 `apply(ctx, _config?)` ＋ `isAgentProviders` 形状校验双保险；测试 `providerRow()` 改挂真实入口并补 `plugin(row, {})` 回归（cordis 无 config 传 `undefined`，单测此前不暴露；诊断记录：plugin_manager enable 返回的 `diagnostic` 直接点名了抛错行）。

**真机验证（2026-10-19 全部实测）**：
- enable → `application: applied`、`warnings: []`（HMR required 语义下三行同 active；上次失败时 warnings 点名 `agents-manager-provider-fs`，对照成立）。**顺带补上 18 票欠账**：三行形态真机复验完成。
- `GET state` → 200 真实数据（bundled `default`「默认」、模型 `dsh-default`、别名、诊断）；`scanId` 单调。
- 变更栅栏：无 marker → 403；非 JSON → 415；GET 打 POST 路由 → 405；未知 agent → 404；坏字段 → 400。
- 同值 `commit` → 200 原子写报告，git 干净；外部手改 `.dsh/agents/probe-agent/` → `invalidate` → state 出现 `probe-agent`（project-dsh）→ 删除后消失。
- client bundle 进 boot 图（`dsh-plugin-agents-manager/client.js` ＋ rev），经 `plugins/??…&rev=…` 200 送达，内容 = `lib/client.js` ＋ 服务端追加的 sourcemap 行。
- 认证：GUI 全局 401（launch token 换签名 cookie）；服务端验证用凭证库 `client-connection/browser-session` 复刻握手（做法已记 harness-facts）。

**票面过期项（就地修正或改判）**：已知约束「复用原型 `FileWrite`」被 11 的 `WritePlan {file, content, blockIds, baseText}` 取代（伪造 `lines` 被 11 明令禁止）；`types.ts:112/219` 锚点实为 `:117/:224`（已修正）。**遗留**：页面 cwd 默认宿主进程 cwd，浏览器工作区上下文接线归 05；inspect 工具本会话 `input` 参数缺陷使 slot 占用者无法自动确认（harness-facts 有记），视觉确认待刷新。

## Comments

- 来源：`/codebase-design` 分析（2026-10-17，AI）；05 票 Q3-A 通道定案 ＋ 11 票核心接口。
- 参考实现：分支 `proto/settings-ui`（throwaway）；其中 `App.tsx` 的接线改动面清单已在 11 票记录。
- 2026-10-18 Q6 裁决：写器归 11、通道归本票；05 改为指针 + `Blocked by: 11, 12`，只消费本票的 wire 契约。
