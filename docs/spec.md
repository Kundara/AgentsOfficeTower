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

The browser map should be treated as a retained 2D scene, not a stream of HTML snapshots.
Live data should update scene entities in place instead of rebuilding the office subtree by `innerHTML`.

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
- A local thread that is still in a live work state such as `editing`, `running`, `validating`, `scanning`, `thinking`, `planning`, `delegating`, or `blocked` should keep its workstation even if short-lived freshness/current signals dip between polls.
- Workstation release should be conservative. Ordinary poll jitter, UI rerenders, debug toggles, or temporary freshness gaps must not pull a still-working agent off a desk.
- A workstation should only be released when the thread has actually settled into a resting/finished state according to the browser placement rules.
- The rec area should keep at most the 4 most recent lead sessions visible.
- Finished subagents should despawn instead of taking rec-area slots.
- Empty rooms should read as quiet space, not as errors.

### Scene layout and tiles

- The office floor should use a tile grid as its primary layout system.
- Rooms from `.codex-agents/rooms.xml` define the outer floor bounds; internal furniture/layout is then placed on a tile grid inside those room bounds.
- The grid starts at the end of the wall band and continues through the whole visible floor area to the bottom of the room.
- The renderer may scale tiles to fit available width, but object placement should stay grid-derived rather than free-floating.
- Some prefabs can span multiple tiles; the layout contract is based on tile spans, not only `1x1` occupancy.
- The tile system should preserve stable desk slots so agents do not repack across the room on routine live updates.
- Existing seated agents keep their assigned desk slot unless occupancy truly changes enough to force a new allocation.
- New active agents should take the next available desk slot; they must not steal an already-occupied stable slot from another live agent during an ordinary update.
- Resting agents in the rec area should keep stable sofa/wall-side seats by agent identity instead of being reassigned purely by sorted array index.
- Z-order should be explicit and deterministic so floor bands, furniture, agents, effects, and toasts stack consistently.
- Agent movement in the retained browser scene should follow walkable tile paths instead of straight-line tween resets.
- Tile pathfinding should avoid occupied cells from furniture, workstation footprints, and already-seated agents.
- Visual-only updates such as debug overlays, text-scale changes, or scene host rerenders must not be treated as a new placement instruction.

### Scene settings model

- Scene settings are split into internal settings and global user settings.
- Internal settings define prefab and layout behavior that should not be user-configurable yet.
- Global settings define viewer-facing controls that should apply consistently across the browser office.

Internal settings should include at least:

- base tile size
- compact tile size
- boss booth size
- desk pod size
- desk pod capacity
- desk-area start ratio
- wall-depth / top-band depth
- space between related-work cubicle groups
- space between desk columns
- rec-area top row and walkway row
- maximum rec-area depth from the top of the grid

Current internal tile rule:

- base tile size is fixed at `16px`
- compact tile size is also fixed at `16px`
- the browser may scale the whole scene for fit, but grid math and prefab footprints are defined in `16px` tiles

Global user settings should currently include:

- text scale for toasts, hover cards, and browser-office text

Global text scale rules:

- allowed range is `0.75x` through `2.00x`
- default is `1.00x`
- it should scale browser map text, toast text, and tooltip/hover text together
- it should not change internal prefab geometry or room assignment rules

### Fleet behavior

- Default browser deploys should run in fleet mode.
- Fleet mode should keep every discovered workspace live.
- The selected workspace changes browser focus only; it does not change the monitor set.
- `/api/server-meta` must report the live bound fleet project set, not only startup seed projects.

### Boss / lead behavior

- Lead sessions with active subagents can use the slimmer left lead lane.
- This lane should stay visually lighter than a large boxed office.
- Boss-to-subagent relationships may be shown on hover, but they should stay secondary to desk occupancy and scene motion.
- Boss booth size should come from internal tile settings rather than per-renderer pixel literals.

### Desk spacing and grouping

- A desk pod is the basic active-work prefab and should keep a stable tile footprint.
- Related work should stay visually grouped by cubicle/workstation group before spilling into a new column.
- Space between related-work cubicle groups should stay tighter than space between major desk columns.
- The current internal defaults are:
  `space between cubicle groups = 1 tile`
  `space between columns = 4 tiles`
- Single-agent occupancy may collapse to a centered seat inside the same pod footprint instead of creating an empty mirrored station.
- Within a two-seat pod, left/right seat choice should remain stable for an already-seated agent whenever possible.

### Rec-area placement

- The rec strip belongs on the upper floor band, not as a detached inset room.
- Rec-area furniture should start on the first row of the tile grid.
- Rec-area furniture should not extend deeper than 2 tiles from the start of the floor grid.
- Waiting and resting agents can occupy the walkway / wall-side slots beneath that first furniture row.
- The rec strip should use the same PixelOffice object language as the work floor: vending, shelf, sofa, counter, plants, doors, and wall props.
- Sofa placement is furniture-relative. If the sofa moves, the derived idle/rest seats move with it.
- Rec-room seat stability matters more than strict most-recent sorting once an agent is already visibly seated; ordinary updates should not create a visible shuffle party.

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
- browser workstation seating may be intentionally stickier than raw `isCurrent` so live local work states do not thrash between desk and rec area during polling gaps

## Notifications and toasts

- File changes, commands, approvals, input waits, turn lifecycle events, and useful reply text should surface as toasts.
- Command-window toasts should aggregate per agent instead of stacking duplicates.
- Keep one command toast per agent, append new command lines at the bottom, and cap it at 3 visible lines.
- Read-like shell actions such as `sed`, `cat`, `rg`, `ls`, `find`, and `tree` should collapse into short summary toasts instead of echoing raw commands.
- Final reply text should not disappear just because command/read toasts also happened on the same thread.
- Agent-anchored toasts should track the agent root while the agent is moving, instead of staying frozen at the original spawn point.

## Visual expectations

- The office map should communicate state mostly through motion, placement, hover cards, and the session panel.
- Entering, leaving, and seat-change movement should read as short routed walks across the floor, not teleports between idle and desk states.
- Ordinary polling or view refresh must not look like movement. If a destination did not meaningfully change, the agent should keep its current placement.
- Avoid large task-title overlays inside the room scene.
- Keep Codex-native typed state visually distinct from inferred Claude state when provenance matters.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
- Exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled intentionally from the asset sheet, not from a pasted example scene.
- Tile translation should preserve the feel of the existing PixelOffice scene language even when exact pixel-for-pixel placement is relaxed.
- Temporary placeholder geometry is acceptable during development, but not as the final renderer language.

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
