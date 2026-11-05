/**
 * 工作空间选择器（票 37）：`button` + `listbox` 的自定义下拉。
 *
 * 不用原生 `<select>`：选项要两行（标题 + 路径）与勾选态、警示态。可访问性按
 * WAI-ARIA APG 的 select-only combobox 形态：触发件 `role="combobox"`
 * （`aria-expanded` / `aria-controls` / `aria-activedescendant`），焦点留在触发件上，
 * 弹层是 `role="listbox"`，选项是 `role="option"`。键盘：↓/↑ 循环、Home/End 跳首尾、
 * Enter/Space 选择、Esc 关闭、Tab 关闭并让焦点自然离开、外部点击关闭。
 *
 * 渲染是纯 props → 标记，静态渲染测试（react-dom/server）可以覆盖闭合态与选项列表。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'

import { USER_CHOICE, choiceKey } from './workspace-scope.ts'

import type { ScopeListStatus, WorkspaceChoice } from './workspace-scope.ts'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

/** 弹层 id（同一面板里只有一个选择器）。 */
export const WORKSPACE_LIST_ID = 'panel-workspace-list'

/** 选项 id（`aria-activedescendant` 指向它）。 */
export function workspaceOptionId(index: number): string {
  return `panel-workspace-option-${index}`
}

/** 触发件上的文案：用户全局，或工作区标题（空标题回退到路径末段）。 */
export function workspaceChoiceLabel(choice: WorkspaceChoice): string {
  if (choice.kind === 'user') return '用户全局'
  const title = choice.title.trim()
  return title.length > 0 ? title : baseName(choice.path)
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/u, '')
  const index = trimmed.lastIndexOf('/')
  return index >= 0 ? trimmed.slice(index + 1) || trimmed : trimmed
}

export interface WorkspaceListboxProps {
  readonly choices: readonly WorkspaceChoice[]
  readonly selectedKey: string
  readonly activeIndex: number
  readonly listId: string
  onSelect(choice: WorkspaceChoice): void
  onHover(index: number): void
}

/** 弹层本体：独立成组件，静态渲染测试可以直接断言选项与 ARIA 关系。 */
export function WorkspaceListbox(props: WorkspaceListboxProps): ReactNode {
  return h('div',
    {
      className: 'panel-workspace-menu',
      role: 'listbox',
      id: props.listId,
      'aria-label': '工作空间',
    },
    props.choices.map((choice, index) => {
      const key = choiceKey(choice)
      return h('div',
        {
          key,
          id: workspaceOptionId(index),
          className: `panel-workspace-option${index === props.activeIndex ? ' active' : ''}${key === props.selectedKey ? ' selected' : ''}`,
          role: 'option',
          'aria-selected': key === props.selectedKey,
          onMouseEnter: () => props.onHover(index),
          // 按下不抢焦点：焦点留在触发件上，键盘导航不被弹层打断。
          onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
          onClick: () => props.onSelect(choice),
        },
        h('span', { className: 'panel-workspace-option-main' },
          h('span', { className: 'panel-workspace-option-title' }, workspaceChoiceLabel(choice)),
          key === props.selectedKey
            ? h('span', { className: 'panel-workspace-option-check', 'aria-hidden': true }, '✓')
            : null),
        h('span', { className: 'panel-workspace-option-path' },
          choice.kind === 'workspace' ? choice.path : '只扫用户级与随包根'))
    }))
}

export interface WorkspaceSelectProps {
  readonly choice: WorkspaceChoice
  readonly choices: readonly WorkspaceChoice[]
  readonly status: ScopeListStatus
  /** 服务端已回退或列表不可用：触发件带警示态。 */
  readonly warn: boolean
  onSelect(choice: WorkspaceChoice): void
}

/** 键盘状态机的输入。 */
export interface WorkspaceSelectKeyState {
  readonly open: boolean
  readonly active: number
  readonly count: number
}

/** 键盘状态机的输出（纯函数，键盘契约可单独测）。 */
export interface WorkspaceSelectKeyResult {
  /** 状态机认领了这个键（要更新展开 / 高亮）。 */
  readonly handled: boolean
  /** 要 `preventDefault()`：Tab 是唯一认领但不拦截的键（焦点得自然离开）。 */
  readonly preventDefault: boolean
  readonly open: boolean
  readonly active: number
  /** 该键要选中当前项。 */
  readonly select: boolean
  /** 关闭后把焦点还给触发件。 */
  readonly refocus: boolean
}

const OPEN_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' '])

