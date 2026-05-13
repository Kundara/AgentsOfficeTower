---
name: agents-tower-coordination
description: Coordinate Codex agents with Agents Office Tower data. Use when multiple local or team agents may work on the same repo, when Codex should inspect what other agents are doing before editing, when avoiding duplicate work or file conflicts, or when using local/team tower snapshots as shared situational awareness.
---

# Agents Tower Coordination

## Core Rule

Use tower data as situational awareness, not as authority to modify another agent's work. Never assume other agents know your context unless the tower data or conversation shows it.

## Coordination Workflow

1. Identify the repo name from the current workspace or user request.
2. Query local agents first:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=local type=agents limit=10 --json
```

3. If shared-room sync is relevant, query team context:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=team type=all limit=20 --json
```

4. Interpret the result:
   - Active states (`planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`, `blocked`) mean current work may overlap.
   - `done` and `idle` are historical context, not ownership.
   - `teamDataAvailable: false` means team scope did not have coordinated shared-room data.

5. Choose your action:
   - If another agent is active in the same files or subsystem, avoid editing that area unless the user explicitly wants takeover.
   - If another agent is validating or running commands, wait or focus on non-overlapping work.
   - If another agent is blocked or waiting, surface the blocker instead of duplicating the attempt.
   - If there is no overlap, proceed and make your own work visible through normal commands and updates.

## What To Report

Tower sharing is automatic. When coordinating in chat, report only high-signal facts from the tower data:

- agent label or role
- state
- last useful action
- file/subsystem overlap
- provenance or confidence if it changes how much to trust the data
- whether the data is local-only or team-coordinated

Do not paste large fleet payloads unless the user asks for raw JSON.

## Reference

Read [references/coordination-policy.md](references/coordination-policy.md) for interpretation rules, conflict handling, and query recipes.
