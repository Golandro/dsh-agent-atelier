# bundled/

Built-in assets that ship with this bundle.

Ticket 01 (`.scratch/agents-manager/issues/01-agent-registry.md`) fills this
directory with the built-in `default` agent at `default/default.agent.md` —
same directory layout as user agents, lowest discovery priority (rank 600)
after every user and workspace root, and a trusted root: a parse failure here
is a hard error, not a soft diagnostic.

Nothing here is business logic: the scaffold only reserves the directory so the
bundle layout is fixed before 01 starts.
