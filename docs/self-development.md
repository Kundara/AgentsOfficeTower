# Self Development

## Product bar

This project should answer one glance-level question well:

`What is Codex working on right now?`

A good iteration improves at least one of these:

- accuracy of current workload detection
- clarity of session-to-room mapping
- readability of the office scene
- confidence that web, CLI, and VS Code reflect the same state model

## Current design principles

- Current workload first, history second.
- Workspace tabs should mirror Codex workspaces, not arbitrary local folders.
- Parent sessions are the primary actors.
- Subagents should visually attach to their parent session and role cluster.
- Room visuals should stay legible without text banners pasted over the scene.
- High-level transparency should stay inside the office scene when possible, using motion, placement, hover cards, and session detail instead of detached dashboard slabs.
- Decorative art must not obscure agent state.

## Current technical priorities

1. Keep the shared adapter registry and snapshot assembler authoritative across all front ends.
2. Improve real session discovery before inventing synthetic presence.
3. Increase event-level transparency so visible state is traceable to real Codex signals.
4. Continue breaking the remaining large source-specific sections into smaller adapter/service/domain helpers.
5. Preserve enough structure in the scene that busy workspaces still scan quickly.
6. Keep shrinking the largest browser/runtime section files now that the shipped browser entry runs through generated `app-runtime.ts` output, `runtime-source.ts` is only a composition mirror, and desk policy has been isolated into `seating-source.ts`.

## Known weak spots

- Codex desktop session visibility is much stronger now, but desktop-backed observer attaches can still be slow enough to leave a restarted server temporarily read-only before subscription settles. The read-only fallback now preserves fresh `thread/list` timestamps when `thread/read` lags and uses fresh non-final local work events to keep active threads desk-seated, but subscription recovery should still be watched on restart.
- Claude support still falls back to transcript inference when no project-scoped hook sidecars are configured in Agents Office user data.
- OpenClaw support is currently workspace-path exact-match only, so broader OpenClaw workspaces do not yet project into per-repo office floors.
- Cursor local support is inferred from workspace storage and logs rather than coming from an official local session API, so it remains weaker and less explicit than Codex app-server visibility.
- PixelOffice workstation composition still needs refinement and stricter prefab rules.
- Most Codex event types now reach the snapshot as explicit events, but many of them still share the same notification/motion treatment.
- Room empty states are still visually heavier than ideal.
- Live movement is still simpler than the intended office-life simulation.
- Map and terminal browser views still share some presentation assumptions that should diverge further.
- The office map now renders through a retained Pixi scene; remaining work is about refining prefab composition, motion, and editor parity rather than migrating off the old HTML map path.
- The browser runtime is now externally bundled and executes through generated `app-runtime.ts` output sourced from the focused runtime sections. Ownership is cleaner than before because desk policy lives in `seating-source.ts` and renderer/session boundaries no longer spill partial functions across files, but large sections such as scene/layout still need continued extraction into smaller authored browser-native modules.

## Acceptance checks for future changes

