/**
 * PROTOTYPE — Inspector：把状态摆到台面上（原型规则 5）。
 * 左 = 虚拟文件系统（本次会话改过的文件标 ●）；右上 = 最近写入；右下 = 操作日志。
 */
import type { FileWrite } from '../types'

export interface InspectorFile {
  path: string
  kind: 'agent' | 'section' | 'registry'
  modified: boolean
}

export interface LogEntry {
  time: string
  text: string
}

export interface InspectorProps {
  open: boolean
  onToggle: () => void
  files: InspectorFile[]
  lastWrites: FileWrite[]
  log: LogEntry[]
}

export function Inspector(props: InspectorProps) {
  const modifiedCount = props.files.filter((f) => f.modified).length
  return (
    <footer className={`inspector${props.open ? '' : ' closed'}`}>
      <div className="inspector-bar" onClick={props.onToggle}>
        <span>{props.open ? '▾' : '▸'} Inspector（虚拟文件系统 / 写入 / 日志）</span>
        <span className="dim">{modifiedCount} 个文件已改 · {props.lastWrites.length} 笔写入 · {props.log.length} 条日志</span>
      </div>
      {props.open && (
        <div className="inspector-body">
          <div className="inspector-col">
            <h5>虚拟文件系统（内存，刷新即重置）</h5>
            {props.files.map((f) => (
              <div key={f.path} className="fs-row">
                <span className="tag">{f.kind}</span>
                <span className="fs-path">{f.path}</span>
                {f.modified && <span className="fs-mod" title="本次会话改过">●</span>}
              </div>
            ))}
          </div>
          <div className="inspector-col">
            <h5>最近写入</h5>
            {props.lastWrites.length === 0 && <div className="dim">（尚无保存动作）</div>}
            {props.lastWrites.map((w, i) => (
              <div key={i} className="write-row">
                <span className="fs-path">{w.file}</span>
                <span className="dim">{w.reason} · {w.lines} 行</span>
              </div>
            ))}
            <h5>操作日志</h5>
            <div className="log-list">
              {props.log.length === 0 && <div className="dim">（空）</div>}
              {props.log.map((l, i) => (
                <div key={i} className="log-row"><span className="dim">{l.time}</span> {l.text}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}
