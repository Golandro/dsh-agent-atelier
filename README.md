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
| Bundle rows | `agent-atelier-core`, `agent-atelier-provider-fs`, `agent-atelier-ui` (`cordis.patch.yml`) |
| Services | `agentRegistry` · `aliasRegistry` · `agentProviders` · `agentControl` |
| Control routes | `/agent-atelier/state` · `compose` · `plan` · `commit` · `registry` · `invalidate` |
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
pnpm run check      # static guardrail + typecheck + tests (also the pre-commit hook)
```

Commit messages are checked by `.githooks/commit-msg`: no AI-brand attribution
trailers (`Co-Authored-By` / `Generated with`); AI models and tools are not
responsible parties.

The installed plugin loads `lib/`, so **re-run `pnpm run build` after any change
under `src/`** — the profile links this directory, it does not rebuild it. Wire
the hook once per clone: `git config core.hooksPath .githooks`.

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
(11/12/05). Model resolution (03), prompt assembly (04), catalog injection (06)
and the summon tool (07) follow the roadmap: issues and specs live in GitHub
Issues ([Golandro/dsh-agent-atelier](https://github.com/Golandro/dsh-agent-atelier/issues);
overview map: [#1](https://github.com/Golandro/dsh-agent-atelier/issues/1)).
`.scratch/agents-manager/` is the pre-migration archive — historical context
only, not tracked. Domain terms in `GLOSSARY.md`, decisions in `docs/adr/`.
