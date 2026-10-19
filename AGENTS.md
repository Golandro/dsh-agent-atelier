# Agent Atelier

`dsh-agent-atelier` — an installable Cordis bundle that gives DeepSeek Harness a
user-facing **Agent layer**: `agent.md` documents defining an expert's persona,
model order, required tools and preset skills. The bundle discovers them (four
roots + bundled), serves them (`agentRegistry`, `aliasRegistry`, `agentProviders`,
`agentControl`), and edits them through the sidebar panel 「智能体工坊」. It owns
session-start parameters — persona / model chain / tool filter / prompt assembly /
first message — and leaves runtime orchestration to native DSH: the atelier
prepares the summon, DSH runs it.

## Pointers

- **Domain terms** → `CONTEXT.md` — reach when naming or challenging vocabulary
  (Agent vs subagent/teammate, alias, channel).
- **Decisions** → `docs/adr/` — reach before re-litigating structure (discovery
  shape, directory layout, layering).
- **Spec & ticket archive** → `.scratch/agents-manager/` — `spec.md` holds the
  product consensus; new issues are tracked on GitHub.
- **Harness facts** → `docs/agents/harness-facts.md` — reach for service-key
  occupancy, bundle install/rollback, sandbox and package-manager caches.
- **Working agreements** → `README.md` — commands, the `pnpm run check`
  guardrail, install via `plugin_manager install_bundle` only.
