# Agent Atelier

**Agent Atelier**（智能体工坊）is an installable Cordis bundle that gives
DeepSeek Harness a user-facing **Agent layer**: `agent.md` documents defining an
expert's persona, model order, required tools and preset skills — discovered,
served as registry services, and edited through a sidebar panel. The bundle owns
session-start parameters (persona / model chain / tool filter / prompt assembly /
first message) and deliberately delegates runtime orchestration to native DSH.

## What it provides

| Item | Value |
| --- | --- |
| Package | `dsh-agent-atelier` |
| Bundle rows | `agent-atelier-core`, `agent-atelier-provider-fs`, `agent-atelier-assembly`, `agent-atelier-summon`, `agent-atelier-ui` (`cordis.patch.yml`) |
| Services | `agentRegistry` · `aliasRegistry` · `agentProviders` · `agentControl` · `agentAssembly` |
| Control routes | `/agent-atelier/state` · `compose` · `chain` · `plan` · `commit` · `registry` · `invalidate` |
| GUI panel | sidebar 「智能体工坊」, id `agent-atelier`, order 5 |
| Agent document | `<root>/<agent-name>/<agent-name>.agent.md` (ADR-0002) |
| Discovery roots | `.dsh/agents`, `.agents/agents` (project) · `$DSH_HOME/agents`, `$DSH_AGENTS_HOME/agents` (user) · bundled — low rank wins |
| Model registry | `registry.yaml`, workspace layer over global: `models:` real entries (`provider`/`model`/`sysPrompt`/`available`), `aliases:` pure pointers, built-in `dsh-default` |

`agentRegistry` is deliberately **not** named `agents`: the host already owns
`ctx.agents`, and a bundle must not shadow a native service.

## Commands

```bash
pnpm run build      # tsc + client bundles -> lib/ (must exist before install)
pnpm test           # vitest run
pnpm run test:hook  # vitest run --reporter=minimal (what the pre-commit hook runs)
pnpm run check      # static guardrail + typecheck + tests (also the pre-commit hook)
node scripts/vendor-worktree.mjs --dry-run   # show what the DSH source checkout would do
```

Commit messages are checked by `.githooks/commit-msg`: no AI-brand attribution
trailers (`Co-Authored-By` / `Generated with`); AI models and tools are not
responsible parties.

The installed plugin loads `lib/`, so **re-run `pnpm run build` after any change
under `src/`** — the profile links this directory, it does not rebuild it. Wire
the hook once per clone: `git config core.hooksPath .githooks`. The test stage
buffers vitest: one line on success, the full log on failure.

## Reading the DSH source (vendor checkout)

The LSP host resolves every queried path through `realpath` and rejects anything
outside the session workspace, so a `.vendor/deepseek-harness` **symlink** to an
outside checkout fails every query. Keep the canonical checkout outside the
workspace anyway — several working directories can share it, it stays read-only
by default, and it is reusable for secondary development — and materialize a
`git worktree` inside the workspace instead. A worktree shares that checkout's
object store, so it is a checkout, not a second clone.

```bash
node scripts/vendor-worktree.mjs --dry-run   # probe only; never touches anything
node scripts/vendor-worktree.mjs             # create or repair the worktree
```

The script probes before it acts and is safe to re-run:

- an existing checkout is **reused**, never cloned again — `--source`, `$DSH_SOURCE`,
  this project's managed clone under `$DSH_HOME/.$ProjectName/vendor/`, then the
  historical `~/repo/deepseek-harness`;
- an already-correct worktree is reported and left untouched;
- a legacy symlink is replaced (only the link is removed);
- a directory holding unrelated files is refused, not overwritten;
- only `--clone` reaches the network, and it clones **outside** the workspace.

It also links the source's `node_modules` into the worktree, because a worktree
holds only version-controlled files. Pass `--ref <ref>` to pin a different
commit. LSP needs the checkout to be a project root (the directory holding
`tsconfig.json`), not an ancestor of one.

## Installing into the profile

Never edit the profile's `package.json` or `cordis.patch.yml` by hand, and never
run a package manager inside the profile directory. Build first, then go through
the harness tool:

```
plugin_manager { action: "install_bundle", target: "<absolute path of this repo>" }
plugin_manager { action: "remove_bundle",  target: "dsh-agent-atelier" }
```

## Status & pointers

Delivered: agent discovery + `agentRegistry` (01), alias/model registry (02),
provider sub-plugin (18), control core + HTTP wiring + sidebar editor
(11/12/05), model resolution (03), prompt assembly planner + compat
registration (04), catalog injection (06), and the `summon_agent` entry +
native-entry replacement (07 — unit, fake-host, and in-process real-host
acceptance: persona/order/shadowing, tool masking, keepNative restore,
disposer reload, chain-exhausted isError, real local child composition).
The failure ledger (07b — in-memory recorder, both runtime legs, and session-path
consumption: terminal-request vs attempt semantics, request-level rate-limit
streak, UNKNOWN not accounted) is in; a profile install is now only a release
smoke. Issues and specs live in GitHub Issues
([Golandro/dsh-agent-atelier](https://github.com/Golandro/dsh-agent-atelier/issues);
overview map: [#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)).
`.scratch/agents-manager/` is the pre-migration archive — historical context
only, not tracked. Domain terms in `GLOSSARY.md`, decisions in `docs/adr/`.
