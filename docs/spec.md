# Product Spec

## Purpose

Codex Agents Office is a workspace-level observability layer for Codex sessions.

It is not a chat replay UI. It is a live workload view that answers:

- which workspaces are active now
- which parent sessions are leading work
- which subagents are active, waiting, blocked, or done
- which room or project area that work maps to

## Product surfaces

### Browser

The browser office is the primary surface.

It should show:

- current desk occupancy for live work
- the 4 most recent lead sessions resting in the rec area
- hover cards and session panels for longer detail
- a durable cross-project `Needs You` queue when approvals or inputs are pending
- subtle in-scene motion and placement cues rather than a detached dashboard

### Terminal

The terminal surface is the fast inspection mode.

It should group sessions by room and show:

- state
- recent useful action
- active paths
- provenance/confidence
- resume commands when available

### VS Code

The VS Code panel should expose the same snapshot model as the browser and terminal views instead of inventing a separate state system.

## Source priority

Prefer official Codex surfaces first:

- `codex app-server`
- `codex cloud list --json`
- `.codex-agents/rooms.xml`
- `.codex-agents/agents.json`

Claude local logs and Cursor background agents are secondary inputs. They can enrich visibility, but they should not blur the distinction between typed Codex truth and inferred state.

## Browser behavior

### Workload placement

- Use current workload by default.
- Active local Codex work should occupy desks.
- Waiting/resting agents belong in the rec area, not at desks.
- The rec area should keep at most the 4 most recent lead sessions visible.
- Finished subagents should despawn instead of taking rec-area slots.
- Empty rooms should read as quiet space, not as errors.

### Fleet behavior

- Default browser deploys should run in fleet mode.
- Fleet mode should keep every discovered workspace live.
- The selected workspace changes browser focus only; it does not change the monitor set.
- `/api/server-meta` must report the live bound fleet project set, not only startup seed projects.

### Boss / lead behavior

- Lead sessions with active subagents can use the slimmer left lead lane.
- This lane should stay visually lighter than a large boxed office.
- Boss-to-subagent relationships may be shown on hover, but they should stay secondary to desk occupancy and scene motion.

## State and workload rules

- `waitingOnApproval` maps to `blocked`.
- `waitingOnUserInput` maps to `waiting`.
- failed command or turn state maps to `blocked`.
- in-progress turns map to active desk work unless a more specific state exists.
- recent completed replies map to `done`.
- old inactive threads map to `idle`.

Current-workload rules:

- local threads stay current while the live monitor still considers them ongoing
- `notLoaded` threads still stay current when `thread/read` shows an in-progress turn
- observer-owned unload/runtime-idle transitions do not count as a stop by themselves
- once a local thread actually stops, it remains desk-visible for about 2 seconds so the final reply can still be read before the avatar leaves
- stale blocked/waiting history should not remain current forever without ongoing state or a current user need

## Notifications and toasts

- File changes, commands, approvals, input waits, turn lifecycle events, and useful reply text should surface as toasts.
- Command-window toasts should aggregate per agent instead of stacking duplicates.
- Keep one command toast per agent, append new command lines at the bottom, and cap it at 3 visible lines.
- Read-like shell actions such as `sed`, `cat`, `rg`, `ls`, `find`, and `tree` should collapse into short summary toasts instead of echoing raw commands.
- Final reply text should not disappear just because command/read toasts also happened on the same thread.

## Visual expectations

- The office map should communicate state mostly through motion, placement, hover cards, and the session panel.
- Avoid large task-title overlays inside the room scene.
- Keep Codex-native typed state visually distinct from inferred Claude state when provenance matters.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
- Exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled intentionally from the asset sheet, not from a pasted example scene.

## Runtime expectations

- Treat the listener on `4181` as explicit runtime state.
- Do not assume the browser matches the latest source tree until the server has been rebuilt and restarted.
- `api/server-meta` is the source of truth for PID, start time, build time, fleet mode, and live bound projects.
- In fleet mode, cloud polling should run once centrally and be shared across monitors.
- Rate limits from the cloud surface should degrade into a human-readable note plus backoff, not repeated raw per-project failure spam.

## Internal doc map

- [architecture.md](./architecture.md)
  System design and module ownership.
- [integration-hooks.md](./integration-hooks.md)
  Exact upstream surfaces and how they map into the product.
- [self-development.md](./self-development.md)
  Improvement priorities.
- [references.md](./references.md)
  External sources.
