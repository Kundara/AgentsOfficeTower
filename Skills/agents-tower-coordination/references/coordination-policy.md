# Agents Tower Coordination Policy

## State Interpretation

Treat these states as live or potentially live:

- `planning`
- `scanning`
- `thinking`
- `editing`
- `running`
- `validating`
- `delegating`
- `waiting`
- `blocked`

Treat these states as context:

- `done`
- `idle`
- `cloud`, unless the cloud task is still active upstream

`waiting` can mean a human input or approval wait. Check `needsUser` in fleet data or query events if the user asks why.

## Overlap Rules

High-risk overlap:

- Same file path.
- Same subsystem directory.
- Same active test/build command.
- Same user-facing workflow.
- One agent is validating while another wants to edit files involved in that validation.

Low-risk overlap:

- Different repos.
- Different rooms/subsystems.
- One agent is only historical (`done` or `idle`).
- The active agent is working on docs while the new task is isolated code, or vice versa.

When overlap is high-risk, prefer one of these:

- Ask the user whether to take over.
- Work on a clearly separate file or test.
- Inspect only and report the overlap.
- Wait for the active validation to finish.

## Query Recipes

Current local activity:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=local type=agents limit=10 --json
```

Team-coordinated activity:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=all limit=20 --json
```

Recent commands:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=events kind=command limit=10 --json
```

Recent edits:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=events kind=fileChange limit=10 --json
```

Latest visible agent:

```bash
node packages/cli/dist/index.js web query <repo> last scope=local type=agents --json
```

## Reporting Pattern

Sharing is automatic through the tower and shared-room cache. Reporting means summarizing the relevant tower facts back to the user or to the current task context.

Use concise wording:

```text
Tower check: local scope shows one active Codex agent in `running`, last action `npm test`, cwd `<repo>`. No team cache is available. I will avoid changing test-owned files until that run finishes.
```

If data is stale or missing:

```text
Tower check: no matching active agents in local scope. Team scope fell back to local data, so I do not have shared-room visibility.
```

## Boundaries

- Do not infer ownership from old `done` or `idle` sessions.
- Do not claim team-wide certainty when `teamDataAvailable` is false.
- Do not use tower query output as permission to overwrite user changes.
- Do not expose raw JSON unless useful for debugging or explicitly requested.