/**
 * 选择器的键盘契约（WAI-ARIA APG select-only combobox）：
 * 关闭时 ↓/↑/Enter/Space 打开（↑ 从末项开始）；打开时 ↓/↑ 循环、Home/End 跳首尾、
 * Enter/Space 选中、Esc 关闭并回焦、Tab 关闭并让焦点自然离开，其余键不拦。
 */
export function workspaceSelectKey(
  state: WorkspaceSelectKeyState,
  key: string,
): WorkspaceSelectKeyResult {
  const count = Math.max(1, state.count)
  const unhandled: WorkspaceSelectKeyResult = {
    handled: false,
    preventDefault: false,
    open: state.open,
    active: state.active,
    select: false,
    refocus: false,
  }

  if (!state.open) {
    if (!OPEN_KEYS.has(key)) return unhandled
    return {
      handled: true,
      preventDefault: true,
      open: true,
      active: key === 'ArrowUp' ? count - 1 : Math.min(Math.max(0, state.active), count - 1),
      select: false,
      refocus: false,
    }
  }

  switch (key) {
    case 'ArrowDown':
      return { handled: true, preventDefault: true, open: true, active: (state.active + 1) % count, select: false, refocus: false }
    case 'ArrowUp':
      return { handled: true, preventDefault: true, open: true, active: (state.active - 1 + count) % count, select: false, refocus: false }
    case 'Home':
      return { handled: true, preventDefault: true, open: true, active: 0, select: false, refocus: false }
    case 'End':
      return { handled: true, preventDefault: true, open: true, active: count - 1, select: false, refocus: false }
    case 'Enter':
    case ' ':
      return { handled: true, preventDefault: true, open: true, active: state.active, select: true, refocus: false }
    case 'Escape':
      return { handled: true, preventDefault: true, open: false, active: state.active, select: false, refocus: true }
    case 'Tab':
      // 关弹层，但放行默认的焦点移动——注释与实现都按「自然离开」来。
      return { handled: true, preventDefault: false, open: false, active: state.active, select: false, refocus: false }
    default:
      return unhandled
  }
}

/** 触发件 + 弹层：受控展开，选择后关闭并把焦点还回触发件。 */
export function WorkspaceSelect(props: WorkspaceSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const selectedKey = choiceKey(props.choice)
  const choices = props.choices.length > 0 ? props.choices : [USER_CHOICE]
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choiceKey(choice) === selectedKey))

  // 选项集合变了（列表到达）就把高亮对到当前项。
  useEffect(() => {
    setActive(selectedIndex)
  }, [selectedIndex, choices.length])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const openMenu = (index: number): void => {
    setActive(index)
    setOpen(true)
  }

  const closeMenu = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const choose = (choice: WorkspaceChoice): void => {
    setOpen(false)
    props.onSelect(choice)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const next = workspaceSelectKey({ open, active, count: choices.length }, event.key)
    if (!next.handled) return
    // Tab 认领了状态（关弹层）但要放行默认焦点移动，其余键拦下浏览器行为。
    if (next.preventDefault) event.preventDefault()
    if (next.open !== open) setOpen(next.open)
    if (next.active !== active) setActive(next.active)
    if (next.refocus) {
      buttonRef.current?.focus()
      return
    }
    if (next.select) {
      const choice = choices[active]
      if (choice !== undefined) choose(choice)
    }
  }

  const label = workspaceChoiceLabel(props.choice)
  return h('span', { className: 'panel-workspace-anchor', ref: rootRef },
    h('button',
      {
        ref: buttonRef,
        type: 'button',
        role: 'combobox',
        className: `panel-workspace${props.warn ? ' warn' : ''}${open ? ' open' : ''}`,
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        // 弹层只在展开时挂载；闭合态给出 id 就是悬空引用（指向不存在的元素）。
        'aria-controls': open ? WORKSPACE_LIST_ID : undefined,
        'aria-activedescendant': open ? workspaceOptionId(active) : undefined,
        'aria-label': `工作空间：${label}`,
        title: props.choice.kind === 'workspace' ? `工作空间：${props.choice.path}` : '只扫用户级与随包根',
        onClick: () => {
          if (open) closeMenu(false)
          else openMenu(selectedIndex)
        },
        onKeyDown,
      },
      h('span', { className: 'panel-workspace-label' }, label),
      h('span', { className: 'panel-workspace-caret', 'aria-hidden': true }, '▾')),
    open && h(WorkspaceListbox, {
      choices,
      selectedKey,
      activeIndex: active,
      listId: WORKSPACE_LIST_ID,
      onSelect: choose,
      onHover: setActive,
    }))
}