- `npm run build`
- `npm run typecheck`
- browser render for default map mode
- browser render for `/scene-effects-audit`
- browser render for terminal mode
- verify default `web --port 4181` launch stays in fleet mode and does not pin to the current cwd
- browser render for explicit `web /abs/project/path` launch
- `demo preview` creates a disposable workspace, serves it, and removes it when the run ends
- verify workspace tabs show real Codex workspaces
- verify explicit project launch stays pinned to the requested project roots
- verify Claude-discovered projects do not displace explicit Codex project roots when the CLI pins roots
- verify no large task-title overlay is rendered inside the room scene
- verify active agents are visibly placed at workstations, not floating below them
- verify a single active agent does not spawn an empty mirrored workstation
- verify waiting/needs-you agents stay at desks while resting/recent-finished lead sessions use the Rec Room
- verify a local Codex thread that app-server still reports as `status.type = "active"` stays on-desk even if its summarized state currently reads waiting, blocked, or recently done
- verify desk layout remains grid-derived and stable across live updates instead of repacking on ordinary state changes
- verify a newly active agent takes a free desk instead of stealing an already-occupied stable seat from another live agent
- verify resting/rec agents do not reshuffle seats on ordinary live updates
- verify visual-only updates such as debug overlays do not trigger desk/recside movement
- verify resting rec-area provider trips stay relatively rare instead of firing every few seconds
- verify resting rec-area walks visibly read slower than active desk-work travel
- verify provider approach offsets let resting avatars visually reach vending/cooler/shelf furniture while their foot collider still stays on the walkable row
- verify held items render from the shared 16px-base sizing rule plus the global held-item scale, instead of inheriting arbitrary raw source image dimensions
- verify selected-workspace and focused single-workspace map views keep the same compact avatar/workstation/pod geometry as the tower overview instead of swapping to a separate scale profile
- verify a restarted fleet server eventually recovers the current desktop thread to `liveSubscription = subscribed` instead of leaving it stuck in `readOnly`
- verify a restarted fleet server does not settle on historical Codex rows only; the actually current desktop thread must reappear as current/ongoing after warmup, even when it is temporarily `readOnly`
- verify a desktop-backed thread stays current when `thread/list` reports fresh activity but `thread/read` returns a stale transcript timestamp
- verify a restarted fleet server keeps the active desktop thread on-desk from fresh non-final command/file/tool activity even if the observer is temporarily `readOnly` and app-server status is `idle`
- verify a just-sent prompt on a desktop `notLoaded` thread with no readable turns reserves a desk for about 8 seconds, while the same stale fallback no longer reads active several minutes later
- verify `thread/closed`, non-final `turn/completed`, and non-final `turn/interrupted` notifications do not move an active session back to the rec area between assistant updates
- verify a fresh read-only `notLoaded` Codex thread without a final answer stays workstation-seated through quiet text gaps
- verify a stopped top-level Codex lead keeps its workstation for about 3 seconds, then cools into rec-room visibility
- verify delayed first hydration from the Codex app-server does not replay stale replies as fresh toasts or trigger late doorway-entry motion for historical Codex agents
- verify rec-strip furniture starts on the first floor-grid row and does not exceed 2 tiles of depth from the top band
- verify desk pods start on tile columns and their workstation seat cells remain aligned to the same grid contract as rec-strip furniture
- verify global text scale changes hover/toast/map text without changing room geometry or desk assignment
- verify approval, input-wait, file-change, command-run, and turn lifecycle states have clear visible notification paths
- verify recent typed `turn/started`, `turn/completed`, `turn/interrupted`, and `turn/failed` events raise distinct short above-head badges in the map scene
- verify recent typed plan, command, file/diff, and tool-call events raise short animated `PLAN`, `RUN`, `EDIT`, and `TOOL` cues in the map scene
- verify typed approval waits, input waits, and resolved request clears raise short animated `WAIT`, `ASK`, and `OK` cues in the map scene
- verify activity/request cue chips keep mode-specific iconography and icon-side motion instead of collapsing back to plain text-only pills
- verify recent typed workstation activity also raises a short mode-specific non-text desk effect instead of relying only on the floating cue chip
- verify approval waits and input waits expose some of their request structure in-scene, such as decision breadth or question/required load, instead of sharing one generic workstation pulse
- verify waiting desk work pulses in-place, blocked desk work shakes subtly, and validating desk work uses a brighter pulsing workstation glow
- verify planning/scanning/editing/running/validating/delegating desk work no longer share one generic seated bob
- verify a visible room change renders as an old-room doorway exit plus a destination-room doorway entry instead of retargeting one sprite across rooms
- verify tiny same-slot refresh deltas do not trigger visible rerouting or seat jitter
- verify the Settings hat picker applies immediately to all local agents without showing file names, and that the first slot cleanly renders as `no hat`
- verify shared-room peers keep their own selected hats after fleet merge instead of inheriting the local viewer's hat choice
- verify the browser session panel exposes the durable approval/input "needs you" queue
- verify typed `tool/requestUserInput` queue prompts keep `Send` disabled until every required question has an answer, then resolve cleanly back to app-server
- verify clicking a local Codex agent in the map opens a read-only thread history card with no reply, resume, launch, or copy controls, and closes cleanly on outside click / `Escape`
- verify hovering the same agent while its thread card is open does not reopen the ordinary hover tooltip over the card
- verify Claude-derived sessions are visibly marked as inferred in hover/session detail
- verify Claude hook-backed sessions are visibly marked as typed rather than inferred when the matching project-scoped Claude hook sidecar exists in Agents Office user data
- verify hook-backed Claude `PermissionRequest` waits can be accepted/declined from the browser queue and clear immediately through the local response-file bridge
- verify hook-backed Claude `Elicitation` waits render schema-backed questions, ignore optional unanswered fields, and clear immediately after browser submit
- verify OpenClaw gateway sessions appear only for projects whose normalized root matches the configured OpenClaw agent workspace
- verify OpenClaw sessions preserve parent-child structure through the shared `parentThreadId` hierarchy
- verify inferred local Cursor sessions appear for repos that Cursor has opened locally and are marked as inferred in hover/session detail
- verify Cursor hook-backed local sessions are visibly marked as typed when the matching project-scoped Cursor hook sidecar exists in Agents Office user data
- verify Cursor background agents appear only for repos whose normalized `remote.origin.url` matches the selected project
- verify Cursor API-backed sessions are visibly marked as typed rather than inferred in hover/session detail

## Near-term roadmap

- keep extending the typed event-to-motion mapping beyond the current turn badges, cue chips, workstation pulses, and request-structure signatures
- keep tightening browser action affordances around typed local Codex waits, especially richer queue UX for multi-question inputs
- decide whether Cursor hook sidecars should also capture `beforeReadFile` and Tab-specific events or stay focused on Agent-only workload visibility
- decide whether OpenClaw needs broader workspace containment rules beyond exact workspace-root equality
- tighten the workstation prefab using only the intended PixelOffice station slices
- improve side-facing avatar placement and interaction poses
- refine empty-room presentation
- keep refining movement beyond doorway entry/exit so more typed `turn/*` and `item/*` events read as explicit in-scene action instead of generic travel
- keep hardening seat ownership and rec-seat stability for larger live bursts, especially when many rooms or workspaces refresh together
- verify live toast styling remains readable when browser zoom is reduced
- keep command-window aggregation readable when several commands arrive quickly for the same agent
- keep the retained Pixi scene stable across scene refreshes with predictable entity ids, z-order, and incremental updates
- keep user-facing scene controls minimal and global, starting with text scale, while prefab sizing and spacing remain internal until furniture editing exists
- finish translating the previous office look into the tile system so the retained scene feels like the established PixelOffice floor instead of temporary placeholder geometry
- replace the remaining large runtime section literals with smaller generated fragments or real browser-native modules while preserving the now-clean section ownership boundaries
- keep the new file-size and import-boundary rails strict enough to block new monoliths while allowing the remaining transitional browser runtime to shrink incrementally; generated `app-runtime.ts` should stay out of the authored-source size budget, and any temporary ceilings for oversized authored runtime/style files should stay explicit and narrow

## Not the goal

- full transcript replay inside the room scene
- replacing the Codex thread UI
- using decorative pixel art that weakens status clarity
