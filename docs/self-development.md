# Self Development

The phased execution roadmap, decision log, and open product questions live in [docs/product-plan.md](./product-plan.md). This file stays focused on the standing product bar, design principles, and acceptance checks that every iteration must satisfy.

## Product bar

This project should answer one glance-level question well:

`What are my agents working on right now?`

A good iteration improves at least one of these:

- accuracy of current workload detection
- clarity of session-to-room mapping
- readability of the office scene
- confidence that web, CLI, and VS Code reflect the same state model

## Current design principles

- Current workload first, history second.
- Workspace tabs should mirror real discovered agent workspaces, not arbitrary local folders.
- Parent sessions are the primary actors.
- Subagents should visually attach to their parent session and role cluster.
- Room visuals should stay legible without text banners pasted over the scene.
- High-level transparency should stay inside the office scene when possible, using motion, placement, hover cards, session detail, and compact surfaces like the Ops Wall instead of detached dashboard slabs.
- Decorative art must not obscure agent state.

## Current technical priorities

1. Keep the shared adapter registry and snapshot assembler authoritative across all front ends.
2. Improve real session discovery before inventing synthetic presence.
3. Increase event-level transparency so visible state is traceable to real provider signals.
4. Split the remaining oversized Claude and Hermes provider façades into one-way `*-lib` dependency DAGs while preserving their public exports.
5. Preserve enough structure in the scene that busy workspaces still scan quickly.
6. Keep shrinking the largest browser/runtime section files now that the shipped browser entry is assembled in memory, dead runtime/style mirrors are gone, and desk policy has been isolated into `seating-source.ts`.

## Known weak spots

- Codex desktop session visibility is much stronger now, but desktop-backed observer attaches can still be slow enough to leave a restarted server temporarily read-only before subscription settles. The read-only fallback now preserves fresh `thread/list` timestamps when `thread/read` lags and uses fresh non-final local work events to keep active threads desk-seated, but subscription recovery should still be watched on restart.
- Claude support still falls back to inferred transcript/workflow state when no project-scoped hook sidecars are configured in Agents Office user data. Local workflow/subagent files now expose child rows without hooks, but they remain weaker than typed hook/team metadata.
- OpenClaw support now seats configured child workspaces under known project roots and floats unmatched active Gateway sessions as roaming orchestrators, but live Gateway validation should still watch for unexpected floor spam from broad harness roots.
- Cursor local support is inferred from workspace storage and logs rather than coming from an official local session API, so it remains weaker and less explicit than Codex app-server visibility.
- PixelOffice workstation composition still needs refinement and stricter prefab rules.
- Most Codex event types now reach the snapshot as explicit events or diagnostic notes, and `npm run check:codex-protocol` catches app-server method drift, but many event categories still share the same notification/motion treatment.
- Room empty states are still visually heavier than ideal.
- Live movement is still simpler than the intended office-life simulation.
- Map and terminal browser views still share some presentation assumptions that should diverge further.
- The office map now renders through a retained Pixi scene; remaining work is about refining prefab composition, motion, and editor parity rather than migrating off the old HTML map path.
- The browser runtime is externally bundled from focused runtime sections through an in-memory build entry. The tracked generated mirror is gone; scene model/renderer, navigation pathing/overlays/floating/Pixi/lifecycle/furniture/attention, and notification CSS now have explicit ownership. Pure helpers are moving to typed browser-native modules, while the retained Pixi renderer closure still needs gradual typed conversion.
- `claude.ts`, `hermes.ts`, `ui-source.ts`, and `styles.css` still use narrow transitional ceilings above the normal source-size rail. Their next safe splits are structural rather than mechanical: records/identity/activity/local-state/session loading for Claude; session semantics/project resolution/hooks for Hermes; session rendering/refresh orchestration for the browser UI; and shell/session/form groups for the stylesheet. Extracted modules must keep one-way ownership and must not import their façade.

## Acceptance checks for future changes

