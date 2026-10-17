/**
 * PROTOTYPE — 页签行：Agents | Prompt Sections | System Prompts（+ 顾问，tab 变体时），
 * 右侧「Edit Tools ⋯」菜单（P1 橙框右缘）。窄屏页签横向滚动。
 */
import { useState } from 'react'
import type { Tab } from '../App'

export interface TabsProps {
  tab: Tab
  onTab: (t: Tab) => void
  /** tab 变体时显示「顾问」页签 */
  showAdvisorTab: boolean
  advisorOpen: boolean
  onToggleAdvisor: () => void
  onInvalidate: () => void
  onExternalEdit: () => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'sections', label: 'Prompt Sections' },
  { id: 'prompts', label: 'System Prompts' },
]

export function Tabs(props: TabsProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="tabs-row">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${props.tab === t.id ? ' active' : ''}`} onClick={() => props.onTab(t.id)}>
            {t.label}
          </button>
        ))}
        {props.showAdvisorTab && (
          <button className={`tab${props.tab === 'advisor' ? ' active' : ''}`} onClick={() => props.onTab('advisor')}>
            顾问
          </button>
        )}
      </nav>
      <span className="menu-anchor">
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          <span className="lbl">Edit Tools</span> ⋯
        </button>
        {open && (
          <>
            <div className="menu-backdrop" onClick={close} />
            <div className="menu menu-right">
              <div className="menu-item" onClick={() => { props.onToggleAdvisor(); close() }}>
                {props.showAdvisorTab ? '打开顾问页签' : props.advisorOpen ? '关闭顾问抽屉' : '打开顾问抽屉'}
              </div>
              <div className="menu-separator" />
              <div className="menu-item" onClick={() => { props.onExternalEdit(); close() }}>模拟外部手改文件…</div>
              <div className="menu-item" onClick={() => { props.onInvalidate(); close() }}>invalidate() 重读</div>
            </div>
          </>
        )}
      </span>
    </div>
  )
}
