# Agents Manager (scaffold — ticket 10)

Installable Cordis bundle for the DeepSeek Harness profile that will manage
`agent.md` definitions. This package is the **scaffold only**: toolchain,
bundle manifest and one empty registration point. All discovery, parsing,
resolution, UI and tool behaviour belongs to tickets 01–07.

## What it provides

| Item | Value |
| --- | --- |
| Package | `dsh-plugin-agents-manager` |
| Bundle patch | `cordis.patch.yml` (`insert:` one Host row) |
| Host entry | `apply(ctx)` in `src/index.ts` |
| Service key | `agentRegistry` |
| Build output | `lib/` (ESM + `.d.ts`, loaded by the Harness) |

`agentRegistry` is deliberately **not** named `agents`: the host already owns
`ctx.agents` (the live Agent registry), and a bundle must not shadow a native
service.

## Commands

```bash
npm run build      # tsc -> lib/ (must exist before install)
npm test           # vitest run
npm run typecheck  # tsc --noEmit over src + test
npm run check      # guardrail: static hygiene + typecheck + tests
npm run check:static   # only the static guardrail (fast, no deps)
```

The installed plugin loads `lib/`, so **after any change under `src/` run
`npm run build` again** — the profile links this directory, it does not rebuild
it for you.

## Guardrails

This repo has no CI and no remote, so `scripts/check.mjs` runs from
`npm run check` and from `.githooks/pre-commit`. It fails on: a leftover probe
directory (`.probe/` is gitignored, so `git status` stays silent about it), a
`lib/` older than `src/`, a runtime `dependency` (this package is symlinked into
the profile and must stay dependency-free), an uninstalled `devDependency`, and
a `path:line` anchor in `.scratch/` or `docs/` that no longer resolves. Wire the
hook once per clone:

```bash
git config core.hooksPath .githooks
```

Package managers write their cache/store outside the workspace by default, which
the sandbox denies; `.npmrc` pins both inside the workspace (`cache=.npm-cache`,
`store-dir=.pnpm-store`).

## Installing into the profile

Never edit the profile's `package.json` or `cordis.patch.yml` by hand and never
run a package manager inside the profile directory. Build first, then install
the workspace directory as a bundle through the harness tool:

```
plugin_manager { action: "install_bundle", target: "/home/gg/dsh-plugin/agents-manager" }
```

`application: applied` means the row is live. Verify the registration point with
`cordis_inspect_query` (Host `Service.listService`, `service: "agentRegistry"`).
Rollback is `plugin_manager { action: "remove_bundle", target: "dsh-plugin-agents-manager" }`.
