# Agents Tower Coordination Policy

## State interpretation

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

Treat `done` and `idle` as historical context, not ownership. A `cloud` row needs its upstream status checked before it is treated as active or historical.

`waiting` can mean a human input or approval wait. Check `needsUser` in fleet data or request events when the reason matters.

## Overlap levels

High-risk overlap:

- Same file path or generated output.
- Same subsystem with coupled state or contracts.
- Same active test, build, deploy, or listener restart.
- Same user-facing workflow where one agent's assumptions affect the other's output.
- One agent validates files another intends to edit.

Usually low-risk overlap:

- Different repositories.
- Independent rooms or subsystems with no shared files or generated output.
- Historical `done` or `idle` work.
- Read-only discovery alongside unrelated implementation.

When overlap is high-risk, prefer a separate file or subsystem, wait for the active validation, inspect without editing, or request explicit takeover direction when necessary.

## Query recipes

Local light check:

```bash
node packages/cli/dist/index.js web query <repo> gist scope=local --json
```

Team light check:

```bash
node packages/cli/dist/index.js web query <repo> gist scope=team --json
```

Current agent detail:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=local type=agents limit=10 --json
```

Team events:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=events limit=20 --json
```

Recent commands or edits:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=events kind=command limit=10 --json
node packages/cli/dist/index.js web query <repo> recent scope=team type=events kind=fileChange limit=10 --json
```

Use exact values observed in a gist or unfiltered sample instead of assuming every adapter emits the same source, state, or kind strings.

## Reporting pattern

Include only the evidence that changes the work boundary:

```text
Tower check: local scope shows one agent validating packages/core after npm test.
No coordinated team cache is available. I will keep this task read-only until
that validation completes.
```

If data is missing:

```text
Tower check: the local server is unavailable, so I cannot verify agent overlap.
I will preserve the current worktree and avoid delegation into shared files.
```

## Boundaries

- Do not infer ownership from old sessions.
- Do not claim team-wide certainty without `teamDataAvailable: true`.
- Do not use tower output as authorization to overwrite changes.
- Do not approve, reply to, interrupt, or resume another session.
- Do not turn a visibility check into a runtime restart unless the user separately asks for tower operation.
