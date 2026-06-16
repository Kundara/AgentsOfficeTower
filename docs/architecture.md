# Architecture

## Goal

Render Codex work as a room-based "agent office" without depending on private internals. The current pass keeps the official Codex integration surface and renders active workload as room-based office stations built from PixelOffice assets.

Behavior and renderer expectations now live in [docs/spec.md](./spec.md). This file stays focused on system structure and module boundaries.

## Codex hook strategy

The detailed hook inventory now lives in [docs/integration-hooks.md](./integration-hooks.md). This file stays focused on architecture and product shape.

1. `codex app-server`

   Official docs describe `thread/start`, `thread/list`, `thread/read`, and a live notification stream for `turn/*`, `item/*`, approvals, command execution, and file changes. That makes it the best local integration surface for CLI, IDE, and app-originated threads.

   In this codebase, that still means we need a runnable Codex executable. We prefer `codex` on `PATH`, allow `CODEX_CLI_PATH` overrides, fall back on native Windows to `wsl.exe --exec codex` when the CLI is only installed inside WSL, fall back to the macOS app bundle binary when present, and on Windows can extract the Store app's packaged `codex.exe` into a local cache and run that copy. When both native/WSL CLI and app runtimes exist, CLI still decides unless the override is set.

   The app-server protocol is version-specific, so this repo also includes `npm run check:codex-protocol`. That check regenerates the installed `codex app-server generate-ts --experimental` bindings into a temporary directory and compares the server notification/request method set against the reviewed allowlist.

   Source: [App Server](https://developers.openai.com/codex/app-server)

2. `codex cloud list --json`

   Codex web/cloud tasks are exposed through the CLI cloud surface. That gives us a supported way to surface web tasks next to local sessions.

   Source: [Codex web](https://developers.openai.com/codex/cloud)

3. Claude local session logs

   `~/.claude/projects/*.jsonl` and per-session `subagents/` JSONL files are usable secondary sources for project discovery, recent Claude activity, and workflow-managed child rows. They are not equivalent to Codex app-server: the data is transcript-like and requires inference. That makes them suitable as a best-effort adapter layer, not as the primary truth source.

4. Claude Agent View background jobs

   Claude Code Agent View persists background-session state under `~/.claude/jobs/<id>/state.json`. Agents Office treats that as a passive typed source for read-only background Claude rows and project-floor discovery. It is still weaker than Codex app-server because the documented state file is for Agent View rows, not a complete live event stream or workflow-subagent protocol.

5. OpenClaw gateway sessions

   OpenClaw exposes an official Gateway control plane with agent-scoped sessions, session hierarchy, system presence, and agent workspace config. The current adapter treats that as a typed secondary source for session and workspace visibility, then maps configured agent workspaces back onto discovered office projects.

6. Cursor cloud agents

   Cursor exposes an official cloud-agent API with account-level agent status, target URLs, conversation history, webhooks, and model listing. The current adapter matches those agents back onto the selected project through normalized git remote URLs plus PR-backed repository URLs, so it is official and typed, but still weaker than Codex local app-server visibility.

7. Per-project room config

   Each project can define its own spatial hierarchy in a saved `rooms.xml` file under Agents Office user data, keyed by project root. Rooms map to directory prefixes so the same session can move between rooms as its working files change. Legacy project-local `.codex-agents/rooms.xml` files are still readable as a fallback.

8. Per-project appearance roster

   New sessions get a deterministic random appearance. Overrides are stored in the matching per-project `agents.json` under Agents Office user data, which locks their look until changed.

   In addition to that per-project appearance roster, the browser now has a machine-local hat selection stored in Agents Office user data. That `hatId` is applied to every local agent in the assembled snapshot and is also serialized through shared-room fleet sync so remote peers keep their own hat styling.

8. Codex subagent roles

   Codex ships with built-in subagents such as `default`, `worker`, and `explorer`, and custom agents can define `nickname_candidates` for more readable spawned names. The visual layer groups booths by the underlying role, while still showing the friendlier label when available.

   Source: [Subagents](https://developers.openai.com/codex/subagents)

## Why not only tail JSONL files?

Local session JSONL files are still useful as a fallback, and Codex can persist history/session data and export OTel logs. But app-server gives a cleaner normalized thread/item model first, with approvals and file changes already typed.

The live browser path now uses a hybrid approach:

- `thread/list` and `thread/read` stay authoritative for stable thread state
- when desktop-backed `thread/read` returns a stale transcript timestamp but `thread/list` has already advanced, the monitor preserves the fresher `thread/list` timestamp for current-workload classification
- ongoing occupancy also follows `thread/read` turn state so a `notLoaded` thread with an in-progress turn, or a fresh interrupted turn without a final answer, still stays live on the floor
- recent non-final desktop work events extend the local workload clock even when a restarted observer is still read-only or the app-server reports the top-level thread as idle, preventing active work from cooling into rec-room visibility between reply chunks
- recent file-change events also feed a derived workspace `activity` block on each `DashboardSnapshot`; that block powers the in-scene Ops Wall with decayed hot script/doc/media file scores while tool and command activity stay out of the hot-stuff board
- fresh unhydrated `notLoaded` desktop threads with no readable turns are treated as short-lived planning state for about 8 seconds after a user prompt; the completed read-only fallback is capped to the 3-second finished cooldown so a completed thread does not look active several minutes later
- active `thread/list` rows are always retained in the tracked local-thread set even when they are older than the normal recent-thread cutoff, so a live desktop session is subscribed on startup before its next visible delta
- active and recent threads are resumed on the observer connection so the app can receive live `turn/*`, `item/*`, approval, input, and `serverRequest/resolved` events
- when a resumed/subscribed desktop thread hydrates to a completed or interrupted latest turn that still lacks a `final_answer`, the live monitor promotes it to explicit ongoing state instead of relying on a short freshness fallback
- newer app-server notifications such as patch updates, MCP progress, terminal interaction, hook runs, guardian auto-review, model reroutes, warnings, MCP startup failures, rate-limit notices, and Windows sandbox warnings now normalize either into typed dashboard events or snapshot notes instead of disappearing silently
- if the observer ever receives an `item/tool/call` dynamic-tool server request, it sends an explicit unsuccessful app-server response because Agents Office observes workload but does not execute arbitrary dynamic tools for Codex turns
- observer runtime unload notifications such as `thread/closed` or `thread/status/changed -> notLoaded` are treated as subscription state, not as proof that the underlying thread resolved; a `notLoaded` reread only clears ongoing occupancy when it exposes a final answer
- non-final `turn/completed` and `turn/interrupted` events are treated as update boundaries, not stop signals, so desktop sessions stay desk-owned between assistant progress messages until a final-answer message or hard terminal state arrives
- quiet desk-live local work can remain current for about 3 minutes as a fallback when it has recent non-final activity, is still on a live subscription, or is sitting in a transient `notLoaded` transport state; explicit live-monitor `isOngoing` state is stronger and keeps the workstation until a final answer or hard terminal state
- first-hydration desktop state is now treated as baseline occupancy instead of fresh activity when the thread timestamps are already historical, so delayed observer attaches do not replay stale message toasts or late doorway-entry motion for older Codex sessions
- slow desktop `thread/resume` attaches now happen in the background so the web server does not block initial rendering on them
- desktop-backed `thread/resume` can still take tens of seconds, so the observer keeps a wider 60-second attach budget before it marks that live path degraded and falls back to read-only behavior
- watched thread JSONL paths trigger quick re-reads when a local session changes
- reread desktop rollout threads synthesize message notifications from the newest assistant text when no equivalent recent live message event exists, so a subscribed thread can still toast a final answer if the live terminal notification is missed
- those synthesized assistant-message events keep commentary and other non-final responses as update events; only a `final_answer` assistant message becomes a completion event that can start the short stop cooldown
- streamed `item/agentMessage/delta` notifications stay enabled on the observer connection so Codex reply toasts can update immediately from the typed live feed
- non-final commentary messages on interrupted desktop turns are still treated as active work so subscribed agents do not briefly vacate their desk between commentary updates
- completed process-only items such as `reasoning` or `contextCompaction` now settle out of synthetic `thinking` once the turn is done, so finished desktop threads do not keep reading as active
- process-neutral live states such as `plan` items or in-progress turns without stronger item evidence now map to `planning`, reserving `thinking` for stronger reasoning/commentary/compaction signals
- Cursor local typed hooks now follow the same split where possible, so generic session/tool fallback stays `planning` until Cursor emits clearer reply/reasoning-style evidence
- periodic discovery still runs so newly created sessions appear without a page refresh

In fleet mode, every discovered workspace now keeps a live `ProjectLiveMonitor`. Selection in the UI only changes what is centered in the browser; it does not rebuild the live monitor set.

The observer does attach to resumable threads now, but only for active/recent sessions. The browser can send approval decisions from the `Needs You` queue and local `tool/requestUserInput` answers from inline queue composers back through that same app-server connection. Generic follow-up chat is only browser-actionable for threads owned by the same app-server connection; observed desktop, VS Code, and CLI Codex threads remain view-only because the observer cannot reliably inject a normal chat message into those already-open clients. Their browser action is an explicit terminal handoff that launches `codex resume <thread> [message]` when the local terminal launcher is available.

Hook-backed Claude `PermissionRequest` and `Elicitation` waits are also browser-actionable now, but through a different local bridge: the Agent SDK sidecar hook writes the request into the matching per-project `claude-hooks/<session-id>.jsonl` file under Agents Office user data, waits on a response file under that same project-scoped user-data area, and returns the official structured hook output after the browser answers. Agents Office also appends a synthetic resolution marker into the Claude hook sidecar so the durable queue clears immediately instead of waiting for a later Claude event.

For `tool/requestUserInput`, the verified response payload is keyed by question id:

```json
{
  "answers": {
    "mode": { "answers": ["Fast"] },
    "notes": { "answers": ["Browser path validation."] }
  }
}
```

That shape was verified from `codex app-server generate-json-schema` and then exercised end to end against a mock app-server before documenting it here.

Browser queue gating follows the question schema: required questions must be answered before submit, while optional questions may stay blank and are omitted from the payload.

Sources:

- [Advanced configuration / telemetry](https://developers.openai.com/codex/config-advanced)
- [Configuration reference / history persistence](https://developers.openai.com/codex/config-reference)

## UI shape

- VS Code tab
  - embeds the real browser office renderer inside a webview instead of maintaining a separate simplified room-map implementation
  - starts a local Agents Office web server in fleet mode, seeded from the active workspace, so the panel matches the browser view
  - on Windows with WSL, launches the embedded server via a WSL login shell so Codex picks up `CODEX_HOME` and other expected defaults
  - actions: reload embedded renderer, open embedded office in browser, open/scaffold room XML

- Terminal watcher
  - grouped by room
  - local thread state, last action, resume command
  - cloud task list

- Demo preview harness
  - disposable fake app workspace for visual/testing passes
  - scripted presence timeline with demo agents, demo skills, and room config
  - auto-cleanup on exit unless launched with `--keep`

- Browser mode
  - fleet view across multiple configured project roots
  - fleet mode only keeps autodiscovered workspaces whose session timestamps are no older than 7 days; config-only roots without recent sessions do not stay visible just because the workspace metadata is newer
  - fleet map renders as a continuous tower of workspace floors instead of a stack of separate cards
  - Git-linked worktrees merge onto one repo floor by default, with a global split toggle available when one floor per worktree is more useful
  - deep-linkable single-project room view through `?project=<abs-path>`
  - explicit CLI project roots stay pinned to those roots instead of being replaced by auto-discovered workspace lists
  - live SSE updates for browser clients
  - all discovered workspaces stay live-monitored at once
  - reserved multiplayer status surface for a future secured sync transport
  - browser settings can also attach the page to a shared PartyKit room using `host`, `room`, and an optional short `nickname`; those shared-room credentials now restore from machine-local Agents Office user data on launch, each local floor exposes a persisted default-off `Shared` toggle that controls whether active agents from that project are broadcast into the room without forcing a floor-shell rebuild, and same-machine browser plus VS Code viewers now share one stored multiplayer device identity so self-peers can be ignored cleanly
  - read-only `web query` CLI access to the running local web server for a lightweight `gist` state sync plus bounded `recent` and `last` lookups by repo name, with `local` scope reading the live server fleet and `team` scope reading the latest coordinated shared-room browser cache when available
  - that same Settings popup now includes an image-only left/right hat picker whose selection applies immediately to all local agents and is preserved in machine-local app settings
  - remote shared-room activity now merges client-side only onto matching local workspaces whose local `Shared` toggle is on; inactive remote snapshots and unmatched remote projects stay hidden instead of creating remote-only floors
  - shared-room payloads now also carry the broadcaster's selected `hatId`, so remote peers stay visually distinct without inventing peer-specific palette logic
- map and terminal-style views through `?view=map|terminal`
- live agents only on desks, plus the 4 most recent top-level lead sessions resting in the rec area
- an in-scene Ops Wall sits on the primary room wall between the left edge and door, using a compact title-free 3x3 grid for script/doc/media file changes without adding a separate admin dashboard surface
- local threads remain seated while the thread is still ongoing, even if they pause between visible events or the latest turn already looks done
- session-oriented browser views now also treat local `isOngoing` threads as busy, so quiet in-progress Codex work stays consistent between the map, recent-session lists, and other current-workload summaries
- transient `status.type = notLoaded` unloads now reread before release, and an already observed ongoing local thread only loses ongoing occupancy when that reread finds a final answer
- recent non-final, subscribed, or transiently `notLoaded` desk-live locals still keep their workstation for about 3 minutes as a fallback after the last update, while explicit ongoing locals stay seated without that age cap
- once a top-level thread actually stops, it keeps its workstation for a short 3-second cooldown so the final reply remains readable before it cools into rec-area visibility
- stale local `notLoaded` sessions no longer occupy desks just because they are still recent; workstation seating now requires true ongoing work or the explicit stop cooldown
- after that grace window, only recent top-level lead sessions cool down into the rec area; finished subagents despawn instead of idling there
- stale local Codex subagent rows that still report `status.type = "active"` are dropped out of current workload after about 20 minutes without an in-progress turn or fresh update, so abandoned child rows do not inflate active counts
- lead sessions with active subagents now move into a compact stacked left-side boss-office column, with each boss workstation rendered inside its own small office shell
- spawned subagents render at 75% of their parent depth's avatar size while sharing the same workstation placement, depth sorting, hats, and hover anchors as ordinary desk agents; a depth-2 subagent renders at `0.75 * 0.75` of a lead avatar, and deeper multi-agent v2 trees continue that scale by depth
- local Codex thread selection keeps both ancestor parents and listed descendant subagents for tracked parents, so a visible lead session does not lose child workers just because the child is outside the local display slice
- browser active summary counters group spawned subagents under their lead session; the scene still renders child agents individually, but floor/tab counts describe active lead-session groups
- newly visible subagents use the same room-door entry path as other arrivals; parent/child relationship lines communicate delegation on boss hover for any visible lead/subagent pair, including single-child leads that stay in ordinary workstation layout
- session panel includes a durable cross-project "needs you" queue for approval/input waits
  these entries now come from typed request hooks, not from regexes over session detail
  - session cards expose provenance/confidence so Codex-native, Claude transcript, Claude hook-backed, and Cursor API-backed state stay distinguishable
  - snapshot-only rendering through `?screenshot=1`
  - session-card hover/focus dims unrelated agents so the visible thread cluster for that session stands out in the map
  - HTTP endpoints for snapshot refresh, room scaffolding, and appearance cycling
  - PixelOffice art served from `/assets/pixel-office/...`
  - auto-generated room activity based on the currently mapped agent set
  - repeated workstation rows for repeated Codex agent roles
  - agent-anchored file-change notifications for current agents, showing filename-first copy and available `+/-` line deltas
- shared fleet-only sky backdrop with parallax pixel-cloud layers behind the tower, while individual rooms no longer paint their own cloud mural
- projectless Hermes orchestrators render in that sky as fixed screen-space avatars on the left edge, so they stay outside the building and ignore vertical tower scroll until they regain a workspace desk
- Hermes identity handoff is screen-space when it crosses floor ownership: the fixed layer animates desk-to-sky, sky-to-desk, and known-floor-to-known-floor transfer ghosts from measured DOM hit rects while the Pixi room scenes keep owning settled desk avatars
- hover/session detail surfaces for longer text instead of large scene overlays, while local Codex agents can now open a compact right-edge floor chat panel for recent typed history without routing through the session panel first
- scene hover cards for agents and hot-stuff cells render through a fixed body-level HTML overlay anchored to the Pixi hit target, so they stay above the horizontally scrollable scene host and are clamped to the viewport instead of being clipped by the floor panel
- when a scene-native thread card is open, map hover tooltips are suppressed until the card closes so the reply/history surface does not fight for the same space; resting agents stage slightly left/down while their chat is open, and successful sends create a short desk-work intent until official live state catches up
- the scene chat panel is reconciled by stable thread/message keys instead of being recreated on every fleet refresh, so live text updates do not replay the panel slide-in; only newly appended message bubbles get the short bottom-stack animation, and a bottom-scrolled history stays pinned to the newest content
- browser map layout now derives from a tile-grid settings model instead of renderer-local pixel literals
- internal scene settings define prefab geometry and spacing such as tile size, boss-booth size, desk-pod span, top-band depth, cubicle-group spacing, column spacing, and rec-strip depth
- the scene tile is now a fixed `16px` unit in both normal and compact map modes so grid placement aligns with native PixelOffice asset sizing
- selected-workspace and focused single-workspace rendering reuse the same compact scene prefab geometry as the tower overview; only whole-scene fit scaling changes between those views
- desk-pod origins and the workstation seat cells inside them are expected to stay tile-aligned, matching the same grid contract used by rec-strip furniture
- global browser settings currently expose text scale plus a persisted worktree split toggle; text scale still applies to hover/toast/map text without changing room or prefab geometry
- the retained browser map path now uses a persistent Pixi scene host plus HTML anchor overlays for toast positioning, so map updates can mutate scene entities without replacing the scene shell
- the primary room wall includes a compact scene-native hot-stuff board between the left wall and doorway, built from decayed `activity.hotChanges`; the CLI `gist` command exposes that same hot-change summary alongside active-agent last-message and last-file-change hints for light state sync before deeper reads
- routed avatar movement in the Pixi scene now uses a lightweight grid pathfinder against room occupancy instead of direct straight-line scene tweens
- floor-depth sorting in the Pixi scene now uses explicit logical rows: moving agents sort from their current foot-tile row, while workstation shells and seated avatars sort from the workstation footprint row, so overlap follows the same "lower floor cell stays in front" rule during pass-bys
- exit ghosts now persist across scene refreshes until their doorway walk and fade complete, and room changes split into a doorway exit in the old room plus a doorway entry in the destination room instead of retargeting one live sprite across rooms
- rec-area idle behavior is scene-config-driven: seated flip cadence, provider-trip rarity, resting walk speed, held-item base size, and global held-item scale all come from `packages/web/src/config/scene-definitions.json`
- provider furniture definitions now also carry optional visual approach offsets so resting avatars can keep their 1x1 foot tile on the walkable row while still reaching close to the vending machine, cooler, or shelf sprite
- the current default rec-provider mapping is bookshelf -> `book`, cooler -> `water-bottle`, and vending -> a mixed snack/soda/juice pool

### Web package composition

The web package now separates transport, lifecycle, rendering, and client delivery concerns instead of keeping them in one oversized entry file.

### Core package composition

- `packages/core/src/adapters`
  Defines the shared `ProjectAdapter` and `ProjectSource` contracts plus the built-in source registry for Codex local/cloud, Claude, Cursor local/cloud, OpenClaw, and presence.
- `packages/core/src/snapshot-lib`
  Holds thread summarization and dashboard-building helpers so `snapshot.ts` stays a thin public surface instead of a cross-layer sink.
- `packages/core/src/live-monitor-lib`
  Holds app-server event normalization plus rollout-hook parsing so `ProjectLiveMonitor` keeps orchestration responsibility without also owning every parser.
- `packages/core/src/cursor-lib`
  Holds Cursor local discovery and shared repository normalization helpers so local workspace parsing, cloud API loading, and repo identity are separated.
- `packages/core/src/services`
  Holds cross-cutting orchestration such as project discovery re-exports, refresh scheduling, snapshot assembly, and the live-monitor compatibility surface.
- `packages/core/src/domain`
  Holds workload/currentness policy, derived workspace activity summaries, and other state rules shared across snapshot assembly and tests.
- `packages/core/src/utils`
  Holds small reusable JSON/text helpers extracted from the older source-specific modules.

Snapshot assembly now happens in one place through `SnapshotAssembler`, which merges cached adapter snapshots, applies room mapping once, and evaluates workload currentness against the snapshot start time so slow secondary adapters do not incorrectly evict freshly finished local work.

- `packages/web/src/server/server.ts`
  Starts the HTTP server, wires shutdown, binds before fleet warmup, and delegates everything else.
- `packages/web/src/server/server-options.ts`
  Parses CLI args and normalizes project descriptors.
- `packages/web/src/server/server-metadata.ts`
  Builds startup fleet placeholders and the shared `/api/server-meta` payload shape.
- `packages/web/src/server/fleet-live-service.ts`
  Owns `ProjectLiveMonitor` instances, refreshes the active project set, publishes fleet snapshots, exposes the live bound project list for `/api/server-meta`, persists machine-local browser settings such as Cursor credentials, shared-room config, and selected hat state, exposes disabled multiplayer status for future secured sync work, caches the latest browser-coordinated shared-room fleet for read-only CLI queries, and fans snapshots out over SSE. Fleet-wide cloud task polling still lives here so `codex cloud list` runs once per fleet refresh cycle instead of once per project monitor, with shared backoff when the upstream cloud surface rate-limits. Startup now publishes a placeholder fleet immediately and warms project monitors in the background.
- `packages/web/src/server/router.ts`
  Maps routes to handlers for HTML, static assets, project image previews, fleet/meta APIs, refresh, appearance cycling, machine-local browser settings, read-only web CLI queries, browser-coordinated team-fleet cache updates, and room scaffolding. Fleet meta and home routes now answer immediately from the current in-memory project list instead of blocking on project discovery.
- `packages/web/src/server/web-cli-query.ts`
  Implements the bounded read-only query contract for `web query`: repo matching, local/team source selection, `recent`/`last` commands, agent/event filters, result projection, and shared-data guards.
- `packages/web/src/render/render-html.ts`
  Builds the HTML shell and injects the browser assets.
- `packages/web/src/client/index.ts`
  Bundled browser entrypoint that loads the external client assets and starts the generated browser runtime module against server-injected bootstrap config.
- `packages/web/src/client/app-runtime.ts`
  Generated browser runtime module emitted at build time from the focused runtime section sources so the shipped client no longer relies on `new Function(...)` evaluation.
- `packages/web/src/client/runtime-source.ts`
  Thin browser runtime composition entry that still mirrors the focused runtime section order while the generated `app-runtime.ts` output is the actual shipped browser module.
- `packages/web/src/client/runtime`
  Holds focused runtime sections so browser behavior can be edited by concern instead of by patch order or by one giant client script.
  Current ownership is:
  - `settings-source.ts`: persisted scene settings, furniture overrides, hat catalog helpers, and browser-side settings state bootstrap.
  - `layout-source.ts`: DOM wiring, fleet/workspace selection state, settings UI sync including the hat preview cycler, summary helpers, role grouping, and display-text normalization.
  - `seating-source.ts`: current-workload workstation policy, local grace windows, and rec-room eligibility.
  - `render-source.ts`: cubicle/workstation visual models, notification copy shaping, and display-path formatting.
  - `scene-source.ts`: room-to-scene model assembly, Pixi renderer lifecycle, retained scene orchestration, and hat asset preloading.
  - `navigation-source.ts`: navigation grid, avatar routing, per-avatar Pixi node creation including hats, scene hit-target focus, terminal/fleet summaries, and the durable "Needs You" queue.
  - `ui-source.ts`: browser render loop, DOM patching, fleet ingestion, and session-card rendering.
- `packages/web/src/client/multiplayer-source.ts`
  Holds the browser-side PartyKit room sync overlay, shared-room draft/input behavior, explicit per-project share preferences, active-agent remote fleet merge helpers, and the debounced same-origin post of the already-coordinated shared-room fleet back to the local server for `scope=team` CLI reads.
- `packages/party`
  Holds the deployable PartyKit room relay that validates and rebroadcasts the browser `fleet-sync` payloads over shared room sockets.
- `packages/web/src/client/toast-source.ts`
  Holds browser-side toast queueing, stacking, timing, preview, and DOM rendering so notification behavior does not stay embedded in the main renderer script.
- `packages/web/src/client/styles.css`
  Holds the browser CSS that now builds into `/client/app.css`.
- `packages/web/src/http-helpers.ts`
  Centralizes JSON/body helpers and static/project-file response handling.

This keeps the browser behavior broadly the same, but it stops HTML responses from embedding giant JS/CSS strings, removes brittle runtime string surgery, moves the shipped browser bootstrap onto a generated real module, and gives the repo clearer ownership seams for future client-runtime work.

## Room XML

```xml
<agentOffice version="1">
  <room id="root" name="Project" path="." x="0" y="0" width="24" height="16">
    <room id="src" name="Source" path="src" x="1" y="1" width="11" height="6" />
    <room id="tests" name="Validation" path="tests" x="13" y="1" width="10" height="6" />
  </room>
</agentOffice>
```

`path` is interpreted as a project-relative directory prefix in this first version. Nested rooms allow local hierarchy without inventing a second config format.

## Pixel-agents takeaways

The closest open-source reference is [pixel-agents](https://github.com/pablodelucca/pixel-agents). The useful ideas to keep are:

- a host-specific adapter layer
- room/layout persistence separate from live activity state
- status driven by tool and transcript activity instead of only terminal focus
- lightweight NPC behavior where active agents stay at their desk while idle or blocked agents visibly break formation

The main change here is swapping transcript-only heuristics for Codex app-server + cloud surfaces first.

## Transparency Model

The reader should be able to answer two questions for any visible state:

1. Why is this agent shown as active, waiting, blocked, or done?
2. Which Codex signal caused that representation?

The current implementation already has the right base surfaces:

- thread status from `thread/list` and `thread/read`
- active flags for approval waits and user-input waits
- turn and item history for summarization
- app-server notifications and server requests for live changes
- file-change driven activity events

The browser now carries a stronger event attribution path:

- raw app-server notifications are normalized into snapshot `events`
- server-initiated approval/input requests are normalized into both snapshot `events` and per-agent `needsUser` state
- browser notifications can react to those event-native records directly
- approval and input waits are also surfaced in a durable cross-project "needs you" queue
- Claude-derived sessions are explicitly marked through provenance/confidence metadata so transcript inference and hook-backed state do not read the same
- delegated-agent activity now uses a shared activity family where possible: Codex `collabToolCall` / `collabAgentToolCall` items and Claude Agent/Task/Subagent signals both feed `collabAgentToolCall`-style activity and `subagent` dashboard events

What is still missing is richer motion and posture tied to those events. The product can now explain more of what changed; the next step is making those changes feel more visible in-scene.

## Event-driven notification model

Codex exposes enough signal for a more explicit notification model than the current one.

Current mapping:

- `waitingOnApproval`
  blocked standing-on-desk pose, raised-hand marker, approval-needed toast, and durable needs-you queue entry
- `waitingOnUserInput`
  waiting-on-desk pose, raised-hand marker, ask-user toast, and durable needs-you queue entry
- blocked failures without `needsUser`
  blocked standing-on-desk pose, exclamation marker only for explicit system or failed activity evidence, and failure toast treatment
- waiting desk work now also pulses its `...`/hand cue so active waits still read as live work
- blocked desk work now gets a subtle shake treatment so explicit failures read differently from ordinary seated occupancy
- validating desk work now uses a brighter pulsing workstation glow instead of the generic busy glow
- seated planning/scanning/editing/running/validating/delegating work now uses per-state Pixi micro-motion profiles instead of one shared workstation bob
- head markers now render smaller than the original 16px pass so they sit above the sprite more quietly and stay visually secondary to toasts
- the thinking light is intentionally transient and drops away once the first visible assistant message/toast is present, so speech evidence replaces the generic “still thinking” cue
- recent typed `turn/*` lifecycle events now also render short above-head Pixi badges (`START`, `DONE`, `STOP`, `FAIL`) so turn transitions remain visible even when the toast layer is busy
- recent typed plan, command, file/diff, and tool-call events stay on toast/event, hover, and session-history surfaces rather than rendering duplicate mock-style in-scene labels such as `PLAN`, `RUN`, `EDIT`, or `TOOL`
- typed approval waits, input waits, and `serverRequest/resolved` queue-clear events now also render short `WAIT`, `ASK`, and `OK` cues so the in-scene request lifecycle matches the durable `Needs You` queue
- request lifecycle cues now include mode-specific icon adornments and per-mode icon animation so the scene can differentiate the cue family visually before the user reads the label text
- recent typed workstation request activity now also emits short desk-side Pixi effects keyed to the same cue mode, so approval/input/resolve motion is visible on the station itself instead of only in floating text chips
- approval waits now encode decision breadth and approval type in that workstation effect, while input waits encode question count, required-question load, and schema richness so request shape is visible without opening the queue
- local Codex agents now expose a scene-native click target that opens a single right-edge thread history panel with recent typed thread history. The scene panel is read-only and does not include Send, resume, launch, or copy controls. The card closes with a short slide motion on outside click or `Escape`; long message bubbles clamp to eight lines with a `Show more` toggle, and command-like entries reuse the toast command-window language with event icons
- `item/*` command execution
  running / completed / failed command notifications, rendered as a command-prompt style mini window with monospace command text
  one command window toast is kept per agent; new commands append to the bottom, keep the last 3 lines, and extend the visible lifetime
- read-only shell inspection actions
  short summary toasts such as `Read workload.ts` or `Exploring 2 files`, instead of replaying the full shell command string
- `fileChange`
  agent-anchored create / edit / delete / move toasts, with filename-first copy, optional `+/-` line deltas, and image preview when possible
- shared toast stack model
  command and file-change toasts now use the same stacking and lifetime path, while preserving their distinct visual shells
- message-toast replacement scope
  reply/message toasts can prune older toasts for the same agent/thread so the latest speech stays visible, but they do not clear the global toast list for unrelated agents
- `turn/*`
  turn started / finished / interrupted / failed status transitions
- `webSearch`
  dedicated web-search toast only when a native Codex `webSearch` event reaches the observer; desktop-side search activity that only surfaces as commentary cannot yet be reconstructed into a typed search toast
- subagent spawn and completion
  parent-linked spawn/finish notifications and motion updates
- exact app-server method icons
  toast icons resolve from `/assets/pixel-office/sprites/icons/<method>.svg` when a matching pixel icon exists
- semantic thread-item icons
  generic item fallbacks and the visual audit page resolve from `/assets/pixel-office/sprites/icons/thread-item/*.svg` plus reused exact-method icons where appropriate
- icon audit route
  `/icon-audit` renders the current official thread-item list and every exact method icon for visual inspection
- scene effects audit route
  `/scene-effects-audit` serves the normal client bundle against mocked typed approval/input fleet data so workstation request signatures can be visually validated without waiting for a live `Needs You` case

Remaining roadmap:

- richer request-to-motion coverage for more typed methods beyond the current badges, cue chips, workstation effects, and queue-aware request signatures
- clearer styling differences between typed Codex truth and Claude inference

## Current workstation model

The active office view currently favors an open station language over enclosed cubicles:

- mirrored two-seat workstation pods define the primary desk language
- workstation slots are pinned to a fixed floor grid instead of being repacked when new agents appear
- workstation slot ownership should be sticky across incremental scene updates; a scene rerender or non-positional refresh must not discard prior slot memory
- desk columns start around one-fifth of the room width, leaving room for a compact stacked boss-office column on the left when needed
- each workstation column now uses a single visible cubicle stack with 3 tightly stacked workstation rows so active desks stay inside a standard room height
- role grouping prefers to keep the same agent types inside the same visible workstation stack before spilling into a new column
- a single occupied two-seat pod stays anchored to a real seat cell instead of collapsing to a centered pseudo-seat
- the first occupied seat in a pod defaults to the left seat cell, and a second occupied seat expands into the right seat cell without shifting the first workstation
- newly occupied seats use a short retro blink reveal so the workstation appears before the worker settles
- avatars themselves no longer flash on enter or exit; only the workstation reveal animates, and removals disappear immediately once the thread leaves current workload
- left and right seats face opposite directions inside each pod
- seated agents flip with the workstation direction and align to the desk/chair reach point
- lead-session arrivals and all departures use the center-top room entrance as the path anchor; newly visible subagents start from their parent agent's current scene position before walking to their assigned workstation
- ordinary refreshes now reuse a settled same-slot target when the layout delta is only a tiny no-op drift, so polling does not look like an unnecessary seat shuffle
- finished subagents now keep a longer readable desk cooldown before they walk back out through that doorway instead of vanishing immediately
- lead sessions with active subagents move into a dedicated left-side boss-office column; the column starts one floor tile below the floor start and uses contiguous 3-tile-tall office slots so four bosses can stack in a standard room while still reading as offices instead of rounded placeholder frames
- hovering a boss reveals arrow lines to the related spawned subagents whether that lead is in a boss office or in an ordinary workstation with one visible child
- chairs and seated reach points sit slightly outward from the desk so the monitor relationship reads cleanly
- workstation computers currently use the single complete desk cut, avoiding the broken narrow pseudo-monitor asset
- waiting and resting agents move to an integrated wall-side rec strip instead of a detached room when they are actually off-desk
- current waiting sessions now stay on-desk, using the same workstation actor lane as other desk work instead of cooling into the rec strip
- rec-room seating should be keyed by stable agent identity and furniture-relative sofa slots, not recomputed purely from per-render sort order
- the browser view no longer exposes a current/history toggle; it always shows current agents plus 4 recent lead sessions
- rec facilities sit on the same raised upper floor band as the wall-side walkway, not in a floating inset
- the rec strip combines vending, counter, doors, clock, plants, sofa, and shelf props inside the same scene
- a selected workspace with no local or recent agents may temporarily reuse the 4 most recent resting lead sessions from other tracked workspaces as rec-room stand-ins, so a freshly opened floor is not completely empty before its first local thread appears
- long task titles stay in hover cards and the session panel instead of being drawn over the map
- the floor is restored to the blue office-strip language from the reference art, including an upper wall-side walkway for rec facilities
- layout constants are now expressed as internal tile-grid settings instead of only pixel literals, so boss-office footprints, desk columns, rec-strip depth, and inter-cubicle spacing all derive from a single floor grid
- global viewer settings are separate from internal scene settings; the first user-facing control is text scale, clamped from `0.75x` to `2.00x`, while prefab sizing and spacing stay internal
- the current browser renderer is Pixi-first for the office map, with HTML retained only for overlays, controls, anchored hover cards, and fallback terminal output
- browser placement rules are intentionally a little stickier than raw workload freshness, because a live local thread should not visually bounce desk -> rec -> desk during short polling gaps
- Codex-local desk seating now also treats app-server `status.type = "active"` as the decisive occupancy signal, so an active session does not drop into the rec strip just because its summarized state temporarily reads waiting or recently done
- once `isOngoing` is present on a local thread, the browser keeps that thread classified as busy across both workstation and session-list logic until the ongoing signal actually clears, instead of letting it cool off in one surface while still reading as active in another
- actor behavior is now explicitly split from universal modes: desk-seated work (`planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`), desk-blocked-standing (`blocked`), resting/recent-finished (`done`, `idle`), and non-local/cloud (`cloud`)

## Secondary Claude support

Claude support uses a deliberately weaker contract than Codex:

- project discovery merges Codex-discovered roots with roots inferred from `~/.claude/projects`
- Codex fleet startup also seeds workspace discovery from configured roots in `~/.codex/config.toml`, so trusted Codex projects can appear before their first visible thread update
- when the Anthropic Agent SDK is available, Claude project discovery prefers `listSessions()` and per-session `cwd` metadata before falling back to raw directory scanning
- Claude project discovery also reads fresh Agent Teams config under `~/.claude/teams`, using teammate `worktreePath` / `cwd` values as cowork project floors
- Claude project discovery also reads Agent View background job state under `$CLAUDE_CONFIG_DIR/jobs/*/state.json` or `~/.claude/jobs/*/state.json`, maps `<project>/.claude/worktrees/*` jobs back onto the owning project floor, and renders matching jobs as read-only `claude:background` agents with `claude attach <job>` resume commands
- Claude project discovery also reads Claude Desktop Co-work app data under `local-agent-mode-sessions`, using `spaces.json` folders and per-session `userSelectedFolders` as Co-work project floors
- the snapshot builder can include recent Claude sessions for matching project roots
- recent Claude session messages can now be read through the supported Agent SDK `getSessionMessages()` API before falling back to raw JSONL transcript sampling
- Claude Desktop Co-work sessions are exposed as read-only Claude agents for matching project roots, with recent file detections surfaced as file-change activity when available
- transcript-only Claude session state is still inferred from recent tool uses such as read, edit, bash, and task delegation when no typed hook signal exists
- optional per-project hook sidecars in Agents Office user data at `claude-hooks/<session-id>.jsonl` can be produced either by a Claude Code hook script or by the exported Agent SDK sidecar bridge, and they upgrade Claude sessions to typed permission, tool, subagent, and stop state
- Claude Agent/Task tool calls plus `TaskCreated`, `SubagentStart`, and `SubagentStop` hook records normalize to the same delegated-work activity family as Codex collab-agent items
- local Claude workflow/subagent files under the session `subagents/` directory create inferred child agents through the shared `parentThreadId` hierarchy, using transcript tails, matching `*.meta.json`, and workflow `journal.jsonl` records for label, role, state, and latest message
- hook records with `agent_id` and team records with `leadSessionId` create child Claude agents through the shared `parentThreadId` hierarchy, with hook-backed rows overriding matching inferred workflow rows while transcript-only delegation still preserves weaker Claude provenance/confidence
- the same Agent SDK sidecar bridge can now hold `PermissionRequest` and `Elicitation` hooks open while the browser writes a response file under the same project-scoped user-data area, then return the official hook decision back to Claude
- the browser `Needs You` queue can now answer hook-backed Claude approval waits and schema-backed elicitation forms when the sidecar record came from that Agent SDK bridge
- Claude Code dynamic workflows and `ultracode` are tracked as a research-preview boundary: local workflow child transcripts and journals are consumed, but the complete `/workflows` phase/progress view still has no app-server-like API here
- Claude Code OpenTelemetry export is the current official protocol candidate for hookless tool/model/subagent activity because it emits logs/traces with session and agent attributes, but Agents Office does not yet host an OTLP collector
- Claude agents are rendered in the same room model, but with explicit provenance/confidence so transcript inference and hook-backed state do not pretend to have Codex-grade app-server coverage

This is useful because it broadens observability across the machine, but it should remain visually and architecturally secondary to the official Codex path.

## Secondary Cursor support

Cursor support now has two paths:

- a local typed adapter that reads Cursor hook sidecars under the matching per-project Agents Office user-data folder, with the repo-shipped project hooks defined in `.cursor/hooks.json`
- the official cloud-agent API when `CURSOR_API_KEY` is configured or a saved app-level Cursor API key exists

The local typed adapter:

- consumes project-owned Cursor hook sidecars written from the official Cursor Hooks surface
- maps typed local prompt, tool, shell/MCP, file-edit, thought/response, compaction, and session lifecycle events into the shared workload model
- keeps those sessions visibly distinct from cloud polling with `confidence = typed`

The cloud typed adapter:

- matches agents to the selected project by normalized git `remote.origin.url`, `source.repository`, or PR-backed repository URLs when Cursor reports `source.prUrl` or `target.prUrl`
- polls the official agent conversation endpoint for active/recent Cursor agents so newly seen prompts and replies can flow into the shared toast/event model
- keeps typed prompt/input history distinct from assistant/output history so only Cursor replies render as visible agent speech or text toasts
- renders Cursor cloud agents in the same room and session model with `confidence = typed`
- surfaces typed status, summary, branch, repo, and target URL data

Cursor still does not provide Codex-style local live thread subscriptions here, and the documented webhook surface only covers terminal `ERROR` / `FINISHED` cloud-agent status changes, so Cursor visibility remains hook-and-poll based rather than app-server-grade live streaming.
Cursor also remains read-only in Agents Office; there is still no shipped browser write-back path for local or cloud Cursor agents.

## Secondary OpenClaw support

OpenClaw support uses the official Gateway session model instead of trying to reinterpret OpenClaw as a task board:

- the adapter connects to the OpenClaw Gateway when `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` is configured
- it reads typed session rows from `sessions.list` and typed workspace config from `config.get`
- it maps OpenClaw agent workspaces onto office projects by normalized workspace path equality or child-path containment under the project root
- parent and child OpenClaw sessions are carried through `parentThreadId` and depth so delegated session trees stay visible
- active OpenClaw sessions whose configured workspace is outside the current fleet project set attach as `openclaw:roaming` agents and use the same fixed screen-space sky layer, desk handoff, and cross-floor transfer motion as projectless Hermes orchestrators
- the current integration is read-only and surfaces session/workspace presence, not OpenClaw action controls

This keeps OpenClaw aligned with its real abstraction boundary, which is sessions inside configured agent workspaces rather than project tasks.

## Secondary Hermes support

Hermes support follows the local runtime surfaces exposed by `nousresearch/hermes-agent`:

- the adapter reads `~/.hermes/state.db`, `HERMES_HOME`, and Hermes profile homes for durable session/message metadata
- Agents Office can install a small global Hermes plugin with `codex-agents-office agents link hermes`; that plugin writes typed lifecycle hook sidecars into machine-local Agents Office storage
- it uses live process cwd/env hints such as `HERMES_CWD`, `TERMINAL_CWD`, and `HERMES_HOME` when a Hermes CLI or TUI process is still running
- it treats a Hermes session id as the stable agent and lets that agent move floors based on the latest project-bearing hook or DB activity
- hook-only streams such as `default`, `process-<pid>`, and UUID tool/task files are activity sidecars, not agents; they are folded into the nearest durable SQLite session by explicit ids, platform/cwd hints, and recent timing
- Hermes cron run ids such as `cron_<job>_<timestamp>` and SQLite sessions with `source = cron` render as temporary Hermes agents on the relevant project floor, using compact project tick labels and stripping the scheduler wrapper prompt from current-action text
- Hermes command, process-management, planning, file-change, and MCP/tool hook events update `detail`, `activityEvent`, toasts, and session history; they do not replace `latestMessage`, which stays on the latest useful Hermes assistant/subagent text
- Hermes hook `user_message` values can still seed session labels and user-message history, but they must not populate the agent `latestMessage` field because the map renders that field as agent speech
- Hermes tool classification follows Hermes' registered/displayed tool vocabulary: `todo` maps to planning, `process`/`terminal`/`execute_code` map to command activity, `read_file`/`search_files`/`skill_view` map to scanning tool activity, and only Hermes' mutating file tools (`write_file` and `patch`) map to file edits
- Hermes model/API request hooks map to reasoning/thinking activity rather than generic dynamic-tool activity, so model status does not appear as a fake tool action
- generic Hermes maintenance prompts, such as skill-library review prompts, are ignored as display messages so they do not overwrite the last real conversation text
- it maps work to projects by normalized cwd, system-prompt working directory, tool paths, payload paths, and git-root discovery rather than matching project names
- it contributes project discovery roots only from a live Hermes process cwd or the latest current root of a fresh hook session, so old `state.db` history and the full set of touched hook paths cannot create floors
- exact transient system roots such as `/tmp`, `/var/tmp`, and `/dev/shm` are not promoted into fleet workspaces, even if temporary hook cwd data or a stray `.git` directory makes them look project-like
- hook sessions outside the current fleet project set are attached to the tower as `hermes:roaming` agents, but the browser renders them in a fixed left-side sky layer outside the building rather than inside any room scene
- hook-backed Hermes project matching keeps the last project through 20 rootless hook actions; after that, the same session is treated as projectless until a new project-bearing hook path or cwd appears
- the browser keeps the server contract simple here: `hermes:roaming` and `openclaw:roaming` remain attached to existing snapshots for fleet transport, while `syncFloatingHermesAgents(...)` pulls those orchestrators into the screen-space layer and keeps them out of rec-room placement
- SQLite session exports, hook scan counts, hook file tails, hook line size, and request JSON bodies are bounded so Hermes history and sidecar payloads cannot grow the live web process without limit
- the current integration is read-only; plugin-hook activity renders with `confidence = typed`, while SQLite/process fallback activity renders with `confidence = inferred`

This keeps Hermes aligned with its actual abstraction boundary: local sessions inside a current working directory, with optional profiles under the Hermes home.


## Asset pipeline

- The source PixelOffice atlas PNG and `.aseprite` files are kept in the repo for reference and future export work.
- The runtime path now uses standalone PNG cuts under `/assets/pixel-office/sprites/...` instead of CSS background-position math against the atlas.
- The supplied `.aseprite` files can still be inspected through `codex-agents-office aseprite inspect <file>`.
- Official Aseprite docs recommend exporting slice metadata into JSON via sprite sheet export or `--data`; that is still the likely bridge from authored Aseprite assets into a richer scene manifest later.

Sources:

- [Aseprite files](https://www.aseprite.org/docs/files)
- [Aseprite slices export](https://www.aseprite.org/docs/slices/)
