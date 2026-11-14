/** 侧栏图标：纯展示，不读页面或宿主状态。 */
import { createElement as h } from 'react'

import type { ReactNode } from 'react'

interface PanelIconOwnerProps {
  readonly size: number
  readonly active: boolean
}

/** 装饰性侧栏图标：三路调音台（每通道一枚旋钮）。继承 currentColor。 */
export function AgentControlIcon({ size }: PanelIconOwnerProps): ReactNode {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M4 7h7.4M16.6 7H20M4 12h1.4M10.6 12H20M4 17h9.4M18.6 17H20' }),
    h('circle', { cx: 14, cy: 7, r: 2.2 }),
    h('circle', { cx: 8, cy: 12, r: 2.2 }),
    h('circle', { cx: 16, cy: 17, r: 2.2 }),
  )
}
