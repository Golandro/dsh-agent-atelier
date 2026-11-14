---
description: Agent LSP 技能族使用规则（符号优先 / 影响先行 / 预览后落盘 / 三层验证 / 外部参考）
enabled: true
alwaysApply: true
---
# Agent LSP 使用规则

**一句话：符号 → 影响 → 预览 → 落盘 → 三层验证。没有 LSP 工具就明说，不静默退回全文搜索。**

## 1. 工作区

- LSP 的根**只能有一个**：调用会话的 `$ProjectRoot`（向上最近的 `.git`，
  找不到回退 cwd）。没有 `add_workspace_folder` / `list_workspace_folders` /
  `start_lsp` / `detect_lsp_servers` 这些工具——当前 profile 一个都没装，别再
  照名字找。
- **外部参考（如 DSH 源码）必须真实落在 `$ProjectRoot` 之下。** 宿主用
  `realpath` 做包含性判定（`fs.contains`），软链会被解开到链接目标：指向
  工作区外的软链**必然**以 `source "<path>" resolves outside the workspace` 失败。
  用 `git worktree` 在工作区内检出真实文件（`.vendor/<name>/`，已 gitignore），
  并补一条 `node_modules` 软链给它（依赖解析沿软链正常生效）。
- 查询文档必须是工作区内真实文件；被查询文件的 import 由语言服务器自行解析，
  不受该包含性检查约束。

## 2. 符号优先

- 顺序：`list_symbols` / `find_symbol` / `go_to_symbol` → `inspect_symbol`
  （签名 + hover 文档）→ 读内容。
- 符号查不到 = 语义问题（名字、作用域、构建、索引）。停下报告；改用 grep
  只是猜，不能当替代。
- 文件内用 `lsp-local-symbols`；不熟符号用 `lsp-explore` / `lsp-understand`；
  新项目首会话用 `lsp-onboard`。

## 3. 文档三阶（lsp-docs）

1. `inspect_symbol` 的 hover；
2. 依赖或工具链符号用 `get_symbol_documentation`；
3. 前两阶失败再用 `go_to_definition` + `get_symbol_source` 读源码。

做 `lsp-impact` 前先查文档，别用错误假设解释影响报告。

## 4. 改动前：影响分析

- 导出符号 / 类型 / 接口：`lsp-impact`、`blast_radius`、`find_references`、
  `type_hierarchy`。
- 跨仓：`lsp-cross-repo` / `get_cross_repo_references`。
- 删代码：`lsp-dead-code`；先验证索引完整，再人工复核候选。
- 实现接口：`lsp-implement`。
- 没做影响分析，不动导出面。

## 5. 编辑：预览后才落盘

- 默认 `lsp-safe-edit`：基线诊断 → `preview_edit` → `apply_edit` → 复查。
- 多步重构用 `lsp-refactor`；重命名用 `lsp-rename`；坐标未知用
  `lsp-edit-symbol`；导出面用 `lsp-edit-export`；提取函数用
  `lsp-extract-function`。
- 文本匹配编辑先算范围；`preview_edit` 不可用时说明原因，落盘后用三层验证
  兜底。
- 只应用与本次改动相关的格式或代码动作；`lsp-fix-all` 只用于批量诊断。

## 6. 验证：三层

- `lsp-verify`：诊断 → 编译 → 测试，按严重度排序；相关测试用
  `lsp-test-correlation`。
- **无诊断 ≠ 干净**：服务器没发布就是未确认；用 `run_build` / `run_tests`
  或仓库自己的 `pnpm run check`。
- 格式化用 `lsp-format-code`；不要为了格式重排无关代码。

## 7. 审计与结构

- `lsp-architecture`：语言、包图、入口、热点；`lsp-inspect`：质量审计。
- `lsp-concurrency-audit`：并发字段安全；`lsp-dead-code`：零引用导出。
- 只读技能（architecture / inspect / impact / explore / docs / dead-code /
  cross-repo）不得改文件。

## 8. 速查表

| 意图 | 首选 | 备注 |
| --- | --- | --- |
| 新项目 / 大图 | `lsp-onboard` / `lsp-architecture` | 首会话一次，不每轮跑 |
| 查符号 | `lsp-explore` / `lsp-understand` / `lsp-local-symbols` | 先定位再读内容 |
| 查文档 | `lsp-docs` | hover → 工具链 → 源码 |
| 改前影响 | `lsp-impact` / `lsp-cross-repo` | 导出面必做 |
| 安全编辑 | `lsp-safe-edit` / `lsp-refactor` / `lsp-rename` | 预览后落盘 |
| 验证 | `lsp-verify` / `lsp-test-correlation` | 诊断 + 编译 + 测试 |
| 审计 | `lsp-inspect` / `lsp-dead-code` / `lsp-concurrency-audit` | 只读 |
| 生成 / 提取 | `lsp-generate` / `lsp-extract-function` | 生成后仍要验证 |
| 修复 / 格式化 | `lsp-fix-all` / `lsp-format-code` | 只碰本次改动 |

## 9. 反模式

- 没 LSP 就不说，直接 grep 猜符号。
- 先改代码，后查引用。
- 把「无诊断」当「通过」。
- 把外部源码 vendor 进仓库。
- 用文本匹配替代符号定位，然后声称重构安全。

## 10. 本仓特化

- TypeScript LSP 根：`$ProjectRoot`（本仓根）。DSH 宿主源码以 `git worktree`
  检出到 `$ProjectRoot/.vendor/deepseek-harness/`，**真实文件**而非软链——软链会
  被 `realpath` 判到工作区外，全部 LSP 调用直接失败。
- 只读引用外部源码时，可临时把会话工作区指向该仓库本身（此时本仓文件反过来
  不可用）；两者无法在同一根下同时索引。
- 验证以 `pnpm run check` 为准（静态守卫 + typecheck + vitest）；LSP 诊断只作
  补充。
