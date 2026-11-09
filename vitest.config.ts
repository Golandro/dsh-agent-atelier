import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.vendor/` holds a vendored DSH monorepo checkout and `.agents/` may
    // hold git worktrees of this repo; neither test suite belongs to this
    // package's `vitest run`.
    exclude: [...configDefaults.exclude, '.vendor/**', '.agents/**'],
  },
})
