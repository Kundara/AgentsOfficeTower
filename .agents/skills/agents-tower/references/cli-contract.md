# Agents Tower CLI Contract

## Main commands

Use `npm start` for a build-and-run local launch. Use package builds plus the CLI entrypoint when validating deployable output directly.

```bash
npm start
npm run build -w packages/core
npm run build -w packages/web
npm run build -w packages/cli
node packages/cli/dist/index.js web --port 4181
node packages/cli/dist/index.js snapshot /abs/project/path
node packages/cli/dist/index.js watch /abs/project/path
```

Normal browser deploys omit project roots so the server remains in fleet mode. Passing project roots is reserved for focused debugging.

## Runtime verification

```bash
curl --fail --max-time 3 http://127.0.0.1:4181/api/server-meta
curl --fail --max-time 10 http://127.0.0.1:4181/api/fleet
curl --fail --max-time 3 http://127.0.0.1:4181/api/multiplayer
```

Important `server-meta` fields:

- `pid`: live process id.
- `startedAt`: listener start time.
- `buildAt`: timestamp of the deployed server build file.
- `entry`: running server entrypoint.
- `explicitProjects`: must be `false` for normal fleet mode.
- `projects`: currently bound fleet projects.

## Web query

```text
node packages/cli/dist/index.js web query <repo> <gist|recent|last> \
  [scope=local|team] [limit=N] [type=agents|events|all] \
  [state=STATE] [source=SOURCE] [kind=KIND] [since=ISO] [agent=NAME] \
  [--server URL|--host HOST|--port PORT] [--json]
```

Examples:

```bash
node packages/cli/dist/index.js web query AgentsOfficeTower gist scope=local --json
node packages/cli/dist/index.js web query AgentsOfficeTower recent scope=local type=agents state=running limit=5 --json
node packages/cli/dist/index.js web query AgentsOfficeTower recent scope=team type=events kind=command limit=10 --json
node packages/cli/dist/index.js web query AgentsOfficeTower last scope=local type=events kind=fileChange --json
```

Commands:

- `gist`: light state sync. Returns hot changes and active agents with their latest message and file change. Default limit `8`, maximum `50`.
- `recent`: newest matching items. Default limit `10`, maximum `50`.
- `last`: newest single matching item.

Scopes:

- `local`: live local fleet.
- `team`: latest browser-coordinated shared-room cache when available; otherwise local fallback with `teamDataAvailable: false`.

Filters use exact normalized snapshot values. Read a gist or unfiltered sample before guessing source, state, or event-kind strings.

## API boundary

- `GET /api/web-cli/query`: loopback-only read API used by `web query`.
- `POST /api/web-cli/team-fleet`: same-origin browser cache update for the already-rendered coordinated fleet.

The query API returns bounded projected summaries. It must not expose mutable browser actions, shared-room credentials, arbitrary file content, or raw transcript dumps.

## Listener recovery

1. Read `/api/server-meta` with a short timeout.
2. Inspect the listener with `lsof -iTCP:4181 -sTCP:LISTEN -n -P`.
3. Confirm that the process is Agents Office Tower.
4. Stop only the confirmed stale process.
5. Rebuild affected packages and start fleet mode.
6. Recheck `pid`, `startedAt`, `buildAt`, `entry`, and `explicitProjects`.
