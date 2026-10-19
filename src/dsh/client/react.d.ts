/**
 * Minimal structural React surface for the browser bundle (ticket 12).
 *
 * The shell's module loader provides the real React at runtime
 * (`require('react')` from the platform table); the workspace does not install
 * `@types/react` (dependency changes are human-only here), so this declaration
 * keeps the out-of-tree client half typechecked. It covers exactly the three
 * APIs the page shell uses; the UI implementation of ticket 05 replaces the
 * page and should bring the real types with it.
 */
declare module 'react' {
  export type ReactNode = unknown
  export interface ReactElement {
    readonly type: unknown
    readonly props: unknown
    readonly key: string | null
  }
  export function createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: readonly unknown[]
  ): ReactElement
  export function useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((previous: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void
}