- `npm run build`
- `npm run typecheck`
- `npm run check:agent-workflows` when changing `.codex`, `.agents/skills`, `AGENTS.md`, or the agent workflow guide
- `codex features list` after changing project Codex configuration
- `npm run check:codex-protocol` when validating against an installed Codex runtime
- browser render for default map mode
- browser render for `/scene-effects-audit`
- browser render for terminal mode
- verify default `web --port 4181` launch stays in fleet mode and does not pin to the current cwd
- verify Hermes discovery can add a workspace only from a live Hermes process cwd or the latest current root of a fresh hook session, not from old DB history or every path the session touched
- verify Hermes discovery ignores exact transient system roots such as `/tmp`, `/var/tmp`, and `/dev/shm`, even when they contain temporary `.git` metadata
- verify Hermes workstation agents use durable SQLite session ids and do not expose hook-only ids such as `hermes:default`, `hermes:process-<pid>`, or `hermes:<uuid>`
- verify Hermes fleet reads stay bounded by checking `/api/fleet` response size and web-process memory after repeated refreshes against live hook files
- verify out-of-workspace Hermes sessions appear only as floating `hermes:roaming` agents in the fixed left-side sky layer, not inside a floor scene
- verify Hermes sessions leave a desk and become projectless after more than 20 rootless hook actions, then fly back from the sky layer when a known project root appears again
- verify the same Hermes session moving between two known workspace floors creates a short fixed-layer transfer ghost between desk hit rects, without creating duplicate durable Hermes agents
- verify active Hermes command/tool sessions keep the command or tool in `detail` / `activityEvent` while `latestMessage` remains Hermes assistant/subagent text only, not the user prompt or command text
- verify Hermes cron runs appear as temporary `hermes:cron` agents with compact project tick labels, not raw cron ids or scheduled-job wrapper prompts
- verify long Hermes hook streams still retain enough recent context to recover earlier conversation text after many tool calls
- verify generic Hermes maintenance prompts do not replace the prior useful message in hover cards, session cards, or `web query` output
- when validating Hermes fleet behavior, inspect `/api/server-meta` and `/api/fleet` with short timeouts and stop the listener immediately if unexpected workspace floors spike
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
- verify `thread/closed`, non-final `turn/completed`, non-final `turn/interrupted`, and observer `notLoaded` rereads without a final answer do not move an active session back to the rec area between assistant updates
- verify monitor-tracked `isOngoing` Codex threads stay workstation-seated through quiet text gaps even when their latest read-only `notLoaded` payload is stale
- verify a stopped top-level Codex lead keeps its workstation for about 3 seconds, then cools into rec-room visibility
- verify delayed first hydration from the Codex app-server does not replay stale replies as fresh toasts or trigger late doorway-entry motion for historical Codex agents
- verify nested multi-agent v2 subagents remain visible with their recursive ancestor chain and render at `0.75 ** depth` avatar scale
- verify boss-to-subagent hover arrows appear for both boss-office leads with multiple visible children and ordinary-workstation leads with a single visible child
- verify rec-strip furniture starts on the first floor-grid row and does not exceed 2 tiles of depth from the top band
- verify desk pods start on tile columns and their workstation seat cells remain aligned to the same grid contract as rec-strip furniture
- verify global text scale changes hover/toast/map text without changing room geometry or desk assignment
- verify approval, input-wait, file-change, command-run, and turn lifecycle states have clear visible notification paths
- verify the Ops Wall shows decayed hottest script/doc/media file changes from real typed events, cools quiet changes naturally, and excludes tool/command activity from the hot-stuff board
- verify the primary room wall dashboard stays subtle, title-free, and animates file leaderboard row changes without becoming a detached admin panel
- verify `web query <repo> gist` returns the same hot-change signal plus active-agent last message and last file change as a light state sync before deeper `recent` / `last` reads
- verify recent typed `turn/started`, `turn/completed`, `turn/interrupted`, and `turn/failed` events raise distinct short above-head badges in the map scene
- verify recent typed plan, command, file/diff, and tool-call events stay on toast/event, hover, and session-history surfaces without raising mock-style `PLAN`, `RUN`, `EDIT`, or `TOOL` labels in the map scene
- verify patch-update, MCP-progress, terminal-interaction, and hook-run notifications land in the same event/history paths as their corresponding file, tool, command, and hook activity
- verify global app-server warnings, MCP startup/login failures, rate-limit notices, and Windows sandbox warnings appear as notes/status rather than silently disappearing
- verify unsupported `item/tool/call` dynamic-tool requests receive an explicit unsuccessful response instead of leaving the Codex turn pending
- verify typed approval waits, input waits, and resolved request clears raise short animated `WAIT`, `ASK`, and `OK` cues in the map scene
- verify request lifecycle cue chips keep mode-specific iconography and icon-side motion instead of collapsing back to plain text-only pills
- verify recent typed workstation request activity also raises a short mode-specific non-text desk effect instead of relying only on the floating cue chip
- verify approval waits and input waits expose some of their request structure in-scene, such as decision breadth or question/required load, instead of sharing one generic workstation pulse
- verify waiting desk work pulses in-place, blocked desk work shakes subtly, and validating desk work uses a brighter pulsing workstation glow
- verify planning/scanning/editing/running/validating/delegating desk work no longer share one generic seated bob
- verify a visible room change renders as an old-room doorway exit plus a destination-room doorway entry instead of retargeting one sprite across rooms
- verify tiny same-slot refresh deltas do not trigger visible rerouting or seat jitter
- verify the Settings hat picker applies immediately to all local agents without showing file names, and that the first slot cleanly renders as `no hat`
- verify shared-room peers keep their own selected hats after fleet merge instead of inheriting the local viewer's hat choice
- verify shared-room projects default to not shared, inactive shared projects are not broadcast, active peer work can temporarily restore a weekly-hidden project as a remote-only floor, and switching a project off removes that floor without an additional project cooldown
- verify the browser session panel exposes the durable approval/input "needs you" queue
- verify typed `tool/requestUserInput` queue prompts keep `Send` disabled until every required question has an answer, then resolve cleanly back to app-server
- verify clicking a local Codex agent in the map opens a read-only thread history card with no reply, resume, launch, or copy controls, and closes cleanly on outside click / `Escape`
- verify hovering the same agent while its thread card is open does not reopen the ordinary hover tooltip over the card
- verify agent and hot-stuff hover cards render above the scrollable scene viewport without clipping at desktop and narrow browser widths
- verify Claude-derived sessions are visibly marked as inferred in hover/session detail
- verify Claude hook-backed sessions are visibly marked as typed rather than inferred when the matching project-scoped Claude hook sidecar exists in Agents Office user data
- verify hook-backed Claude `PermissionRequest` waits can be accepted/declined from the browser queue and clear immediately through the local response-file bridge
- verify hook-backed Claude `Elicitation` waits render schema-backed questions, ignore optional unanswered fields, and clear immediately after browser submit
- verify Claude Agent/Task tool calls plus `TaskCreated`, `SubagentStart`, and `SubagentStop` hook records produce shared delegated-work activity and `subagent` dashboard events while preserving Claude provenance
- verify Claude hook records with `agent_id` create child agent rows under the lead Claude session, and that Agent Teams config files create teammate child rows plus cowork/worktree project floors
- verify local Claude workflow/subagent transcripts, matching `*.meta.json`, and workflow `journal.jsonl` records create inferred child agent rows under the lead Claude session without hook sidecars
- verify Claude workflow journal `started` records create running child rows before a transcript has useful assistant text, and journal `result` records mark the matching child done with the result summary
- verify hook-backed Claude `agent_id` rows override matching inferred workflow/subagent rows instead of duplicating the child
- verify Claude Agent View background jobs under `~/.claude/jobs/*/state.json` appear as read-only `claude:background` agents and workspace floors without requiring project hooks
- verify locally materialized Claude Home work projects under the legacy `local-agent-mode-sessions` store appear as workspace floors with read-only Claude agents and recent detected-file activity
- verify a sanitized `product:cowork-remote` Claude Desktop watch-cache fixture and a real existing remote Home-work session each appear exactly once in Chat Café and Sessions, remain read-only/private, and age out of false live state without retaining prompts or messages
- verify Codex Quick Chat creates no synthetic row before **Add to task**, then the converted Codex task appears exactly once through the supported app-server inventory
- verify Claude Code dynamic workflow / `ultracode` runs with a real `/workflows` sample and that local child transcripts/journals match the inferred child rows; if full phase/token progress is needed, prototype an OpenTelemetry collector instead of expanding transcript scraping
- verify OpenClaw gateway sessions appear on desks only when the configured agent workspace equals a known project root or sits under it
- verify unmatched active OpenClaw harness/orchestrator sessions appear as `openclaw:roaming` avatars in the fixed left-side sky layer, stay out of room/rec placement, and animate desk/sky or cross-floor handoffs without duplicate agents
- verify OpenClaw sessions preserve parent-child structure through the shared `parentThreadId` hierarchy
- verify inferred local Cursor sessions appear for repos that Cursor has opened locally and are marked as inferred in hover/session detail
- verify Cursor hook-backed local sessions are visibly marked as typed when the matching project-scoped Cursor hook sidecar exists in Agents Office user data
- verify Cursor background agents appear only for repos whose normalized `remote.origin.url` matches the selected project
- verify Cursor API-backed sessions are visibly marked as typed rather than inferred in hover/session detail

