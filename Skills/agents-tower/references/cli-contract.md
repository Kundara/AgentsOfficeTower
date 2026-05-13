# Agents Tower CLI Contract

## Main Commands

```bash
npm run build -w packages/core
npm run build -w packages/web
npm run build -w packages/cli
npm run web -- --port 4181
node packages/cli/dist/index.js web --port 4181
node packages/cli/dist/index.js snapshot /abs/project/path
node packages/cli/dist/index.js watch /abs/project/path
```

Normal browser deploys should omit project roots so the server runs in fleet mode.

## Runtime Verification

```bash
curl http://127.0.0.1:4181/api/server-meta
curl http://127.0.0.1:4181/api/fleet
curl http://127.0.0.1:4181/api/multiplayer
```

Important `server-meta` fields:

- `pid`: live process id.
- `buildAt`: timestamp of the deployed server build file.
- `explicitProjects`: must be `false` for normal fleet mode.
- `projects`: currently bound fleet projects.
- `multiplayer`: server transport status. Shared-room merging is currently browser-coordinated.

## Web Query

Shape:

```bash
node packages/cli/dist/index.js web query <repo> <recent|last> [scope=local|team] [limit=N] [type=agents|events|all] [state=STATE] [source=SOURCE] [kind=KIND] [since=ISO] [agent=NAME] [--json]
```

Examples:

```bash
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=local type=agents limit=5 --json
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=team type=events kind=command limit=10 --json
node packages/cli/dist/index.js web query CodexAgentsOffice last scope=local type=events kind=fileChange --json
```

Commands:

- `recent`: newest matching items, default limit `10`, max `50`.
- `last`: newest single matching item.

Scopes:

- `local`: read the server's live local fleet.
- `team`: read the latest browser-coordinated shared-room cache when available; otherwise falls back to local data and reports `teamDataAvailable: false`.

Types:

- `agents`: projected agent/session summaries.
- `events`: projected event summaries.
- `all`: both agents and events sorted by timestamp.

Useful filters:

- `state=running|thinking|waiting|blocked|done|idle`
- `source=local|cloud|cursor|claude|openclaw`
- `kind=command|fileChange|message|approval|input|tool|turn`
- `since=2026-05-13T18:00:00.000Z`
- `agent=Atlas`

## API Endpoints

- `GET /api/web-cli/query`: loopback-only read API used by `web query`.
- `POST /api/web-cli/team-fleet`: same-origin browser cache update for the already-rendered coordinated fleet.

The query API is read-only and returns projected summaries. It should not expose mutable browser actions, raw shared-room credentials, arbitrary file contents, or transcript dumps.

## Troubleshooting

If the browser is stale:

1. Check `api/server-meta`.
2. Compare `pid` and `buildAt` to the process you expected.
3. If needed, stop the old listener:

```bash
lsof -tiTCP:4181 -sTCP:LISTEN | xargs -r kill
```

4. Rebuild and restart with `npm run web -- --port 4181`.
