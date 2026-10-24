# Agent Atelier

`dsh-agent-atelier` — an installable Cordis bundle that gives DeepSeek Harness a
user-facing **Agent layer**: `agent.md` documents defining an expert's persona,
model order, required tools and preset skills. The bundle discovers them (four
roots + bundled), serves them (`agentRegistry`, `aliasRegistry`, `agentProviders`,
`agentControl`), and edits them through the sidebar panel 「智能体工坊」. It owns
session-start parameters — persona / model chain / tool filter / prompt assembly /
first message — and leaves runtime orchestration to native DSH: the atelier
prepares the summon, DSH runs it.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`Golandro/dsh-agent-atelier`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, label strings equal to their names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

multi-context (`GLOSSARY-MAP.md` at the root pointing at per-context `GLOSSARY.md`). See `docs/agents/domain.md`.

## Working rules

- **Symbols before text**: locate the symbol first (`list_symbols` /
  `find_symbol`), read content second. If no LSP tool is available, say so
  instead of silently falling back to prose search. A symbol that cannot be
  found is a semantic problem (name, scope, build, or index), not a cue to grep.
  Details: `.agents/rules/agent-lsp-userguide.md`.
- **Interfaces live in source**: interface signatures and inline docs land in the
  contract layer; specs and tickets carry the decision summary and a module
  pointer, never a second copy of the signatures.
- **Fact-check primary sources first**: read `docs/agents/harness-facts.md`
  before host-API, patch, or subagent fact-checks. Delegate with exact paths and
  a report template; an Explore snippet list is not a fact report, and repeating
  the dispatch is not progress.
- **External sources stay external**: host source such as DSH is added as an LSP
  workspace folder, not vendored or committed, but remains searchable.
- **Explicit waivers win**: when the user says not to re-check state, skip
  `git status` / `git log`; stage the named paths and proceed.
- **Attribution**: AI models and tools are not the responsible party. Commits
  carry project-style authorship only; no AI-brand attribution trailer
  (`Co-Authored-By` / `Generated with`). `.githooks/commit-msg` enforces this.

## Pointers

- **LSP rules** → `.agents/rules/agent-lsp-userguide.md` — reach when using the
  agent-lsp skill family.
- **Domain terms** → `GLOSSARY.md` — reach when naming or challenging vocabulary
  (Agent vs subagent/teammate, alias, channel).
- **Decisions** → `docs/adr/` — reach before re-litigating structure (discovery
  shape, directory layout, layering).
- **Spec & ticket archive** → `.scratch/agents-manager/` — `spec.md` holds the
  product consensus; new issues are tracked on GitHub.
- **Harness facts** → `docs/agents/harness-facts.md` — reach before host-API
  fact-checks, patch mechanics, subagent dispatch, or external DSH source reads.
- **Working agreements** → `README.md` — commands, the `pnpm run check`
  guardrail, install via `plugin_manager install_bundle` only.
