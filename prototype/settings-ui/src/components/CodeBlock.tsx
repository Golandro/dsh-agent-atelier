/**
 * PROTOTYPE — CodeMirror 6 块编辑器。
 * 每个文档块一个实例：语言固定（front-matter → YAML，其余 → Markdown），
 * 默认全部可编辑；外部值变化（保存 / 回退 / 切换 agent）时同步文档，
 * 自身输入通过 updateListener 回传，避免受控往返造成光标跳动。
 */
import { useEffect, useRef } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

export interface CodeBlockProps {
  value: string
  language: 'yaml' | 'markdown'
  ariaLabel: string
  readOnly?: boolean
  onChange: (text: string) => void
}

const theme = EditorView.theme(
  {
    '&': {
      height: 'auto',
      backgroundColor: 'transparent',
      color: 'var(--dsh-ink)',
      fontSize: '13px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--dsh-mono)',
      lineHeight: '1.6',
      overflow: 'visible',
    },
    '.cm-content': { padding: '7px 0', caretColor: 'var(--dsh-accent)' },
    '.cm-line': { padding: '0 10px 0 6px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--dsh-ink-faint)',
      border: 'none',
      borderRight: '1px solid var(--dsh-border)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsh-accent) 7%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsh-accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--dsh-accent) 24%, transparent)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--dsh-accent)' },
  },
  { dark: true },
)

export function CodeBlock({ value, language, ariaLabel, readOnly = false, onChange }: CodeBlockProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const syncingRef = useRef(false)

  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        basicSetup,
        oneDark,
        theme,
        language === 'yaml' ? yaml() : markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // value 只作为初始文档；后续变化由下面的同步 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, ariaLabel])

  // 外部值（保存成功 / 回退 / 切换 agent / 外部手改）同步进编辑器。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    syncingRef.current = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    syncingRef.current = false
  }, [value])

  return <div ref={hostRef} className={`cm-block${readOnly ? ' readonly' : ''}`} data-language={language} />
}
