import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.vendor/` holds a vendored DSH monorepo checkout whose own test suite
    // must not be picked up by this package's `vitest run`.
    exclude: [...configDefaults.exclude, '.vendor/**'],
  },
})
