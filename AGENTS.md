## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo (local Markdown tracker, no remote). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

single-context — one `CONTEXT.md` at the repo root, with architecture decisions in `docs/adr/`. See `docs/agents/domain.md`.

### Harness facts

Harness/profile facts — service key occupancy, inspect readback channels and their limits, bundle install/rollback, sandbox and package-manager cache — are in `docs/agents/harness-facts.md`, next to the ticket-claim re-check rule that `pnpm run check` enforces.
