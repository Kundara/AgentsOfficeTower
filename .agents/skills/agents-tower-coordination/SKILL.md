---
name: agents-tower-coordination
description: Use Agents Office Tower data to coordinate parallel or delegated repository work. Trigger when multiple local or shared-room agents may overlap, before assigning independent work, or when checking active files, commands, blockers, and ownership confidence. This skill is read-only situational awareness and must not infer permission or control other sessions.
---

# Agents Tower Coordination

## Workflow

1. Identify the repository name from the current workspace or request.
2. Read the local gist first:

```bash
node packages/cli/dist/index.js web query <repo> gist scope=local --json
```

3. Read the team gist only when shared-room coordination is relevant:

```bash
node packages/cli/dist/index.js web query <repo> gist scope=team --json
```

4. Treat `teamDataAvailable: false` as local-only visibility, not evidence that no remote agent exists.
5. Go deeper only to answer a concrete unresolved question:

```bash
node packages/cli/dist/index.js web query <repo> recent scope=local type=agents limit=10 --json
node packages/cli/dist/index.js web query <repo> recent scope=team type=events kind=fileChange limit=20 --json
```

6. Choose the smallest conflict-safe action:
   - Proceed when work is separate and evidence shows no meaningful overlap.
   - Narrow the task to different files or a different subsystem when overlap is avoidable.
   - Wait or report the conflict when another agent is validating the same surface.
   - Ask for takeover direction only when ownership materially changes what should be edited.
7. Report the coordination result before delegation or edits: scope, active actor, state, last useful action, overlap, provenance/confidence, and chosen boundary.

## Interpretation

- Treat `planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`, and `blocked` as live or potentially live.
- Treat `done` and `idle` as history, not ownership.
- Use hot changes and last file changes as overlap evidence, not as permission to overwrite work.
- Preserve user changes even when the tower shows no active agent.
- If the tower is unavailable, report the visibility gap. Do not start or restart it from this coordination-only skill.
- Do not paste raw fleet JSON unless it is needed for debugging or explicitly requested.

## Reference

Read [references/coordination-policy.md](references/coordination-policy.md) when overlap is ambiguous, team data is stale, or exact query recipes are needed.
