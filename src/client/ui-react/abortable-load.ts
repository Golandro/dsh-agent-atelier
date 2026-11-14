/**
 * 懒加载状态机（票 26 / 簇 G）：列表 chunk、编辑器 chunk、壳快照三处此前各写
 * 一份 loading / error / retry 逻辑，这里收敛成一个 React 无关的机器 + 一个
 * React 绑定。
 *
 * 语义：`start()` 先推 loading 帧，再等 loader；旧的一轮在新一轮开始时即被
 * abort，重启 / 卸载之后迟到的结果一律丢弃；loader 自己抛的 abort 不算错误帧
 * （与 `src/control/client-errors.ts` 的 abort 形状一致）。
 *
 * 可测的 seam 是 `createAbortableLoad`：本仓没有 DOM 测试基座（完整组件基座
 * 归 #14，本票不引入 DOM 测试依赖），所以 node 测试直接驱动机器；hook 只加
 * 订阅与清理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { errorMessage, isAbortError } from '../../control/client-errors.ts'

/** One frame of an abortable load; `value` / `error` are set only in their own status. */
export type AbortableLoadState<T> =
  | { readonly status: 'loading'; readonly value: undefined; readonly error: undefined }
  | { readonly status: 'ready'; readonly value: T; readonly error: undefined }
  | { readonly status: 'error'; readonly value: undefined; readonly error: string }

/** What a hook caller sees: the frame plus the one retry entry. */
export type AbortableLoadView<T> = AbortableLoadState<T> & { readonly retry: () => void }

/** The initial frame, shared by the machine and the hook. */
const LOADING: { readonly status: 'loading'; readonly value: undefined; readonly error: undefined } = {
  status: 'loading',
  value: undefined,
  error: undefined,
}

/** Inputs of one machine: the loader is injected, never imported. */
export interface AbortableLoadOptions<T> {
  readonly load: (signal: AbortSignal) => Promise<T>
  /** Called on every frame (the hook wires it to `setState`). */
  readonly onChange?: ((state: AbortableLoadState<T>) => void) | undefined
  /** Error → message; defaults to the shared one-line helper. */
  readonly formatError?: ((error: unknown) => string) | undefined
}

/** The machine: one in-flight run at a time. */
export interface AbortableLoadMachine<T> {
  readonly state: AbortableLoadState<T>
  /** Start a run; an earlier in-flight run is aborted first. */
  start(): void
  /** Unmount / teardown: drop the in-flight run, notify nothing afterwards. */
  abort(): void
}

/**
 * Create the shared lazy-load machine. `start` is both the mount call and the
 * retry entry: each call aborts the previous run, so a late result from the
 * superseded load can never overwrite the current one.
 */
export function createAbortableLoad<T>(options: AbortableLoadOptions<T>): AbortableLoadMachine<T> {
  let state: AbortableLoadState<T> = LOADING
  let controller: AbortController | undefined
  const formatError = options.formatError ?? errorMessage

  const notify = (next: AbortableLoadState<T>): void => {
    state = next
    options.onChange?.(next)
  }

  /**
   * Drive one run. The loader is invoked synchronously (a retry must reach the
   * loader before the caller yields) and a synchronous throw lands in the catch.
   */
  const runLoad = async (run: AbortController): Promise<void> => {
    try {
      const value = await options.load(run.signal)
      if (controller !== run || run.signal.aborted) return
      notify({ status: 'ready', value, error: undefined })
    } catch (error: unknown) {
      if (controller !== run || run.signal.aborted || isAbortError(error)) return
      notify({ status: 'error', value: undefined, error: formatError(error) })
    }
  }

  return {
    get state(): AbortableLoadState<T> {
      return state
    },

    start(): void {
      controller?.abort()
      const run = new AbortController()
      controller = run
      notify(LOADING)
      void runLoad(run)
    },

    abort(): void {
      controller?.abort()
      controller = undefined
    },
  }
}

/**
 * Bind the machine to a component: one run per mount / deps change, abort on
 * teardown, `retry` re-runs the latest loader. The loader is read from a ref so
 * re-created closures do not restart the load by themselves; `deps` is the
 * caller's restart list.
 */
export function useAbortableLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AbortableLoadView<T> {
  const [state, setState] = useState<AbortableLoadState<T>>(LOADING)
  const loadRef = useRef(load)
  loadRef.current = load
  const machineRef = useRef<AbortableLoadMachine<T> | null>(null)
  if (machineRef.current === null) {
    machineRef.current = createAbortableLoad({
      load: (signal) => loadRef.current(signal),
      onChange: setState,
    })
  }
  const machine = machineRef.current

  useEffect(() => {
    machine.start()
    return () => machine.abort()
  }, [machine, ...deps])

  const retry = useCallback(() => machine.start(), [machine])
  return useMemo(() => viewOf(state, retry), [state, retry])
}

/** Attach the retry entry to a frame (kept out of the hook body for narrowing). */
function viewOf<T>(state: AbortableLoadState<T>, retry: () => void): AbortableLoadView<T> {
  switch (state.status) {
    case 'ready':
      return { ...state, retry }
    case 'error':
      return { ...state, retry }
    case 'loading':
      return { ...state, retry }
  }
}
