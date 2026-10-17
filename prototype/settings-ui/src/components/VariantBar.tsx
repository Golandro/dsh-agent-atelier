/**
 * PROTOTYPE — 底部浮动变体条（原型技能规则：变体可切 + URL 可分享）。
 * 变体 = 顾问面板放置：drawer（Agents 页右抽屉，P1 标注 B 区右侧）| tab（独立页签）。
 */
import type { AdvisorVariant } from '../App'

export interface VariantBarProps {
  variant: AdvisorVariant
  onVariant: (v: AdvisorVariant) => void
  inspectorOpen: boolean
  onToggleInspector: () => void
}

export function VariantBar(props: VariantBarProps) {
  return (
    <div className="variant-bar">
      <span className="dim">顾问面板:</span>
      <button className={`btn btn-sm${props.variant === 'drawer' ? ' btn-primary' : ''}`} onClick={() => props.onVariant('drawer')}>右抽屉</button>
      <button className={`btn btn-sm${props.variant === 'tab' ? ' btn-primary' : ''}`} onClick={() => props.onVariant('tab')}>页签</button>
      <span className="variant-sep" />
      <button className="btn btn-sm" onClick={props.onToggleInspector}>{props.inspectorOpen ? '隐藏' : '显示'} Inspector</button>
      <span className="dim variant-note">?advisor=tab 可分享</span>
    </div>
  )
}
