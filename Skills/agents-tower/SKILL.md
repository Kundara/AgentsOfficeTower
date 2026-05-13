---
name: agents-tower
description: Run, verify, and query the Agents Office Tower CLI and local web server. Use when Codex needs to start or restart the tower, inspect /api/server-meta or /api/fleet, run snapshot/watch, use web query for local or team data, debug stale listeners, or explain the CLI contract for CodexAgentsOffice.
---

# Agents Tower

## Core Rule

Treat the running web server as runtime state, not proof that the latest source is deployed. Rebuild before a deploy when source changed, then verify the live listener with `/api/server-meta`.

## Quick Workflow

1. From the repo root, rebuild deployable packages if code changed:

```bash
npm run build -w packages/core
npm run build -w packages/web
npm run build -w packages/cli
```

2. Start fleet mode without project roots:

```bash
npm run web -- --port 4181
```

3. Verify fleet mode:

```bash
curl http://127.0.0.1:4181/api/server-meta
curl http://127.0.0.1:4181/api/fleet
```

`api/server-meta` must show `explicitProjects: false` for normal tower deploys.

## CLI Queries

Use `web query` for bounded read-only data from the running tower:

```bash
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=local type=agents limit=5 --json
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=team type=events kind=command limit=10 --json
node packages/cli/dist/index.js web query CodexAgentsOffice last scope=local type=agents --json
```

Use `scope=team` only when the browser is joined to shared-room sync and has cached coordinated room data. If the response says `teamDataAvailable: false`, treat the result as local-only.

## Safety

- Do not use this skill to mutate agent sessions, approve requests, send replies, or read arbitrary files.
- Prefer `127.0.0.1` for CLI/API checks. The web CLI API is intended to be loopback-only.
- If port `4181` is stale, identify the listener before killing it:

```bash
lsof -iTCP:4181 -sTCP:LISTEN -n -P
```

## Reference

Read [references/cli-contract.md](references/cli-contract.md) when you need exact commands, endpoint contracts, query filters, or troubleshooting steps.
