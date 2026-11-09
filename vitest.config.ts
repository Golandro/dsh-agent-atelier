import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.vendor/` holds a vendored DSH monorepo checkout; `.agents/`, `.dsh/`
    // and `.trae/` may hold git worktrees of this repo. None of their test
    // suites belongs to this package's `vitest run`.
    exclude: [...configDefaults.exclude, '.vendor/**', '.agents/**', '.dsh/**', '.trae/**'],
  },
})
