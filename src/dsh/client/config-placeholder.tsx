/**
 * 「配置」页签占位（票 05）。
 *
 * 本票范围只包含「智能体」视图；配置视图留给后续票（registry / 模型关联等）。
 * 先给出明确的占位说明，避免页签点开后是一片空白。
 */
import { createElement as h } from 'react'
import { nsClass } from './class-names.ts'
import { panelViewId } from './panel-types.ts'
import type { ReactNode } from 'react'

export interface ConfigPlaceholderProps {
  /** 页签未选中时保持挂载，由 hidden 属性隐藏。 */
  readonly hidden?: boolean
}

export function ConfigPlaceholder(props: ConfigPlaceholderProps): ReactNode {
  return h('section',
    {
      className: nsClass('config-view'),
      id: panelViewId('config'),
      role: 'tabpanel',
      'aria-labelledby': 'panel-tab-config',
      hidden: props.hidden === true,
    },
    h('div', { className: 'config-placeholder' },
      h('p', null, '配置（尚未实现）'),
      h('p', { className: 'dim' }, '后续在此接入注册表、模型关联等设置。')))
}
