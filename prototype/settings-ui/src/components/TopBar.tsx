/**
 * PROTOTYPE — 顶栏：workspace 选择器 +「+ Add Prompt Section ▾」「+ Add Agent ▾」（P1 红框区）。
 * 窄屏时按钮文字收起只剩图标（app.css 响应式）。
 */
import { useState } from 'react'

export interface TopBarProps {
  workspace: string
  workspaces: string[]
  onWorkspace: (w: string) => void
  onAddAgent: (kind: 'blank' | 'reviewer' | 'researcher') => void
  onAddClip: () => void
}

type MenuId = 'ws' | 'clip' | 'agent' | null

export function TopBar(props: TopBarProps) {
  const [open, setOpen] = useState<MenuId>(null)
  const toggle = (id: MenuId) => setOpen((cur) => (cur === id ? null : id))
  const close = () => setOpen(null)

  return (
    <header className="topbar">
      <div className="topbar-title">
        智能体控制 <span className="proto-badge">PROTOTYPE · 一次性原型</span>
      </div>
      <div className="topbar-group">
        <span className="menu-anchor">
          <button className="btn" onClick={() => toggle('ws')} title="切换 workspace（决定项目层发现根）">
            🗂 <span className="lbl">{props.workspace}</span> ▾
          </button>
          {open === 'ws' && (
            <>
              <div className="menu-backdrop" onClick={close} />
              <div className="menu">
                {props.workspaces.map((w) => (
                  <div key={w} className={`menu-item${w === props.workspace ? ' active' : ''}`} onClick={() => { props.onWorkspace(w); close() }}>
                    {w}
                  </div>
                ))}
              </div>
            </>
          )}
        </span>

        <span className="menu-anchor">
          <button className="btn" onClick={() => toggle('clip')} title="新建提示词切片（= 新建一个 sections 文件）">
            ＋ <span className="lbl">Add Prompt Section</span> ▾
          </button>
          {open === 'clip' && (
            <>
              <div className="menu-backdrop" onClick={close} />
              <div className="menu">
                <div className="menu-item" onClick={() => { props.onAddClip(); close() }}>空白切片（当前 workspace 层）</div>
                <div className="menu-separator" />
                <div className="menu-item disabled">从模板…（演示未实现）</div>
              </div>
            </>
          )}
        </span>

        <span className="menu-anchor">
          <button className="btn btn-primary" onClick={() => toggle('agent')} title="新建 agent（= 新建 <agent-name>/<agent-name>.agent.md）">
            ＋ <span className="lbl">Add Agent</span> ▾
          </button>
          {open === 'agent' && (
            <>
              <div className="menu-backdrop" onClick={close} />
              <div className="menu">
                <div className="menu-item" onClick={() => { props.onAddAgent('blank'); close() }}>空白 agent</div>
                <div className="menu-item" onClick={() => { props.onAddAgent('reviewer'); close() }}>模板：代码审查专家</div>
                <div className="menu-item" onClick={() => { props.onAddAgent('researcher'); close() }}>模板：调研员</div>
              </div>
            </>
          )}
        </span>
      </div>
    </header>
  )
}
