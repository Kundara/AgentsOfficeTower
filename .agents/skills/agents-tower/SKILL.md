---
name: agents-tower
description: Operate and diagnose the local Agents Office Tower runtime. Use for starting or restarting fleet mode, snapshot or watch commands, server-meta and fleet verification, bounded web query gist/recent/last reads, or stale listener debugging on port 4181. Do not use for unrelated product implementation or for controlling agent sessions.
---

# Agents Tower

## Workflow

1. Classify the request as a read-only query, a snapshot/watch command, or a server lifecycle task.
2. For a read-only query, start with the smallest useful request:

```bash
node packages/cli/dist/index.js web query <repo> gist scope=local --json
```

3. Use `recent` or `last` only when the gist leaves a specific agent, event, state, or overlap question unresolved.
4. For a health checkup, prefer the typed status surface over raw endpoints:

```bash
node packages/cli/dist/index.js status --json
node packages/cli/dist/index.js digest
node packages/cli/dist/index.js doctor
```

   `status` reports fleet health (healthy/starting/degraded/stale), per-provider health, per-project freshness, and the attention pulse. `digest` answers "what needs a human" in one screen. `doctor` probes the local environment.
5. For server lifecycle work, inspect the live runtime before changing it:

```bash
curl --fail --max-time 3 http://127.0.0.1:4181/api/health
lsof -iTCP:4181 -sTCP:LISTEN -n -P
```

   Managed lifecycle commands exist when you need them: `node packages/cli/dist/index.js start|stop|restart|logs`. `stop` refuses to kill a listener whose live pid does not match the tower pidfile unless `--force` is passed — treat that refusal as a real ownership warning.

6. Rebuild core, web, and CLI when source changed, then start fleet mode without a project root:

```bash
npm run build -w packages/core
npm run build -w packages/web
npm run build -w packages/cli
npm run web -- --port 4181
```

7. Verify the deployed process and data:

```bash
curl --fail --max-time 3 http://127.0.0.1:4181/api/health/ready
curl --fail --max-time 3 http://127.0.0.1:4181/api/server-meta
curl --fail --max-time 10 http://127.0.0.1:4181/api/fleet
```

Success requires `explicitProjects: false` for a normal deploy and a `buildAt` value from the expected build.

## Guardrails

- Treat a listener as runtime state, not evidence that current source is deployed.
- Kill a stale listener only after its command or `/api/server-meta` identifies it as Agents Office Tower.
- Keep query work read-only. Do not approve requests, reply to threads, or mutate another agent session.
- Prefer `127.0.0.1`; the web query API is loopback-only.
- If a read-only query cannot reach the server, report the missing visibility. Start or restart the server only when the request includes runtime operation.
- Report the verified process, mode, matched project, and any remaining uncertainty; do not paste large fleet payloads unless requested.

## Reference

Read [references/cli-contract.md](references/cli-contract.md) when exact command shapes, filters, endpoints, host overrides, or listener recovery steps matter.
