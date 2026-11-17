import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.vendor/` holds a vendored DSH monorepo checkout; `.agents/`, `.codebuddy/`,
    // `.dsh/` and `.trae/` may hold git worktrees of this repo. None of their test
    // suites belongs to this package's `vitest run`. `.codebuddy` is a symlink to
    // `.agents`, so both spellings must be excluded.
    exclude: [...configDefaults.exclude, '.vendor/**', '.agents/**', '.codebuddy/**', '.dsh/**', '.trae/**'],
  },
})
