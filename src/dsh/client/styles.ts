/**
 * 智能体工作区样式（票 05）。
 *
 * 来源：prototype/settings-ui/styles/app.css（布局与响应式）+ dsh-theme.css
 * （暗色 token 与基础控件），移植为字符串常量由壳幂等注入 `<style>`。
 *
 * 作用域规则：
 * - 每条规则都以 `.agents-manager-page ` 前缀（选择器列表逐个前缀），不污染宿主壳；
 * - @keyframes 不存在、@media / @container 保持 at 规则本身、只前缀其内部选择器；
 * - dsh-theme 的 `:root` token 改挂在 `.agents-manager-page` 上；`html/body/#root`
 *   与 `body { overflow:hidden }` 属宿主壳职责，不移植（偏差）；
 * - `body.is-resizing` 改为 `.agents-manager-page.is-resizing`（pane.tsx 配套改动）；
 * - 原型顶栏 / 菜单 / 页签 / Sections / models / prompts / variant-bar 等未装配面
 *   的规则不移植（Q2 裁决：只做 agents 选项卡）。
 */
export const AGENTS_MANAGER_CSS: string = `
/* ── token 与页面基座（dsh-theme.css :root → 页面作用域） ─────────────── */
.agents-manager-page {
  /* 底色阶梯（页最深底 → 面板 → 卡片/浮层） */
  --dsh-bg: #151517;
  --dsh-bg-panel: #1b1b1c;
  --dsh-bg-elevated: #2c2c2e;
  --dsh-bg-hover: rgba(255, 255, 255, 0.08);
  /* 描边（DSH l3 = 白 16%） */
  --dsh-border: rgba(255, 255, 255, 0.16);
  /* 文字三级 */
  --dsh-ink: #f9fafb;
  --dsh-ink-dim: #cfd3d6;
  --dsh-ink-faint: #adb2b8;
  /* 蓝色强调 */
  --dsh-accent: #7aaaff;
  --dsh-accent-soft: color-mix(in srgb, var(--dsh-accent) 12%, transparent);
  --dsh-accent-ink: #ffffff;
  /* 状态色 */
  --dsh-ok: #22c55e;
  --dsh-warn: #f59e0b;
  --dsh-err: #f25a5a;
  /* 圆角与浮层阴影 */
  --dsh-radius-sm: 8px;
  --dsh-radius: 12px;
  --dsh-shadow: 0 12px 32px 0 rgba(0, 0, 0, 0.08), 0 3px 8px 0 rgba(0, 0, 0, 0.04);
  /* 字体（等宽栈刻意不带裸 monospace 尾巴，Windows 中文回退 SimSun） */
  --dsh-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --dsh-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier,
    'PingFang SC', 'Microsoft YaHei';

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsh-bg);
  color: var(--dsh-ink);
  font-family: var(--dsh-font);
  font-size: 14px;
  line-height: 22px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-autospace: normal;
  color-scheme: dark;
}

/* 每个控件自带 border-box（DSH Button.module.css:3 等），等价全局 reset 的作用域版 */
.agents-manager-page,
.agents-manager-page *,
.agents-manager-page *::before,
.agents-manager-page *::after {
  box-sizing: border-box;
}

.agents-manager-page .dim { color: var(--dsh-ink-dim); }
.agents-manager-page code { font-family: var(--dsh-mono); font-size: 0.92em; }

/* ── 基础控件（dsh-theme.css：按钮 / 徽标 / 卡片 / 下拉） ─────────────── */
.agents-manager-page .btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: 0.5px solid var(--dsh-border);
  border-radius: var(--dsh-radius);
  background: transparent;
  color: var(--dsh-ink);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.agents-manager-page .btn:hover:not(:disabled) { background: var(--dsh-bg-hover); }
.agents-manager-page .btn:active:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
.agents-manager-page .btn:disabled { opacity: 0.4; cursor: not-allowed; }
.agents-manager-page .btn:focus-visible,
.agents-manager-page .btn-primary:focus-visible,
.agents-manager-page .btn-icon:focus-visible {
  outline: 2px solid var(--dsh-accent);
  outline-offset: 2px;
}

.agents-manager-page .btn-primary {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: 0.5px solid transparent;
  border-radius: var(--dsh-radius);
  background: var(--dsh-accent);
  color: var(--dsh-accent-ink);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.agents-manager-page .btn-primary:hover:not(:disabled) { background: #4176e6; }
.agents-manager-page .btn-primary:active:not(:disabled) { background: #4176e6; }
.agents-manager-page .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.agents-manager-page .btn-sm {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--dsh-radius-sm);
  font-size: 12px;
  line-height: 18px;
}

.agents-manager-page .btn-icon {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0.5px solid transparent;
  border-radius: var(--dsh-radius-sm);
  background: transparent;
  color: var(--dsh-ink-dim);
  font: inherit;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.agents-manager-page .btn-icon:hover:not(:disabled) { background: var(--dsh-bg-hover); color: var(--dsh-ink); }
.agents-manager-page .btn-icon:active:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
.agents-manager-page .btn-icon:disabled { opacity: 0.4; cursor: not-allowed; }

.agents-manager-page .tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
}
.agents-manager-page .tag-user { background: #353638; color: var(--dsh-ink-dim); }
.agents-manager-page .tag-workspace { background: var(--dsh-accent-soft); color: var(--dsh-accent); }
.agents-manager-page .tag-bundled { border: 0.5px solid var(--dsh-border); color: var(--dsh-ink-faint); }
.agents-manager-page .tag-ok { background: color-mix(in srgb, var(--dsh-ok) 10%, transparent); color: var(--dsh-ok); }
.agents-manager-page .tag-warn { background: color-mix(in srgb, var(--dsh-warn) 12%, transparent); color: var(--dsh-warn); }
.agents-manager-page .tag-err { background: color-mix(in srgb, var(--dsh-err) 10%, transparent); color: var(--dsh-err); }

.agents-manager-page .card {
  border: 0.5px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 12px 14px;
  background: var(--dsh-bg-elevated);
  color: var(--dsh-ink);
}

.agents-manager-page .select {
  box-sizing: border-box;
  height: 34px;
  padding: 0 30px 0 12px;
  border: 0.5px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--dsh-radius);
  background-color: #353638;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 12px;
  color: var(--dsh-ink);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  appearance: none;
  cursor: pointer;
  outline: none;
}
.agents-manager-page .select:hover:not(:disabled) { background-color: color-mix(in srgb, #353638 92%, #ffffff); }
.agents-manager-page .select:focus-visible { border-color: var(--dsh-accent); outline: none; }
.agents-manager-page .select:disabled { opacity: 0.5; cursor: default; color: var(--dsh-ink-faint); }

/* 滚动条（dsh-theme scrollbar.css 作用域版） */
.agents-manager-page ::-webkit-scrollbar { width: 5px; height: 5px; }
.agents-manager-page ::-webkit-scrollbar-track { background: transparent; }
.agents-manager-page ::-webkit-scrollbar-thumb { border: 0 solid transparent; border-radius: 999px; background: #3c3c3d; background-clip: content-box; }
.agents-manager-page ::-webkit-scrollbar-thumb:hover { background-color: #545457; }
.agents-manager-page ::-webkit-scrollbar-corner { background: transparent; }
.agents-manager-page .card::-webkit-scrollbar-thumb { background: #545457; }
.agents-manager-page .card::-webkit-scrollbar-thumb:hover { background: #65676b; }
@supports not selector(::-webkit-scrollbar) {
  .agents-manager-page,
  .agents-manager-page * {
    scrollbar-width: thin;
    scrollbar-color: #3c3c3d transparent;
  }
}

/* ── 页面骨架（app.css .agents-page） ────────────────────────────────── */
.agents-manager-page .agents-page { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--list-width, 300px) var(--splitter-w, 6px) minmax(0, 1fr); }
.agents-manager-page .agents-page.editor-closed { grid-template-columns: minmax(0, 1fr); }
.agents-manager-page .agents-page.editor-closed .pane-splitter,
.agents-manager-page .agents-page.editor-closed .editor { display: none; }

/* 列表/编辑器拖拽分栏 */
.agents-manager-page .pane-splitter { position: relative; cursor: ew-resize; touch-action: none; outline: none; }
.agents-manager-page .pane-splitter::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%); background: var(--dsh-border); transition: background-color 120ms ease, width 120ms ease; }
.agents-manager-page .pane-splitter:hover::after,
.agents-manager-page .pane-splitter:focus-visible::after { background: var(--dsh-accent); width: 2px; }
/* 拖拽态挂页面根（pane.tsx 配套），不挂 body */
.agents-manager-page.is-resizing,
.agents-manager-page.is-resizing * { cursor: ew-resize !important; user-select: none; }

/* ── 列表面板外壳（agent 列表 chunk 的宿主样式） ─────────────────────── */
.agents-manager-page .agent-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.agents-manager-page .list-chunk-status { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; color: var(--dsh-ink-dim); font-size: 13px; }
.agents-manager-page .list-pane { background: var(--dsh-bg-panel); overflow-x: hidden; overflow-y: auto; padding: 0 0 12px; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.agents-manager-page .list-pane-top { position: sticky; top: 0; z-index: 2; display: flex; flex: none; flex-direction: column; gap: 8px; padding: 12px 12px 8px; background: var(--dsh-bg-panel); border-bottom: 0.5px solid var(--dsh-border); }
.agents-manager-page .list-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.agents-manager-page .list-head-actions { display: flex; flex: none; align-items: center; gap: 6px; }
.agents-manager-page .list-pane-title { font-size: 12px; color: var(--dsh-ink-dim); text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
.agents-manager-page .list-pane-count { margin-left: 6px; color: var(--dsh-ink-faint); font-size: 11px; letter-spacing: 0; text-transform: none; }
.agents-manager-page .list-pane-tools { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.agents-manager-page .list-pane-body { display: flex; flex-direction: column; min-width: 0; }
.agents-manager-page .agent-view-toggle,
.agents-manager-page .seg-switch { display: inline-flex; flex: none; padding: 1px; border: 0.5px solid var(--dsh-border); border-radius: 999px; }
.agents-manager-page .agent-view-toggle button,
.agents-manager-page .seg-switch button { border: 0; background: transparent; color: var(--dsh-ink-faint); font-family: inherit; font-size: 11px; line-height: 17px; padding: 1px 8px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.agents-manager-page .agent-view-toggle button:hover,
.agents-manager-page .seg-switch button:hover { color: var(--dsh-ink); }
.agents-manager-page .agent-view-toggle button.active,
.agents-manager-page .seg-switch button.active { background: var(--dsh-accent-soft); color: var(--dsh-accent); }

.agents-manager-page .list-search { height: 28px; padding: 0 8px; font-size: 12px; border-radius: var(--dsh-radius-sm); }
.agents-manager-page .list-filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.agents-manager-page .list-filter { flex: 1 1 88px; min-width: 0; height: 28px; padding: 0 24px 0 8px; font-size: 12px; border-radius: var(--dsh-radius-sm); background-position: right 8px center; }
.agents-manager-page .list-sort-dir { flex: none; width: 28px; height: 28px; border: 0.5px solid var(--dsh-border); border-radius: var(--dsh-radius-sm); }
.agents-manager-page .list-empty { padding: 20px 12px; text-align: center; font-size: 12px; line-height: 18px; }
.agents-manager-page .list-empty .btn { margin-top: 8px; }

/* agent 行：第 1 行来源/名称/路径/状态，第 2 行摘要/属性 */
.agents-manager-page .agent-rows { display: flex; flex-direction: column; min-width: 0; }
.agents-manager-page .agent-row { flex: none; display: flex; flex-direction: column; gap: 3px; padding: 7px 12px 8px; border-bottom: 0.5px solid var(--dsh-border); border-left: 2px solid transparent; cursor: pointer; min-width: 0; outline: none; }
.agents-manager-page [data-agent] { scroll-margin-top: 118px; }
.agents-manager-page .agent-row:hover { background: rgba(255, 255, 255, 0.03); }
.agents-manager-page .agent-row:focus-visible { outline: 2px solid var(--dsh-accent); outline-offset: -2px; }
.agents-manager-page .agent-row.selected { border-left-color: var(--dsh-accent); background: color-mix(in srgb, var(--dsh-accent) 6%, transparent); }
.agents-manager-page .agent-row.disabled .agent-row-name { color: var(--dsh-ink-dim); }
.agents-manager-page .agent-row-primary { display: flex; align-items: center; gap: 8px; min-width: 0; }
.agents-manager-page .agent-source-tag { flex: none; padding: 0 6px; border: 0.5px solid var(--dsh-border); border-radius: 999px; font-size: 10.5px; line-height: 16px; color: var(--dsh-ink-faint); background: rgba(255, 255, 255, 0.03); }
.agents-manager-page .agent-source-tag.workspace { color: var(--dsh-accent); border-color: color-mix(in srgb, var(--dsh-accent) 45%, transparent); background: var(--dsh-accent-soft); }
.agents-manager-page .agent-source-tag.user { color: var(--dsh-warn); border-color: color-mix(in srgb, var(--dsh-warn) 45%, transparent); background: color-mix(in srgb, var(--dsh-warn) 10%, transparent); }
.agents-manager-page .agent-source-tag.bundled { color: var(--dsh-ink-faint); }
.agents-manager-page .agent-row-name { flex: 0 0 auto; max-width: 45%; min-width: 0; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agents-manager-page .agent-row-flex { flex: 1 1 0; min-width: 8px; }
.agents-manager-page .agent-row-path { flex: 0 1 auto; max-width: 46%; min-width: 0; font-family: var(--dsh-mono); font-size: 11px; line-height: 16px; color: var(--dsh-ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agents-manager-page .agent-row-status { flex: none; min-width: 2.4em; display: inline-flex; justify-content: flex-end; align-items: center; font-size: 11px; }
.agents-manager-page .agent-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.agents-manager-page .agent-status-dot.ok { background: var(--dsh-ok); }
.agents-manager-page .agent-status-dot.disabled { background: var(--dsh-ink-faint); }
.agents-manager-page .agent-row-secondary { display: flex; align-items: baseline; gap: 12px; min-width: 0; padding-left: 2px; }
.agents-manager-page .agent-row-desc { flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 17px; color: var(--dsh-ink-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agents-manager-page .agent-row-desc.empty { color: var(--dsh-ink-faint); font-style: italic; }
.agents-manager-page .agent-row-attrs { flex: 0 1 auto; max-width: 58%; font-family: var(--dsh-mono); font-size: 10.5px; line-height: 16px; color: var(--dsh-ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agents-manager-page .agent-badge { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 999px; }
.agents-manager-page .agent-badge.err { background: var(--dsh-err); color: #fff; }
.agents-manager-page .agent-badge.warn { background: var(--dsh-warn); color: #151517; }

/* 编辑器关闭时列表占满页面，但内容保持可读宽度 */
@media (min-width: 961px) {
  .agents-manager-page .agents-page.editor-closed .agent-list { padding-left: 24px; padding-right: 24px; }
  .agents-manager-page .agents-page.editor-closed .list-pane-top,
  .agents-manager-page .agents-page.editor-closed .list-empty,
  .agents-manager-page .agents-page.editor-closed .agent-rows {
    width: 100%;
    max-width: 860px;
    margin-left: auto;
    margin-right: auto;
  }
}

/* 放不下两侧最小宽度（列表 20rem + 编辑器 40rem）：编辑器浮在列表之上 */
.agents-manager-page .agents-page.editor-overlay { position: relative; display: block; }
.agents-manager-page .agents-page.editor-overlay .pane-splitter { display: none; }
.agents-manager-page .agents-page.editor-overlay .agent-list { height: 100%; }
.agents-manager-page .agents-page.editor-overlay .editor { position: absolute; inset: 0; z-index: 20; background: var(--dsh-bg-panel); border-left: none; box-shadow: var(--dsh-shadow); }

/* 未选中时的占位提示 */
.agents-manager-page .pane-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--dsh-ink-dim); font-size: 13px; }
.agents-manager-page .pane-placeholder p { margin: 0; }

/* ── P1 组合文本编辑器（CodeMirror 分块）的宿主样式 ──────────────────── */
.agents-manager-page .editor { position: relative; z-index: 6; flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; container-type: inline-size; container-name: editor; }
.agents-manager-page .editor-head { position: relative; z-index: 5; flex: none; border-bottom: 1px solid var(--dsh-border); background: var(--dsh-bg-panel); }
.agents-manager-page .editor-titlebar { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 32px; padding: 10px 12px 4px; border-bottom: 1px solid color-mix(in srgb, var(--dsh-border) 55%, transparent); }
.agents-manager-page .editor-title { flex: 0 0 auto; min-width: 0; max-width: 50cqw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsh-mono); font-weight: 600; font-size: 13px; letter-spacing: 0.01em; color: var(--dsh-ink); }
.agents-manager-page .editor-path { flex: 1 1 auto; min-width: 0; padding-left: 10px; border-left: 1px solid var(--dsh-border); font-family: var(--dsh-mono); font-size: 11.5px; line-height: 16px; color: var(--dsh-ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.agents-manager-page .editor-path-text { direction: ltr; unicode-bidi: isolate; }
.agents-manager-page .editor-head .tag-bundled { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agents-manager-page .editor-spacer { flex: 1 1 auto; min-width: 0; }
.agents-manager-page .editor-titlebar .editor-spacer { display: none; }
.agents-manager-page .editor-utils { flex: none; display: flex; align-items: center; gap: 4px; margin-left: 4px; }
.agents-manager-page .editor-utils > .btn,
.agents-manager-page .editor-toolbar > .btn { flex: none; }
.agents-manager-page .lbl-compact,
.agents-manager-page .lbl-tiny { display: none; }
.agents-manager-page .editor-close { flex: none; }
.agents-manager-page .editor-toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 12px 8px; flex-wrap: nowrap; }
.agents-manager-page .editor-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; line-height: 18px; color: var(--dsh-ink-faint); white-space: nowrap; }
.agents-manager-page .editor-tool-sep { flex: none; width: 1px; height: 16px; background: var(--dsh-border); }
.agents-manager-page .editor-dirty-chip { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--dsh-warn); border: 1px solid color-mix(in srgb, var(--dsh-warn) 35%, transparent); background: color-mix(in srgb, var(--dsh-warn) 10%, transparent); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.agents-manager-page .save-failed { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; color: var(--dsh-err); white-space: nowrap; }

/* 写入计划预览（本页新增的 chrome 区）：entries chips / 拒绝行 */
.agents-manager-page .plan-preview { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--dsh-border); background: var(--dsh-bg-panel); flex-wrap: wrap; }
.agents-manager-page .plan-rejects { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--dsh-border); background: color-mix(in srgb, var(--dsh-err) 6%, transparent); }
.agents-manager-page .plan-reject-row { display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; }
.agents-manager-page .plan-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.agents-manager-page .plan-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 0.5px solid var(--dsh-border); border-radius: 999px; background: var(--dsh-bg-elevated); color: var(--dsh-ink-dim); font-size: 11px; line-height: 17px; white-space: nowrap; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

/* 窄窗格按优先级逐级压缩（.editor 为查询容器） */
@container editor (max-width: 700px) {
  .agents-manager-page .lbl-full { display: none; }
  .agents-manager-page .lbl-compact { display: inline; }
  .agents-manager-page .editor-titlebar { gap: 8px; padding: 8px 10px 3px; }
  .agents-manager-page .editor-toolbar { gap: 6px; padding: 3px 10px 6px; }
}
@container editor (max-width: 520px) {
  .agents-manager-page .editor-path { padding-left: 8px; }
  .agents-manager-page .editor-titlebar { gap: 6px; padding: 7px 8px 3px; }
  .agents-manager-page .editor-toolbar { padding: 3px 8px 6px; }
  .agents-manager-page .editor-tool-sep { display: none; }
}
@container editor (max-width: 460px) {
  .agents-manager-page .editor-path { display: none; }
  .agents-manager-page .editor-title { max-width: calc(100% - 122px); }
  .agents-manager-page .editor-titlebar .editor-spacer { display: block; }
  .agents-manager-page .editor-titlebar { padding: 6px 8px 2px; min-height: 28px; }
  .agents-manager-page .editor-toolbar { padding: 2px 8px 5px; }
  .agents-manager-page .editor-utils { gap: 2px; }
}
@container editor (max-width: 300px) {
  .agents-manager-page .editor-dirty-chip .lbl-compact { display: none; }
  .agents-manager-page .editor-dirty-chip .lbl-tiny { display: inline; }
  .agents-manager-page .editor-toolbar { gap: 4px; }
}

.agents-manager-page .editor-body { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.agents-manager-page .doc-editor-status { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; color: var(--dsh-ink-dim); font-size: 13px; }
.agents-manager-page .doc-editor-status p { margin: 0; }

.agents-manager-page .doc-editor { flex: 1; min-width: 0; min-height: 0; display: flex; container-type: inline-size; }
.agents-manager-page .doc-editor .cm-editor { flex: 1; min-width: 0; min-height: 0; height: 100%; background: transparent; }
.agents-manager-page .doc-editor .cm-scroller { overflow: auto; }
.agents-manager-page .doc-editor .cm-gutters .cm-foldGutter { display: none !important; }
.agents-manager-page .doc-editor .cm-lineNumbers .cm-gutterElement { display: flex; align-items: center; justify-content: flex-end; }
.agents-manager-page .doc-editor .cm-clipFoldGutter { width: 18px; }
.agents-manager-page .doc-editor .cm-clipFoldGutter .cm-gutterElement { position: relative; display: flex; align-items: center; justify-content: center; padding: 0 2px; }
.agents-manager-page .doc-editor .cm-clipFoldGutter .cm-gutterElement.cm-region-rail::before { content: ''; position: absolute; inset: 0 0 0 1px; border-left: 1px solid var(--region-rail, var(--dsh-ink-faint)); pointer-events: none; }
.agents-manager-page .doc-editor .cm-clipFoldGutter .cm-gutterElement.cm-region-rail-head::before { border-top: 1px solid var(--region-rail, var(--dsh-ink-faint)); border-top-left-radius: 6px; }
.agents-manager-page .doc-editor .cm-clipFoldGutter .cm-gutterElement.cm-region-rail-last::before { border-bottom: 1px solid var(--region-rail, var(--dsh-ink-faint)); border-bottom-left-radius: 6px; }
.agents-manager-page .doc-editor .cm-clipFoldGutter .cm-gutterElement.cm-activeLineGutter { background-color: transparent; }
.agents-manager-page .cm-clip-fold-marker { color: var(--dsh-ink-faint); font-family: var(--dsh-mono); font-size: 12px; line-height: 1; cursor: pointer; user-select: none; }
.agents-manager-page .cm-clip-fold-marker:hover { color: var(--dsh-accent); }
.agents-manager-page .doc-editor .cm-foldPlaceholder { display: inline-flex; align-items: center; margin: 0 2px; padding: 0 7px; border: 1px solid color-mix(in srgb, var(--dsh-accent) 45%, transparent); border-radius: 999px; background: var(--dsh-accent-soft); color: var(--dsh-accent); font-family: var(--dsh-mono); font-size: 11px; line-height: 17px; cursor: pointer; user-select: none; }
.agents-manager-page .doc-editor .cm-foldPlaceholder:hover { background: color-mix(in srgb, var(--dsh-accent) 22%, transparent); }
.agents-manager-page .doc-editor .cm-tooltip { z-index: 40; }
.agents-manager-page .doc-editor.readonly .cm-content { cursor: default; }

/* 块区域：header 顶线 + gutter 左栏 + 末行底线 */
.agents-manager-page .cm-region-kind-clip,
.agents-manager-page .cm-region-rail-kind-clip { --region-rail: var(--dsh-accent); }
.agents-manager-page .cm-region-kind-frontmatter,
.agents-manager-page .cm-region-rail-kind-frontmatter { --region-rail: color-mix(in srgb, var(--dsh-warn) 70%, transparent); }

.agents-manager-page .doc-editor .cm-line.cm-region-head { border-top: 1px solid var(--region-rail, var(--dsh-border)); }
.agents-manager-page .doc-editor .cm-line.cm-region-last { border-bottom: 1px solid var(--region-rail, var(--dsh-border)); }

.agents-manager-page .doc-editor .cm-line.cm-block-head-line {
  display: block;
  position: relative;
  --head-reserve: 380px;
  padding-right: calc(var(--head-reserve, 380px) + 22px);
  color: var(--dsh-accent);
  font-family: var(--dsh-mono);
  font-weight: 600;
  font-size: 1.2em;
  line-height: 1.7;
}
.agents-manager-page .doc-editor .cm-line.cm-block-head-line.cm-head-actions { --head-reserve: 450px; }
.agents-manager-page .doc-editor .cm-line.cm-block-head-line > .cm-head-badge { vertical-align: middle; }
.agents-manager-page .doc-editor .cm-line.cm-block-head-line > .cm-head-inline {
  position: absolute;
  top: 2px;
  right: 14px;
  float: none;
  width: max-content;
  max-width: calc(100% - 28px);
  margin: 0;
}
.agents-manager-page .cm-head-badge { display: inline-block; margin: 0 6px 0 2px; padding: 0 7px; border: 1px solid color-mix(in srgb, var(--dsh-accent) 45%, transparent); border-radius: 999px; background: var(--dsh-accent-soft); font-family: var(--dsh-mono); font-size: 11.5px; font-weight: 600; line-height: 18px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dsh-accent); vertical-align: middle; user-select: none; }
.agents-manager-page .cm-head-badge.kind-frontmatter { color: var(--dsh-warn); border-color: color-mix(in srgb, var(--dsh-warn) 45%, transparent); background: color-mix(in srgb, var(--dsh-warn) 10%, transparent); }
.agents-manager-page .cm-head-chrome { display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; font-family: var(--dsh-font); font-size: 12px; font-weight: 400; color: var(--dsh-ink-faint); vertical-align: middle; user-select: none; }
.agents-manager-page .cm-head-file { font-family: var(--dsh-mono); font-size: 12px; max-width: 20ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsh-ink-faint); }
.agents-manager-page .cm-head-state { font-size: 12px; color: var(--dsh-ink-faint); white-space: nowrap; }
.agents-manager-page .cm-head-state.dirty { color: var(--dsh-warn); font-weight: 600; }
.agents-manager-page .cm-head-state.missing { color: var(--dsh-err); font-weight: 600; }
.agents-manager-page .cm-head-range { font-family: var(--dsh-mono); font-size: 11px; white-space: nowrap; }
.agents-manager-page .cm-head-chrome .tag { font-size: 12px; line-height: 18px; padding: 0 7px; }
.agents-manager-page .cm-head-fill { flex: 1 1 auto; min-width: 6px; }
.agents-manager-page .cm-head-btn { height: 22px; padding: 0 8px !important; font-size: 11px; line-height: 16px; border-radius: var(--dsh-radius-sm); }
.agents-manager-page .cm-fm-head { --region-rail: color-mix(in srgb, var(--dsh-warn) 70%, transparent); display: flex; align-items: center; gap: 6px; min-height: 27px; margin: 0; padding: 2px 14px 2px 16px; border: 0; border-top: 1px solid var(--region-rail); border-radius: 0; font-size: 1.2em; flex-wrap: wrap; user-select: none; }
.agents-manager-page .cm-fm-head.cm-head-chrome { display: flex; margin-left: 0; font-size: 1.2em; }
.agents-manager-page .cm-fm-head .cm-head-badge { margin-left: 0; }
.agents-manager-page .cm-fm-line { color: var(--dsh-ink-dim); }

/* 编辑器窗格不够宽时逐步收起次要 header 信息 */
@container (max-width: 1200px) {
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line { --head-reserve: 360px; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line.cm-head-actions { --head-reserve: 450px; }
}
@container (max-width: 820px) {
  .agents-manager-page .cm-head-file { display: none; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line { --head-reserve: 210px; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line.cm-head-actions { --head-reserve: 300px; }
}
@container (max-width: 680px) {
  .agents-manager-page .cm-head-range { display: none; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line { --head-reserve: 164px; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line.cm-head-actions { --head-reserve: 254px; }
}
@container (max-width: 540px) {
  .agents-manager-page .cm-head-source,
  .agents-manager-page .cm-head-state { display: none; }
  .agents-manager-page .cm-head-chrome > .cm-head-btn { width: 22px; min-width: 22px; padding: 0 !important; justify-content: center; font-size: 0; }
  .agents-manager-page .cm-head-chrome > .cm-head-btn::before { content: attr(data-icon); font-size: 12px; line-height: 1; }
  .agents-manager-page .cm-head-chrome > .cm-head-btn:first-of-type { margin-left: auto; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line { --head-reserve: 0px; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line.cm-head-actions { --head-reserve: 64px; }
  .agents-manager-page .doc-editor .cm-line.cm-block-head-line:not(.cm-head-actions) > .cm-head-inline { display: none; }
}
.agents-manager-page .cm-missing-note { --region-rail: var(--dsh-accent); margin: 0; padding: 9px 14px; border: 0; border-bottom: 1px solid var(--region-rail); font-family: var(--dsh-font); font-size: 12px; color: var(--dsh-ink-dim); user-select: none; }
.agents-manager-page .cm-missing-note code { font-family: var(--dsh-mono); color: var(--dsh-err); }

/* ── 顾问面板（本页放编辑器/占位下方的折叠区，非原型的抽屉） ─────────── */
.agents-manager-page .advisor-panel { flex: none; max-height: 46%; overflow-y: auto; border-top: 1px solid var(--dsh-border); background: var(--dsh-bg-panel); }
.agents-manager-page .advisor { padding: 16px 16px 24px; display: flex; flex-direction: column; gap: 16px; }
.agents-manager-page .advisor-title { margin: 0; }
.agents-manager-page .advisor-sec h4 { margin: 0 0 8px; }
.agents-manager-page .finding { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--dsh-radius-sm); margin-top: 4px; }
.agents-manager-page .finding.error { background: color-mix(in srgb, var(--dsh-err) 10%, transparent); }
.agents-manager-page .finding.hint { background: color-mix(in srgb, var(--dsh-warn) 8%, transparent); }
.agents-manager-page .finding.info { background: color-mix(in srgb, var(--dsh-border) 30%, transparent); }
.agents-manager-page .finding-msg { flex: 1; font-size: 13px; min-width: 0; }
.agents-manager-page .bp-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.agents-manager-page .channel-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.agents-manager-page .channel-table th,
.agents-manager-page .channel-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--dsh-border); }
.agents-manager-page .channel-table tr.bp td { background: color-mix(in srgb, var(--dsh-err) 12%, transparent); }
.agents-manager-page .bp-mark { color: var(--dsh-err); margin-left: 4px; }
.agents-manager-page .advisor-note { font-size: 12px; }
.agents-manager-page .impact-card { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.agents-manager-page .kb-card p { margin: 4px 0; font-size: 13px; }
.agents-manager-page .declare-card p { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.agents-manager-page .declare-item { display: inline-block; margin: 2px 0; padding: 0 6px; border: 0.5px solid var(--dsh-border); border-radius: var(--dsh-radius-sm); font-size: 11px; line-height: 18px; }

/* ── 最近写入（Inspector 收窄版） ───────────────────────────────────── */
.agents-manager-page .inspector { flex: none; border-top: 1px solid var(--dsh-border); background: var(--dsh-bg-panel); }
.agents-manager-page .inspector-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px; font-size: 12px; }
.agents-manager-page .inspector-toggle { display: inline-flex; align-items: center; gap: 6px; border: 0; padding: 0; background: transparent; color: var(--dsh-ink); font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.agents-manager-page .inspector-caret { color: var(--dsh-ink-faint); width: 12px; }
.agents-manager-page .inspector-error { display: inline-flex; align-items: center; gap: 6px; color: var(--dsh-err); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agents-manager-page .inspector-body { display: flex; flex-direction: column; gap: 12px; padding: 8px 12px 12px; max-height: 220px; overflow: auto; }
.agents-manager-page .inspector-sec h5 { margin: 4px 0; font-size: 12px; color: var(--dsh-ink-dim); }
.agents-manager-page .write-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; min-width: 0; }
.agents-manager-page .fs-path { font-family: var(--dsh-mono); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 响应式（视口级；容器级断点见上方 @container） ───────────────────── */
@media (max-width: 1200px) {
  .agents-manager-page .cm-head-file { display: none; }
}
@media (max-width: 960px) {
  .agents-manager-page .agents-page { position: relative; display: block; }
  .agents-manager-page .agents-page .pane-splitter { display: none; }
  .agents-manager-page .agent-list { height: 100%; }
  .agents-manager-page .editor { position: absolute; inset: 0; z-index: 20; background: var(--dsh-bg-panel); border-left: none; box-shadow: var(--dsh-shadow); }
  .agents-manager-page .agents-page.editor-closed .editor { display: none; }
}
@media (max-width: 720px) {
  .agents-manager-page [data-agent] { scroll-margin-top: 150px; }
  .agents-manager-page .cm-head-source,
  .agents-manager-page .cm-head-range { display: none; }
}
`
