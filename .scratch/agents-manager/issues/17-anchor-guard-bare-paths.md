# 17 — 守卫扩展：裸 `src/...` 路径令牌存在性扫描

Status: ready-for-agent
Type: task
Blocked by: —

## 背景

票 16 复核（2026-10-18 两轴 `/code-review` + `/grill-with-docs` 七问裁决）发现守卫盲区：anchors 项只管 `path:line` 令牌，**裸路径**（反引号包裹的 `src/...`，不带行号）不进守卫 ⇒ 机械分层后 02/01/10 票共 10 处裸路径陈述全部漂移而 check 仍绿。守卫该兜住这类漂移，本票补上。

## 范围

1. `scripts/check.mjs` anchors 项扩展：`.scratch` / `docs` / `README.md` 的 markdown 里，凡反引号包裹、以 `src/` 开头的仓库内路径令牌（不含 `:line`），文件必须存在于 workspace。
2. 自测：合成树断言「存在的裸路径放行、缺失的裸路径必须报错」各一。
3. 不扫的形态：三反引号围栏代码块；DSH 源码树路径（`util/...`、`core/...` 等走 `~/repo/deepseek-harness` 解析的，维持现有锚点机制）；`test/`、`bundled/` 等非 `src/` 前缀令牌（要扩再立票）。

## 验收

- [ ] 缺失的裸 `src/...` 令牌能让 `pnpm run check` 报错；自测含正反断言。
- [ ] 现仓全量扫过零违规（`.scratch` / `docs` / `README.md`）。
