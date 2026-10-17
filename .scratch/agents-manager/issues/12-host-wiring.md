# 12 — 接线：宿主 HTTP 通道与双适配器（去掉 fixtures）

Status: ready-for-agent
Type: task
Blocked by: 11

## 背景

11 冻结核心接口；本票把它接到真实宿主与真实文件：宿主侧 exact route（05 票 Q3-A 裁决的通道 A），client 侧 fetch 适配器，删除 fixtures 直连。

原型证据（为什么必须有这一步）：`App.tsx` 行 49–53 直接 import fixtures 当数据源，行 102 `useMemo(composeDocument)` 在客户端做组合，行 66–68 用三个内存 map（`agentOverrides` / `clipOverrides` / `savedFiles`）冒充磁盘，行 297 的 `invalidate()` 只写日志，行 298–306 的「外部手改」直接改内存——全链路没有 fetch、没有 async、没有 loading/error。合成本身是**宿主知识**（clip 是否独立成文件尚未裁决），客户端不该拥有切片解析与按 kind 分文件的写路由。

## 范围

1. **wire 契约（冻结）**：请求/响应形状 = 11 核心接口的投影，另加错误体与请求上限。草案（实现期定稿）：
   - `GET  /agents-manager/state?cwd=…` → 四类数据 ＋ 归一化 findings ＋ diagnostics
   - `POST /agents-manager/compose` `{ agentName }` → 组合文档（域形状）
   - `POST /agents-manager/plan` `{ edits[] }` → 写入计划 ＋ 逐条拒绝原因（**只读，不落盘**，供 UI 预览「将要写哪些文件」）
   - `POST /agents-manager/commit` `{ edits[] }` → 逐文件写入结果（原子落盘）
   - `POST /agents-manager/registry` `{ edit }` → registry 写结果（判别联合与 11 一致）
   - `POST /agents-manager/invalidate` → 重读（D24；无 watcher）
   上限：请求体大小、单次 edits 数量；响应里带 `cwd` 与扫描代号，防串台。
2. **宿主侧**：`ctx.webServer` exact route（05 Q3-A）；handler 只做「校验入参 → 调 11 的核心 → 序列化结果」，不重复领域规则；读走 `ctx.agentRegistry`（`src/types.ts:112`）与 `ctx.aliasRegistry`（`src/types.ts:219`）；`@deepseek-ai/*` 一律不 import（ADR-0001）。
3. **client 侧**：fetch 适配器实现与内存适配器**同一接口**；`settings.section` 整页注册（05 brief 的双面面包：`dsh.client` ＋ `exports['./client']` ＋ 构建产物）；页面加载/失败/重试状态。
4. **错误语义**（逐条有测试或手测记录）：
   - `400` — 逐条 edit 的拒绝原因（未知块、跨 agent 块、缺片引用、字段越界）
   - `404` — 未知 agent / clip / model / alias
   - `409` — 被 home patch 或命令行 overlay 覆盖（文案与 config-editor 一致：`Configuration for "<id>" is overridden by a home patch or command-line overlay`）
   - `5xx` — 宿主内部失败；客户端保留草稿、可重试
   - 全部支持 `AbortSignal` 取消（切换 agent/页签时取消在途请求）
5. **去掉 fixtures**：组件不再 import fixtures；fixtures 降级为 `test/` 的固定数据（内存适配器用）。
6. **行为对齐清单（逐条勾，与原型对照）**：列表查询（筛选/排序/搜索字段）、编辑器分块保存与回退、切片遮蔽标注、registry 层合并（工作区/用户/合并）、别名重映射即时影响、findings 三族呈现、`invalidate` 后反映外部手改、未保存改动切换 agent 的行为、`plan` 预览与实际写入一致。
7. **Desktop 兼容**：浏览器直连 route 要通；Desktop 经 `forwardWebRequest` 转发任意 pathname 并带 host cookie（05 票已核实）。

## 验收

- [ ] wire 契约冻结并回写 `## 契约（冻结）`；host 与 client 两侧都按它实现（无第三份形状）
- [ ] 真机：`install_bundle` 后页面出现，`GET state` 有数据（真机验证走 loader entry，见 `docs/agents/harness-facts.md`）
- [ ] 编辑落盘：写真实 `agent.md` / `sections/*.md` / `registry.yaml`；原子写（temp ＋ rename，`0600`）；注释与未知键保留（D14）
- [ ] 手改文件后 `invalidate` → UI 反映；无 watcher（与 01/02 一致）
- [ ] 四类错误路径各有可复现记录；在途请求可取消
- [ ] 组件不再 import fixtures；`pnpm run check` 全绿
- [ ] 行为对齐清单逐条勾完

## 已知约束

- **复用现成 wire 形状**：写入结果用原型已经定过的 `FileWrite` 形状（`prototype/settings-ui/src/types.ts` 的 `FileWrite` ＋ `model.ts` 的 `saveWrites` 语义），别新造第二套；`plan` 返回的每文件 `content` 让客户端不必知道块→文件路由。
- **两个必删项（否则两份真相）**：① UI 侧的层合并重算（原型 `model.ts` 行 137–148）——宿主 `ctx.aliasRegistry.getAlias` / `getModel`（`src/types.ts:219`）已解析层；② 客户端按 `block.kind` 的写路由（原型 `App.tsx` 行 135–149）——改由宿主 `plan`/`commit` 决定。
- **键对齐**：原型的 `clip-${name}` 存储编码（`ClipLibrary.tsx` 行 69 与 `model.ts` 行 245）要与 route 的路径/键约定统一（见 11 票的 `EntityKey` seam）。
- **不新建 Remote 命名空间**（strict codec ＋ Typert monorepo 布局缺口，05 票 out of scope）；只用 `ctx.webServer` exact route ＋ client fetch。宿主读面已 provide 但 **HTTP 投影不存在**（`cordis_inspect_query` 读不到 plain-object service，见 `docs/agents/harness-facts.md`）⇒ 本票第一件产物是宿主 side route，不是改 UI。
- 依赖归置：client 第三方库走 bundle 内容（tsdown 内联／shell platform 表），与宿主共享实例的 dsh 包走 peer ＋ dev；沙箱内不改依赖（敏感操作，见 `docs/agents/harness-facts.md`）。
- 插件专用路径前缀与冲突策略（若与 DSH 其他设置页路由同前缀）在实现期确认。
- 本票不改 01/02 的读面契约；不改 11 的核心接口（要改先回 11 改契约）。

## Comments

- 来源：`/codebase-design` 分析（2026-10-17，AI）；05 票 Q3-A 通道定案 ＋ 11 票核心接口。
- 参考实现：分支 `proto/settings-ui`（throwaway）；其中 `App.tsx` 的接线改动面清单已在 11 票记录。
