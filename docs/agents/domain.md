# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: multi-context

This repo's domain-doc layout was confirmed at setup time as **multi-context**: each subproject keeps its own `GLOSSARY.md`, and a root `GLOSSARY-MAP.md` points at them. The repo root also carries a `GLOSSARY.md` for repo-wide terms, and `docs/adr/` holds system-wide decisions; context-scoped decisions live under `src/<context>/docs/adr/`.

State at setup time: `GLOSSARY.md` exists at the repo root with the terms resolved so far. `GLOSSARY-MAP.md` and the per-subproject `GLOSSARY.md` files are created lazily, at the first term actually written for a context — from then on the root map points at them.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo:

```
/
├── GLOSSARY.md                       ← repo-wide terms
├── GLOSSARY-MAP.md                   ← points at per-context glossaries
├── docs/adr/                         ← system-wide decisions
└── src/
    ├── <context>/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                 ← context-specific decisions
    └── ...
```

`GLOSSARY-MAP.md` and the per-context `GLOSSARY.md` files are created lazily, at the first resolved term — their absence is expected.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
