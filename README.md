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
```

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