## Near-term roadmap

- keep extending the typed event-to-scene mapping beyond the current turn badges, cue chips, workstation pulses, request-structure signatures, and Ops Wall summaries
- keep tightening browser action affordances around typed local Codex waits, especially richer queue UX for multi-question inputs
- decide whether Cursor hook sidecars should also capture `beforeReadFile` and Tab-specific events or stay focused on Agent-only workload visibility
- decide whether OpenClaw needs provider-specific harness/root discovery beyond the current workspace containment plus roaming-orchestrator behavior
- tighten the workstation prefab using only the intended PixelOffice station slices
- improve side-facing avatar placement and interaction poses
- refine empty-room presentation
- keep refining movement beyond doorway entry/exit so more typed `turn/*` and `item/*` events read as explicit in-scene action instead of generic travel
- keep hardening seat ownership and rec-seat stability for larger live bursts, especially when many rooms or workspaces refresh together
- verify live toast styling remains readable when browser zoom is reduced
- keep command-window aggregation readable when several commands arrive quickly for the same agent
- keep the retained Pixi scene stable across scene refreshes with predictable entity ids, z-order, and incremental updates
- keep user-facing scene controls minimal: text scale remains global, while scoped workspace appearance controls may expose Floor/Wall/Board colors; prefab sizing, spacing, and furniture geometry remain internal until a deliberate editor exists
- finish translating the previous office look into the tile system so the retained scene feels like the established PixelOffice floor instead of temporary placeholder geometry
- replace the remaining large runtime section literals with smaller generated fragments or real browser-native modules while preserving the now-clean section ownership boundaries
- keep the file-size and import-boundary rails strict enough to block new monoliths while allowing the remaining transitional browser runtime to shrink incrementally; any temporary ceilings for oversized authored runtime/style files should stay explicit and narrow

## Not the goal

- full transcript replay inside the room scene
- replacing the Codex thread UI
- using decorative pixel art that weakens status clarity
