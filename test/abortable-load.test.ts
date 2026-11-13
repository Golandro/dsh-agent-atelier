/**
 * 懒加载状态机的 node 级 seam（票 26 / 簇 G）。
 *
 * 三个调用点（列表 chunk、编辑器 chunk、壳快照）此前各写一份 loading /
 * error / retry 状态机；本票把它们收敛到 `createAbortableLoad`，hook 只是它
 * 在 React 上的绑定。本仓没有 DOM 测试基座（完整组件基座归 #14，本票不引入
 * DOM 依赖），所以用假 loader 直接驱动机器：loading→success、
 * loading→error→retry、卸载 abort 之后不再通知。
 */
import { describe, expect, it } from 'vitest'

import { abortError } from '../src/control/client-errors.ts'
import { createAbortableLoad } from '../src/dsh/client/abortable-load.ts'

/** 让机器的一次 promise 链跑完（loader 解析 / 拒绝各占一拍）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('abortable load state machine (ticket 26)', () => {
  it('reaches ready with the loaded value and reports the loading frame first', async () => {
    const seen: string[] = []
    const machine = createAbortableLoad<string>({
      load: async () => '/chunk.js',
      onChange: (state) => seen.push(state.status),
    })

    expect(machine.state).toEqual({ status: 'loading', value: undefined, error: undefined })
    machine.start()
    await flush()

    expect(machine.state).toEqual({ status: 'ready', value: '/chunk.js', error: undefined })
    expect(seen).toEqual(['loading', 'ready'])
  })

  it('surfaces the loader failure and shows loading again on retry', async () => {
    let attempts = 0
    const machine = createAbortableLoad<string>({
      load: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('chunk exploded')
        return '/chunk.js'
      },
    })

    machine.start()
    await flush()

    expect(machine.state).toEqual({ status: 'error', value: undefined, error: 'chunk exploded' })

    machine.start()
    expect(machine.state.status).toBe('loading')
    await flush()

    expect(machine.state).toEqual({ status: 'ready', value: '/chunk.js', error: undefined })
  })

  it('goes quiet after unmount: a late resolution never notifies again', async () => {
    let settle!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      settle = resolve
    })
    const seen: string[] = []
    const machine = createAbortableLoad<string>({
      load: () => pending,
      onChange: (state) => seen.push(state.status),
    })

    machine.start()
    machine.abort()
    settle('/late.js')
    await flush()

    expect(seen).toEqual(['loading'])
    expect(machine.state.status).toBe('loading')
  })

  it('drops the superseded run when a retry starts before the first resolves', async () => {
    const resolvers: Array<(value: string) => void> = []
    const machine = createAbortableLoad<string>({
      load: () => new Promise<string>((resolve) => resolvers.push(resolve)),
    })

    machine.start()
    machine.start()
    resolvers[1]!('/second.js')
    await flush()
    expect(machine.state).toEqual({ status: 'ready', value: '/second.js', error: undefined })

    resolvers[0]!('/first.js')
    await flush()
    expect(machine.state).toEqual({ status: 'ready', value: '/second.js', error: undefined })
  })

  it('treats a loader-raised abort as quiet, not as an error frame', async () => {
    const seen: string[] = []
    const machine = createAbortableLoad<string>({
      load: async () => {
        throw abortError()
      },
      onChange: (state) => seen.push(state.status),
    })

    machine.start()
    await flush()

    expect(seen).toEqual(['loading'])
    expect(machine.state.status).toBe('loading')
  })
})
