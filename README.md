# Agents Manager

Installable Cordis bundle for the DeepSeek Harness profile that manages
`agent.md` definitions. Delivered so far: **ticket 01** — lazy agent discovery
(four user/workspace roots plus the bundled root), the minimal frontmatter
reader, and the read-only `agentRegistry` service. Model resolution, UI, tool
filtering and prompt assembly belong to tickets 02–07.

## What it provides

| Item | Value |
| --- | --- |
| Package | `dsh-plugin-agents-manager` |
| Bundle patch | `cordis.patch.yml` (`insert:` one Host row) |
| Host entry | `apply(ctx)` in `src/index.ts` |
| Service key | `agentRegistry` |
| Service face | `list(options)` / `get(agentName, options)` / `diagnostics(options)` / `invalidate()` |
| Document layout | `<root>/<agent-name>/<agent-name>.agent.md` (ADR-0002) |
| Discovery roots | `.dsh/agents`, `.agents/agents` (project), `$DSH_HOME/agents`, `$DSH_AGENTS_HOME/agents` (user), bundled (rank 600) |
| Build output | `lib/` (ESM + `.d.ts`, loaded by the Harness) |

`agentRegistry` is deliberately **not** named `agents`: the host already owns
`ctx.agents` (the live Agent registry), and a bundle must not shadow a native
service. Nothing is registered into `ctx.skills` either — agents mirror the
native skill *shape* structurally instead (ADR-0001).

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
