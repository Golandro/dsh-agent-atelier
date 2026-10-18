# 16 — Core 机械分层与 import 矩阵（P1）

Status: ready-for-agent
Type: task
Blocked by: —

## 背景

`docs/core-design.md` 的 P1。维护者裁决（2026-10-18）：Q3=A（先落机械分层）、Q4=A（v1 单包多插件行）、Q5=B（P2 用 `@deepseek-ai/cordis` 的 `Service` 基类）。本票只做**行为零变化**的落位与守卫；服务行、provider 注册表、`Service` 包装都在 P2，不在本票。

## 范围

1. 建立 `contract/`、`core/`、`providers/`、`dsh/` 四层，把 01/02 的现有模块搬进去：
   - `src/types.ts` → `contract/`；
   - discovery / frontmatter / registry / alias-registry / registry-file / roots / lazy-load / yaml-scalar → `core/catalog/`（按内聚放置，不拆语义）；
   - `AgentFileSystem` 端口类型 → `core/`；Node fs / host fs 适配器 → `providers/fs/`；
   - `optionalFileSystem(ctx)` 的结构读取 → `dsh/host/`；
   - `src/index.ts` 保持为兼容入口（re-export `apply` 与服务 key 常量），`package.json` 的 `main` / `exports` 不变。
2. 拆分 `src/file-system.ts` 的端口与两个适配器；`core` 不 import `node:fs`，只依赖端口类型；`providers` 不 import `dsh`。
3. `scripts/check.mjs` 增加 import 矩阵判定 ＋ 自测：
   - 跨层只准公共入口（`index.ts` / 显式列出的子入口）；
   - `@deepseek-ai/*` 在 `contract` / `core` / `providers` / `ui-*` 为零；`dsh/host` 本票仍只允许 type-only（Q5 的 cordis 运行期例外在 P2 生效）；
   - `node:fs` 只允许 `providers` / `dsh`；`core` 只能 `node:path` / `node:os` 一类纯计算模块。
4. 更新 `.scratch` / `docs` / `README.md` 里约 29 处 `src/...` 锚点、测试 import 与路径陈述；锚点逐条重验，不照抄行号。
5. 仍单行 `apply`、plain object 服务；不拆插件行、不加 `agentProviders`、不引 `Service` 基类、不改 project root 解析。

## 验收

- [ ] `pnpm run check` 全绿；83 个用例数量与行为不变（只改 import 路径）。
- [ ] `pnpm run build` 产物新鲜；`lib/index.js` 仍可被 loader 加载，`package.json` 的 `main` / `exports` / service key 不变。
- [ ] import 矩阵有正反自测（合成违规必须报错），现有源码零违规。
- [ ] `core` 无 `node:fs` import；`@deepseek-ai/*` 在 `contract` / `core` / `providers` 为零；现有 `process.env` 默认参数与 project-root 解析暂留 core（P2 随 workspace 解析下沉到 provider）。
- [ ] 29 处 `src/...` 锚点全部解析；README 的路径陈述与新目录一致。
- [ ] 无行为变化：诊断码 / 排序 / 懒加载 / 信任语义 / 冻结读面形状全部不动。

## 已知约束

- 沙箱内不改依赖；Q5 的 `peerDependencies` / `Service` 基类不在本票。
- `src/index.ts` 的 `main` / exports 不能改，避免安装面变化。
- 移动是机械操作：不顺手改语义、不改函数签名、不改诊断 / 排序 / 懒加载行为；发现票面事实漂移时先记下，不在本票扩大范围。
- 锚点是断言不是合同；移动时逐条重验。
- `.vendor/deepseek-harness` 软链与测试 exclude 不动。

## Comments

- 来源：2026-10-18 `/codebase-design` core 设计（`docs/core-design.md` §8 P1）；裁决 Q3=A / Q4=A / Q5=B（ADR-0003 / ADR-0004）。
- P2 的第一道门是 loader 安装探针（`Service.listService` 可见 / inject / 卸载）；本票不触发。

## Agent Brief

**Category:** refactor
**Summary:** 把现有单包源码按 contract / core / providers / dsh 四层落位，用 import 矩阵锁住依赖方向；行为零变化，仍单行 apply。

**Current behavior:**
所有模块平铺在一个源码层；文件系统端口与两个适配器混在同一文件；宿主入口直接构造两个服务；层间依赖没有守卫，`core` 与 `dsh` 的边界靠注释维持。

**Desired behavior:**
- `contract` 只含跨层类型与常量，types only；
- `core` 只含领域模块（发现 / 解析 / 注册表 / 懒加载），不直接读文件系统、不 import 宿主包（workspace 解析与环境变量下沉在 P2）；
- `providers` 只含文件系统适配器（Node / host），不认识连接器；
- `dsh/host` 是唯一可结构读取宿主的层；包入口保持兼容；
- 跨层只准公共入口，import 矩阵在守卫里有正反自测；
- 包入口、service key、冻结读面形状、测试行为与安装面全部不变。

**Key interfaces:**
`AgentRegistry` / `AliasRegistry` / `AgentFileSystem` 的形状不变；入口仍导出 `apply`、`AGENT_REGISTRY_SERVICE`、`ALIAS_REGISTRY_SERVICE`、`BUNDLED_AGENTS_DIR`。

**Acceptance criteria:**
- `pnpm run check` 全绿；83 用例行为不变；
- 构建产物新鲜，入口模块可被 loader 加载；
- import 矩阵自测覆盖四条边界（跨层公共入口、宿主包、文件系统直接读、跨翼）；
- 约 29 处票面锚点全部解析；路径陈述更新；
- 无服务行拆分、无 provider 注册表、无 `Service` 基类、无行为变更。

**Out of scope:**
provider 注册表、插件行拆分、`Service` 基类 / `peerDependencies`（Q5=B 的 P2）、workspace 解析下沉、UI 两层、任何契约或行为变更。

