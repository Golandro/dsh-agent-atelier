# Agents Manager

Installable Cordis bundle for the DeepSeek Harness profile that manages
`agent.md` definitions. Delivered so far: **ticket 01** — lazy agent discovery
(four user/workspace roots plus the bundled root), the minimal frontmatter
reader, and the read-only `agentRegistry` service; **ticket 02** — the
`registry.yaml` layer reader, the workspace-over-global merge, the built-in
`dsh-default` alias, and the pure cross-layer inspection behind the read-only
`aliasRegistry` service. Model resolution, UI, tool filtering and prompt
assembly belong to tickets 03–07.

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
| Alias service key | `aliasRegistry` |
| Alias service face | `snapshot(options)` / `getAlias(aliasName, options)` / `getModel(modelName, options)` / `diagnostics(options)` / `invalidate()` |
| Registry layers | `<project>/.dsh/agents/registry.yaml` (workspace) over `$DSH_HOME/agents/registry.yaml` (global) |
| Build output | `lib/` (ESM + `.d.ts`, loaded by the Harness) |

`agentRegistry` is deliberately **not** named `agents`: the host already owns
`ctx.agents` (the live Agent registry), and a bundle must not shadow a native
service. `aliasRegistry` follows the same rule, and nothing native occupies it
either. Nothing is registered into `ctx.skills` either — agents mirror the
native skill *shape* structurally instead (ADR-0001).

`registry.yaml` is a two-map file: `models:` holds real model entries
(`provider`, `model`, `sysPrompt`, `available`) and `aliases:` holds pure
pointers to them. The built-in `dsh-default` alias tracks the DSH sub-agent
default pair — read from `ctx.agentDefaultModel` at load time, which makes
`invalidate()` the only refresh — is a reserved word in both maps, and points at
a synthesised model entry when the pair matches nothing declared. A layer that
fails to read or validate is dropped whole with diagnostics instead of being
half-merged, and `inspectAliasRegistry(snapshot, agents)` reports agent-side
problems (unknown alias, raw `model:` escape hatch, alias fan-in) as data rather
than throwing.

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

`application: applied` means the row is live. Both services are plain objects, so
they do **not** appear in the Host service directory — prove the registration
point with the loader entry plus `test/plugin.test.ts`, not by searching
`Service.listService` (`docs/agents/harness-facts.md`). Rollback is
`plugin_manager { action: "remove_bundle", target: "dsh-plugin-agents-manager" }`.
