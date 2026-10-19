/**
 * 分栏布局的断点单一事实源：CSS 容器查询与 pane.tsx 的 rem 常量必须同步。
 *
 * 票 05：大块布局（双栏 ↔ 单栏）由 CSS `@container pane` 决定，JS 只负责
 * 拖拽宽度夹取。这条测试只读源码文本，不依赖构建产物，也不需要 DOM。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  PANE_CONTENT_MIN_REM,
  PANE_LIST_MIN_REM,
  PANE_SPLITTER_REM,
} from '../src/dsh/client/pane.tsx'

const CSS_URL = new URL('../src/dsh/client/styles.css', import.meta.url)
const css = readFileSync(CSS_URL, 'utf8')
const breakpoint = PANE_LIST_MIN_REM + PANE_CONTENT_MIN_REM + PANE_SPLITTER_REM

describe('分栏布局（CSS 容器查询）', () => {
  it('断点与 pane.tsx 的常量一致', () => {
    expect(css).toContain(`@container pane (max-width: ${breakpoint}rem)`)
  })

  it('窄容器单栏模式隐藏列表，而不是用浮层盖住', () => {
    const start = css.indexOf(`@container pane (max-width: ${breakpoint}rem)`)
    expect(start).toBeGreaterThanOrEqual(0)
    const narrow = css.slice(start)
    expect(narrow).toMatch(
      /\.agents-page:not\(\.editor-closed\) > \.agent-list[\s\S]*?\{[^}]*display: none/,
    )
  })

  it('不再存在 JS 侧的 editor-overlay 布局类', () => {
    expect(css).not.toContain('editor-overlay')
  })
})
