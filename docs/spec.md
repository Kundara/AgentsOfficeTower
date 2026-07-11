# Product Spec

## Purpose

Agents Office Tower is a workspace-level observability layer for agent sessions across Codex, Claude, Cursor, Hermes, OpenClaw, cloud tasks, and shared rooms. Codex has the deepest typed support; every provider is normalized into the same workload model.

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
- one fleet coverage chip in the top bar (healthy/starting/degraded/stale) opening a viewport-bounded coverage drawer with per-provider health, stale floors, deduplicated coverage notes, and the desktop-notification toggle; degraded or stale floors get one small strip chip, and no other health badging appears on the map
- a durable cross-project `Needs You` queue when approvals or inputs are pending
- direct local approval controls inside that queue when the source is a typed Codex approval wait
- direct local input controls inside that queue when the source is a typed Codex `tool/requestUserInput` wait
- direct local reply controls inside that queue only when the source is an app-server-owned typed local Codex input wait without schema-backed questions
- direct local approval/input controls inside that queue when the source is a typed Claude hook-backed `PermissionRequest` or schema-backed `Elicitation` wait
- direct local session reply controls in session cards when the source is an app-server-owned typed Codex thread
- observed desktop, VS Code, and CLI Codex threads must stay view-only for generic browser chat, and the scene thread panel must not expose Send, resume, launch, or copy controls
- local Codex reply controls must steer active in-flight turns and must not call `turn/start` for an active thread just because the observer row has not loaded its turn list yet
- a subtle in-scene Ops Wall between the primary room's left edge and door, showing decayed hot script, doc, and media file changes
- subtle in-scene motion and placement cues rather than a detached dashboard
- transient above-head turn badges for recent typed `turn/started`, `turn/completed`, `turn/interrupted`, and `turn/failed` events

### Sessions panel

The Sessions panel is a secondary workload index, not a second scene or an unbounded transcript dump.

- The panel header carries a search box and a lens selector (all, needs intervention, my live work, inferred only, remote work, possible overlap, degraded visibility); filtering never removes the durable `Needs You` semantics, and Needs You rows rank oldest wait first.
- Advisory coordination surfaces render above the lanes when they exist: `Declared work` cards for active/stale/handoff claims and `Possible overlap` cards derived from multi-actor hot changes. Both are evidence-backed and timestamped, never say "owned by", and are displayed side by side without reconciling detected activity against declared intent.
- Its hierarchy is `Needs You`, then `Active`, then `Recent`. `Needs You` is present and pinned only when actionable approval/input requests exist. `Active` contains every live or ongoing session in the selected scope. `Recent` contains eligible non-live rows newest-first.
- The panel admits all live rows and at most 10 recent rows globally for the current scope. In All view that is one cross-workspace cap, not 10 rows per project. Needs You rows do not consume the recent cap.
- A finished subagent may remain in Recent only for its normal 12-second readability grace, then disappears. `isOngoing` and durable wait state win over stale display text when deciding whether a row is Active; `thread/closed`, transport unload, or a non-final completed turn do not move ongoing work to Recent.
- Every session card exposes a `Why?` action that opens a compact evidence view answering "why is this here?": the seating signal (durable wait, ongoing turn, current-workload window, or recent retention), typed vs. inferred provenance, last update and snapshot freshness ages, the retention rule currently keeping the row visible, and up to five recent typed events for the session. When no typed events exist in the event window, the view says so instead of showing an empty list.
- A row in the Active lane must never show contradictory terminal state text. When a session still holds runtime ownership (`isCurrent` or `isOngoing`) while its latest observed state is `done` or `idle` — for example during the post-stop desk cooldown — its visible state is the transitional `Finishing`. `Done` and `Idle` labels appear only on rows outside the Active lane.
- The header uses a real heading and concise visible counts such as `N active · M recent`; it must not depend on a clipped prose sentence to communicate scope. Each card exposes title, visible state text, project/source context when needed, and labelled actions. Color alone must not communicate state.
- The session collection uses list semantics and owns its vertical scroll. Needs You remains reachable while ordinary rows scroll; the final row is reachable; page scroll is not trapped; live refresh preserves the list's scroll position and current keyboard focus.
- At a 360px panel width, viewport widths around 390px, 640px, 1100px, and 1440px, browser zoom at 200%, and `--ui-text-scale: 2`, cards grow to their content, metadata and actions wrap, no title or state text is vertically clipped, no horizontal page overflow is introduced, and narrow layouts place Sessions after the scene without a nested-scroll dead end.
- A focusable session card must have an accessible scene-cluster focus purpose. The panel is labelled by its heading, the collection is labelled as a list, cards are list items, state remains visible text, action groups are labelled, and focus-visible styling is preserved.

For typed `tool/requestUserInput` waits, queue submit should stay disabled until every required question is answered, while optional prompts may stay blank and be omitted from the app-server `answers` payload.
For hook-backed Claude elicitation forms, queue submit should require only the fields marked required by the Claude-requested schema.

The browser map should be treated as a retained 2D scene, not a stream of HTML snapshots.
Live data should update scene entities in place instead of rebuilding the office subtree by `innerHTML`.

### Terminal

The terminal surface is the fast inspection mode. It lives in the CLI (`aot snapshot`, `aot watch`, `aot web query`); the browser no longer exposes a Map/Terminal toggle, and the browser terminal renderer remains reachable only through the `?view=terminal` debug URL.

It should group sessions by room and show:

- state
- recent useful action
- active paths
- provenance/confidence
- resume commands when available

### VS Code

The VS Code panel should expose the same snapshot model as the browser and terminal views instead of inventing a separate state system.

## Shared model

All renderers should consume the same normalized snapshot model.

- A `DashboardSnapshot` represents one tracked workspace and includes `projectRoot`, `projectLabel`, `projectIdentity`, `generatedAt`, `rooms`, `agents`, `cloudTasks`, `events`, `activity`, `notes`, `providerHealth`, and `claims`.
- `providerHealth` carries one row per adapter (`ready`, `unconfigured`, `degraded`, or `error` with detail and freshness); `unconfigured` means intentionally absent and must not degrade fleet health. `claims` carries advisory coordination claims with their derived lifecycle (`active`, `stale`, `released`, `handoff`).
- A `DashboardAgent` represents one visible session or agent and carries identity, currentness, room placement, state, detail text, latest useful message, resume/open affordances, provenance/confidence, and optional `needsUser`, `hatId`, or shared-room `network` metadata.
- A `DashboardEvent` is the normalized event log used for browser notifications and event-native state surfaces such as approvals, input waits, command/file activity, delegated-agent or subagent events, and typed messages.
- `activity` is a derived workspace-level summary for the scene Ops Wall. It contains decayed `hotChanges` from typed file-change events, grouped as script, doc, or media changes for display; tool and command activity should stay out of the hot-stuff board data path.
- `needsUser` is the durable per-agent approval/input state used by the browser `Needs You` queue and raised-hand desk marker.
- `network` marks a remote shared-room agent and should preserve peer label and peer host metadata distinctly from local sessions.

Normalized activity states are:

- `planning`
- `scanning`
- `thinking`
- `editing`
- `running`
- `validating`
- `delegating`
- `waiting`
- `blocked`
- `done`
- `idle`
- `cloud`

Renderer actor states are derived from those universal modes:

- Desk-seated: `planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`
- Desk-blocked-standing: `blocked`
- Resting/recent-finished: `done`, `idle`
- Non-local/cloud: `cloud`

Per-mode actor handling:

- `planning` -> desk-seated, clipboard marker above the head
- `scanning` -> desk-seated
- `thinking` -> desk-seated, light marker above the head until the first visible assistant message/toast arrives
- `editing` -> desk-seated
- `running` -> desk-seated
- `validating` -> desk-seated
- `delegating` -> desk-seated
- `waiting` -> desk-seated; if `needsUser` is set, use the raised-hand marker above the head and keep the session in the durable `Needs You` queue
- `blocked` -> desk-blocked-standing; use the raised-hand marker for `needsUser` approval/input waits and the exclamation marker only for explicit system/tool/command/file failure blocks
- `done` -> resting/recent-finished with a short post-stop desk cooldown before cooling off
- `idle` -> resting/inactive off-desk state
- `cloud` -> non-local/cloud state
- `waiting` should also get a subtle pulse in its bubble/raised-hand cue so desk waits do not read as frozen
- `blocked` should get a subtle shake treatment so failure blocks read differently from ordinary desk occupancy
- `validating` should get a brighter pulsing workstation glow than ordinary busy desk work

Delegated-work normalization:

- Codex `collabToolCall` / `collabAgentToolCall` items and Claude Agent/Task/Subagent hook signals should converge on the shared `collabAgentToolCall` activity family where possible.
- Shared delegated-work activity should produce `DashboardEvent.kind = "subagent"` so browser toasts, scene cues, session history, and future source adapters do not need separate per-provider event families for the same concept.
- Local Claude workflow/subagent transcripts, matching `*.meta.json`, and workflow `journal.jsonl` records should create inferred `parentThreadId` child rows under the lead Claude session, even when no hook sidecar exists.
- Claude hook `agent_id` and Agent Teams `leadSessionId` should create or upgrade real `parentThreadId` child rows where available; hook-backed rows should win over matching inferred workflow/subagent rows, while transcript-only delegation should still keep Claude provenance/confidence and source-specific detail text visible because that path has weaker correlation.
- Locally materialized Claude Home work sessions should remain read-only Claude agents. They can seed workspace floors and file-change activity, but they must not imply Codex-style reply, resume, or subagent control; the legacy `claude:cowork` source kind stays compatible.
- Claude Agent SDK `listSessions()` / `getSessionMessages()` rows are Claude Code sessions and remain on Code project floors. Only local Home work records materialized in the legacy `local-agent-mode-sessions` store may become read-only `claude:cowork:*` rows.
- Personal Free, Pro, and Max Claude Home Recent chats have no supported live local listing API and must not be inferred from `claude-code-sessions`, cookies, local/session storage, prompt drafts, or message bodies. A narrow local-only exception may observe sanitized remote Home-work session metadata already stored in Claude Desktop's bounded Chromium HTTP response cache: only `cse_*` ids, title, timestamps, model, origin, coarse state, and exact `product:cowork-remote` classification are retained. The adapter must not read the watch cursor/query token, call the private endpoint, retain message/event bodies, or represent ordinary chats. Enterprise Compliance chat metadata remains an explicit future opt-in administrative provider.

Recent typed turn lifecycle handling:

- `turn/started` -> short above-head `START` badge
- `turn/completed` -> short above-head `DONE` badge
- `turn/interrupted` -> short above-head `STOP` badge
- `turn/failed` -> short above-head `FAIL` badge
- these badges should be brief scene-native cues layered above the ordinary state markers, not durable dashboard labels

Recent typed activity handling:

- `turn/plan/updated`, `item/plan/delta`, command execution, file-change, MCP/tool, and hook-run notifications -> toast/event, hover, and session-history surfaces only, with no extra mock-style in-scene activity cue
- command execution should not render separate `RUN` labels in the room scene
- file changes should not render separate `EDIT` labels in the room scene
- planning updates should not render separate `PLAN` labels in the room scene
- tool activity should not render separate `TOOL` labels in the room scene
- `collabToolCall`, `collabAgentToolCall`, and source-normalized delegated-agent events -> subagent/delegation notification and motion path, distinct from generic tool calls when enough parent/child data exists
- `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` -> brief animated `WAIT` cue near the actor while the durable approval queue entry is active
- `item/autoApprovalReview/*` -> non-actionable approval-review activity; it should not create a durable `Needs You` entry unless app-server also sends an approval request
- `item/tool/requestUserInput` -> brief animated `ASK` cue near the actor while the durable input queue entry is active
- `serverRequest/resolved` for approval/input requests -> brief animated `OK` cue near the actor to acknowledge queue clearance
- warning, config, deprecation, MCP startup/login, rate-limit, model reroute, and Windows sandbox notifications -> status/history/notes surfaces; they should not by themselves move a session into active desk work
- request lifecycle cues should stay short-lived, scene-native, and motion-first; they are not a replacement for the durable toast or queue surfaces
- each request cue mode should also carry a distinct icon/motion treatment inside the chip so the scene does not depend only on the text label to communicate the activity type
- workstation-seated activity should also raise a short non-text visual treatment on or around the workstation itself so item/request activity does not collapse back to text-only chips
- structured request waits should expose at least some of their shape in-scene, such as approval decision breadth or input question/required load, instead of rendering every request as the same generic wait

Workspace Ops Wall handling:

- The primary room should reserve the wall span between the left edge and the door for a compact scene-native activity board when there is enough space.
- The wall should show the hottest recent file/workspace changes with time decay, so repeated edits raise heat and quiet files cool naturally until they disappear.
- Hotness should come from typed file-change events and line deltas where available; generated/transient display should stay item-name-first with longer paths in hover/details surfaces.
- The scene wall should stay minimal: a title-free 3x3 file grid with script, doc, and media columns, using compact text treatment rather than separate progress or heat bars.
- Leaderboard row changes should animate in-place so rank changes are visible without turning the wall into a separate dashboard.
- Empty activity sections should stay visually clean instead of printing placeholder text such as "no changes".
- The wall is a transparency cue, not a detached dashboard. It should stay compact, readable at scene scale, and subordinate to agent placement, hover cards, the session panel, and the durable `Needs You` queue.

Normalized provenance/confidence rules are:

- `provenance` identifies the source family such as `codex`, `claude`, `cloud`, `cursor`, `hermes`, `presence`, or `openclaw`
- `confidence` distinguishes typed source truth from inferred best-effort state

## Source priority

Prefer official Codex surfaces first:

- `codex app-server`
- `codex cloud list --json`
- saved per-project `rooms.xml` in Agents Office user data
- saved per-project `agents.json` in Agents Office user data

Claude local logs, local Claude workflow/subagent files, and Cursor background agents are secondary inputs. They can enrich visibility, but they should not blur the distinction between typed Codex truth and inferred state. Local Claude workflow/subagent children remain inferred unless a matching hook/team record upgrades them. When Claude hook sidecars are present, Claude may contribute typed file, command, input, approval, and delegated-agent events, but those events still carry Claude provenance.

## Browser behavior

### Modes and controls

- The browser should support both `map` and `terminal` views.
- `?view=map|terminal` should deep-link the active browser view.
- Selecting a workspace changes focus only; it does not change fleet monitoring scope.
- A selected workspace can enter a focused single-workspace mode through the browser control and `?focus=1`.
- Selected and focused single-workspace map views should reuse the same compact scene geometry as the tower overview; focus may change whole-scene fit scaling and browser chrome, but it must not swap in a different avatar, workstation, or pod scale.
- `?screenshot=1` should disable live SSE-only behavior that would make still captures unstable and should report snapshot connection state instead of live streaming.
- The browser header Settings popup is the home for viewer controls and machine-local integration settings.

Current browser settings surfaces are:

- text scale
- a persisted `Split Worktrees` toggle that restores one floor per worktree instead of the default merged repo floor
- a debug tile overlay toggle for layout diagnostics
- a machine-local image-only hat selector with left/right cycling, a first `no hat` option, and immediate application across the local player's visible agents
- machine-local Cursor API key save/clear controls
- shared-room sync toggle plus `host`, `room`, and short `nickname` fields, with explicit save/clear controls
- a per-floor persisted `Shared` toggle for local projects while shared-room sync is enabled, defaulting to off and controlling whether that local project can participate in the room

### Workload placement

- Use current workload by default.
- Active local Codex work should occupy desks.
- A local Codex session should stay on a desk whenever app-server still reports `status.type = "active"`, even if its active flags currently mean waiting for approval or user input, or the latest visible item has already reached a recent `done` summary.
- Active local subagents should remain visible from that same runtime-active signal even if the transient `isCurrent` flag has already moved to a sibling update or the parent thread.
- Waiting sessions stay on-desk; only resting lead sessions belong in the rec area after the session is no longer active at the app-server/runtime level.
- If `thread/list` reports a fresher desktop-backed Codex thread than `thread/read`, that fresher timestamp should drive current-workload and seating decisions.
- Fresh non-final local Codex work events such as command, file, tool, plan, or turn activity should refresh desk-currentness even when the observer temporarily sees the thread as `readOnly` or `idle`.
- Fresh unhydrated desktop `notLoaded` rows with no readable turns should reserve a desk for about 8 seconds as just-sent prompts, but stale `notLoaded` fallback rows must only use the 3-second finished cooldown and must not keep finished threads desk-active for minutes.
- `thread/closed`, non-final `turn/completed`, non-final `turn/interrupted`, and observer `notLoaded` unloads must not release an already observed ongoing workstation by themselves. They are observer/update boundaries; workstation release begins only after a final answer or hard failure/archive.
- A local thread that is still truly ongoing must keep its workstation through freshness/current signal dips between polls, including stale `notLoaded` rereads without a final answer.
- A fresh read-only `notLoaded` Codex thread without a final answer should stay desk-seated through quiet text gaps rather than walking to the rec area between commentary updates.
- Quiet local desk-live work now gets a longer about-3-minute stay-on-desk fallback after its last update when it has recent non-final activity, is still subscribed, or is sitting in a transient `notLoaded` state; once the live monitor has observed the thread as ongoing, `isOngoing` is stronger than that fallback window and keeps the desk until final answer or hard terminal state.
- Workstation release should be conservative. Ordinary poll jitter, UI rerenders, debug toggles, or temporary freshness gaps must not pull a still-working agent off a desk.
- A workstation should only be released when the thread has actually settled into a resting/finished state according to the browser placement rules, with the explicit post-stop cooldown described below.
- Stale local Codex subagent rows that still report `status.type = "active"` but have no in-progress turn and no fresh update for about 20 minutes should not keep desks alive or inflate active counts.
- The rec area should keep at most the 4 most recent lead sessions visible;
  it may show fewer while one of those visible resting leads is back at work.
- If one of those visible resting leads becomes active again, older hidden leads should not pop back into the rec area just to fill that seat for a moment.
- Finished subagents should despawn instead of taking rec-area slots.
- Finished subagents should keep a visibly readable post-finish desk cooldown before exiting, and that cooldown should be longer than the top-level lead cooldown so child completion is easier to observe in-scene.
- Finished subagents should then walk out through the room door instead of blinking away.
- Visible subagent avatars should render at 75% of their parent depth's size while keeping normal workstation, hover, and depth behavior; nested multi-agent v2 descendants should keep shrinking by `0.75 ** depth`.
- Agent hover cards and hot-stuff board hover cards should render through a top-level browser overlay anchored to scene hit targets, not as descendants of the scrollable scene host, so they remain visible above the floor panel and clamp inside the viewport on narrow screens.
- Empty rooms should read as quiet space, not as errors.

### Scene layout and tiles

- In fleet view, workspace floors should read as one straight architectural cutaway: a full-width rectangular crown/roof with sparse pixel HVAC, vent, and aerial details; continuous facade edges; and one rectangular foundation instead of offset cards or projecting slabs.
- The shared backdrop should use the restored bright blue parallax sky. Normal workspace interiors should use the saturated blue staggered-brick floor palette with restrained separator lines and derived low-contrast seams rather than a bright cyan grid.
- Floor joins must stay flush across the tower. Gold rail dots, bright projecting separators, and partial-width roof caps are not part of the visual language.
- The lowest all-workspaces level is labelled `Chat Café` and reads as a street-level pixel-art café with pavement, storefronts, tables/workstations, chairs, plants, shelving, and coffee fixtures.
- The Chat Café header should keep a compact, persistent `Quick Chat: Add to task` hint even when Claude Home or other Café agents are present; the integration boundary must not disappear with the empty state.
- The office floor should use a tile grid as its primary layout system.
- Scene sprite metadata and room-interaction definitions should load from startup-read config files instead of being hard-coded inside the browser runtime strings.
- Rooms from the saved per-project `rooms.xml` define the outer floor bounds; internal furniture/layout is then placed on a tile grid inside those room bounds.
- The grid starts at the end of the wall band and continues through the whole visible floor area to the bottom of the room.
- The renderer may scale tiles to fit available width, but object placement should stay grid-derived rather than free-floating.
- Whole-scene fit scaling may vary by container, but prefab geometry should stay consistent across tower, selected-workspace, and focused single-workspace rendering.
- Desk pods, workstation furniture, and their seat cells should resolve from tile columns/rows and tile spans, not ad hoc pixel offsets inside the room.
- Some prefabs can span multiple tiles; the layout contract is based on tile spans, not only `1x1` occupancy.
- The tile system should preserve stable desk slots so agents do not repack across the room on routine live updates.
- Existing seated agents keep their assigned desk slot unless occupancy truly changes enough to force a new allocation.
- New active agents should take the next available desk slot; they must not steal an already-occupied stable slot from another live agent during an ordinary update.
- Resting agents in the rec area should keep stable sofa/wall-side seats by agent identity instead of being reassigned purely by sorted array index.
- Z-order should be explicit and deterministic so floor bands, furniture, agents, effects, and toasts stack consistently.
- Floor-level depth sorting should use each sprite's ground-contact pivot rather than sprite top or center; for avatars this pivot is the feet.
- Depth ordering should resolve from logical floor rows first, not from ad hoc pixel ties.
- Moving agents should sort from their current foot-tile row while they walk.
- Seated avatars and workstation shell sprites should sort from the workstation footprint row they occupy.
- Lower on-screen foot/base position must sort in front of higher on-screen foot/base position.
- Agents, chairs, desks, workstations, and other floor props that can visually overlap should follow that same foot/base sorting rule so overlap reads spatially correct.
- If an agent's feet are still above a workstation or desk base on screen, the workstation/desk must render in front of that agent; once the agent's feet move below that base, the agent must render in front.
- Depth sorting must update continuously during routed movement and idle motion, not only when an agent first spawns or is assigned to a seat.
- Agent hats should always render with the avatar, use config-driven default scale/offset values derived from the base `16px` sprite language, and allow per-hat override scale/offset tuning from the hat manifest without requiring renderer code edits.
- Agent movement in the retained browser scene should follow walkable tile paths instead of straight-line tween resets.
- Tile pathfinding should avoid occupied cells from furniture, workstation footprints, and already-seated agents.
- Visual-only updates such as debug overlays, text-scale changes, or scene host rerenders must not be treated as a new placement instruction.
- A newly visible top-level active agent should enter from the room door and walk to its assigned workstation.
- A newly visible subagent should start from its parent agent's current scene position, then move to its assigned workstation.
- Parent/child relationship arrows should communicate delegation while arrivals make the spawned-worker relationship visible.
- If a resting lead becomes active again, it should leave its rec-area seat and walk to its newly assigned workstation instead of despawning and respawning.
- When an agent truly leaves the visible scene, it should walk back out through the room door.
- Each room door should render as a two-part sliding door with a dark recess behind it.
- The door should slide open while an agent enters or exits through that room and then close again after a short hold-open delay.

### Scene settings model

- Scene settings are split into internal settings and global user settings.
- Internal settings define prefab and layout behavior that should not be user-configurable yet.
- Global settings define viewer-facing controls that should apply consistently across the browser office.

Internal settings should include at least:

- base tile size
- compact tile size
- boss office footprint
- boss office top inset
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

Per-workspace appearance settings should include:

- a `Customize` control beside each normal workspace floor's `Shared` and `Focus` controls; the synthetic Chat Café keeps its authored palette and does not expose this control
- editable Floor, Wall, and Board base colors, stored browser-locally by repository identity so merged and split worktree views share one appearance
- bounded darker and lighter ramps derived from the three stored base colors instead of separately persisted shade fields
- live scene preview while a color is changed, plus explicit Reset and Close actions
- keyboard behavior that moves focus into the first color input when opened, returns focus to the Customize trigger when closed, and supports `Escape` without losing the active floor context

Diagnostic browser controls may also exist for development visibility, such as a debug tile overlay toggle, but they should not redefine the stable layout contract.

Global text scale rules:

- allowed range is `0.75x` through `2.00x`
- default is `1.00x`
- it should scale browser map text, toast text, and tooltip/hover text together
- it should not change internal prefab geometry or room assignment rules

### Fleet behavior

- Default browser deploys should run in fleet mode.
- Fleet mode should keep every discovered workspace live.
- Git-linked worktrees should merge onto a shared repo floor by default when they belong to the same underlying repository identity.
- The browser should expose a global `Split Worktrees` toggle that restores the current one-floor-per-worktree presentation without changing the monitored workspace set.
- When worktrees are split into separate floors, a worktree floor title should use the worktree name with a distinct bright-blue worktree badge/icon treatment.
- Fleet startup should include configured Codex workspaces from `~/.codex/config.toml` when available, not only workspaces that already emitted recent local thread activity.
- Fleet mode should hide workspaces once their last agent or session-log timestamp is more than 7 days old. Launch seeds and configured roots are discovery aliases, not exemptions from this weekly window; explicit project mode remains pinned.
- Fallback Codex rollout discovery must inspect bounded session metadata before loading whole JSONL histories, reject non-subagent and nonmatching-project files early, share in-flight metadata/full reads across fleet monitors, and cap concurrent full-file parsing. Each project monitor coalesces overlapping startup, interval, and notification discovery triggers into one active scan plus at most one queued rerun.
- A uniquely titled projectless Codex Chat task whose normal cwd is under `~/Documents/Codex/<date>/<slug>` must normalize to the single canonical `~/Documents/Codex` Chat root within one live refresh. It appears exactly once as its own agent at a Chat Café table and exactly once in Sessions, retains the real thread id/title/state, and never creates a dated or slug-specific floor.
- While that Chat task is active it belongs to Active and remains seated. After a final answer it keeps the normal roughly 3-second lead cooldown, then becomes Recent/off-desk according to the shared placement policy. Clicking it opens read-only history unless the exact app-server connection owns reply authority.
- A normal repository merely named `Chat` must not enter Chat Café. ChatGPT account sidebar history, Codex Quick Chat before **Add to task**, and ordinary personal Claude Home Recent chats must not be synthesized when their supported local APIs do not expose them.
- Claude Home work spaces should become workspace floors from the legacy `local-agent-mode-sessions` store when their saved folder roots are still present locally.
- A recent Claude Home remote-work session classified by the desktop cache as `product:cowork-remote` should appear exactly once as a rootless, inferred, read-only Claude agent in Chat Café and Sessions. It must never join a project snapshot or multiplayer payload, expose reply/resume actions, retain prompt/message content, or remain falsely active after its cached activity becomes stale.
- Claude Home-work-only floors should sort after normal workspaces so primary coding projects stay first in the tower.
- Claude workflow/subagent children should be seated under the owning lead session discovered for that project floor, not promoted into separate floors from their transcript paths alone.
- Hermes-discovered workspaces should come only from a live Hermes process cwd or the latest current root of a fresh hook session; durable DB history, broad hook path sweeps, and exact transient roots such as `/tmp` must not create floors.
- Hermes hook-backed project relation should persist through 20 rootless hook actions; after more than 20 actions without a known project root, the same Hermes session should become projectless until a new project-bearing path or cwd appears.
- OpenClaw workspace matching should seat sessions when the configured agent workspace is the known project root or a child path under that root. Active OpenClaw sessions outside the known fleet project set should become `openclaw:roaming` orchestrators instead of creating fake floors.
- Projectless Hermes sessions and roaming OpenClaw sessions should render as `hermes:roaming` / `openclaw:roaming` avatars in a fixed screen-space sky layer on the left outside the building. They should ignore vertical tower scroll, use deterministic non-colliding scatter for multiple floating orchestrators, and stay visually separate from room-scene rec/resting agents.
- Hermes and OpenClaw movement between project states should preserve identity motion: desk-to-floating moves from the previous desk rect into the sky layer, floating-to-desk flies from the current screen-space avatar to the desk hit target, and known-project-to-known-project moves should create a short screen-space transfer ghost between the old and new desk rects.
- The selected workspace changes browser focus only; it does not change the monitor set.
- `/api/server-meta` must report the live bound fleet project set, not only startup seed projects.

Worktree identity rules:

- Shared repo/worktree grouping should work across Codex, Claude, and Cursor-backed snapshots; it must not rely on one source family alone.
- Shared worktree grouping should prefer actual Git common-dir identity when available, then fall back to other stable repo identity fields only when necessary.
- Agent hover cards should expose the source worktree name with the same worktree icon so duplicate repo clones remain distinguishable even when the tower floor is merged.
- Agent labels, hover titles, and session-card titles should normalize repo-local paths into readable relative labels and must not surface raw WSL mount paths like `/mnt/f/...` as the primary visible title.
- Agent-facing labels in the scene and session list should normalize repo-local paths so raw `/mnt/...` WSL paths do not appear as the primary visible title.
- Hermes command/process/tool activity should appear as current action state, toasts, and session history, not as chat speech or extra room-scene labels. If a Hermes session is currently running a command or background-process action after an earlier Hermes assistant/subagent reply, hover and session summaries should show that prior useful Hermes text as `latestMessage` and expose the action separately.
- Hermes hook user prompts should not be copied into `latestMessage`, because hover cards and the room scene render `latestMessage` as Hermes speech. Prompts can still appear as user-message history or session labels.
- Hermes tool activity should preserve Hermes' own tool meanings: `todo` should look like planning, `read_file`/`search_files`/`skill_view` should look like scanning/tool activity, and only `write_file`/`patch` should count as file edits.
- If a Hermes session has only command/tool activity and no visible prompt or assistant reply, hover should show a state summary such as `Running` plus the action row; it should not fabricate the command text as the last message.
- Hermes cron sessions should appear as temporary project tick agents while active or recently done. Their raw `cron_<job>_<timestamp>` ids and scheduled-job wrapper prompts should not become avatar labels or current-action text.
- Generic Hermes maintenance prompts such as skill-library review prompts should not overwrite the previous real message in hover cards or session panels.

### Shared-room behavior

- Shared-room sync is an optional browser-side overlay, not the primary local transport.
- Shared-room host, room, nickname, and enabled state should be loaded from machine-local Agents Office user data when the page opens and should survive browser reloads.
- Shared-room form fields should behave like ordinary inputs while the user is typing; runtime refreshes must not rewrite the draft value under the cursor.
- Shared-room settings should persist only on explicit save/clear actions or other explicit sharing controls, not on passive input repaint.
- Local project share preferences should be persisted client-side per project root and default to not shared until the user turns a floor on.
- Toggling a floor's `Shared` state should update the button immediately in place and must not rebuild or blank the office floor shell.
- The browser should broadcast only local project roots whose `Shared` floor toggle is on and whose snapshot has active agents.
- Remote workspace activity should merge into locally matching workspaces regardless of the receiver's local `Shared` toggle; the toggle controls outbound publishing. If weekly local retention has hidden the matching project, current active peer activity should create a temporary read-only remote-only floor.
- A newly observed peer payload should trigger one debounced local fleet reply so late joiners receive already-published activity without waiting for the next unrelated fleet refresh; replies must not form a broadcast loop.
- Shared workspace matching should prefer Git repository identity whenever the sender provides it and use normalized workspace names only when repository identity is unavailable, preventing unrelated same-named projects from merging.
- Remote snapshots without active agents should stay hidden instead of creating or preserving a room/floor.
- Each floor header should list the active participant nicknames currently visible in that workspace.
- Remote shared-room agents should preserve peer labeling and shared-room context so they remain visibly distinct from local sessions.
- Shared-room broadcasts should also preserve each participant's selected `hatId`, and remote merged agents should keep rendering with that hat even when the local viewer has chosen a different one.
- Turning a project from shared to not shared should remove it from subsequent room payloads and hide any remote-only floor on other connected clients without an additional project cooldown. A disconnected peer may remain visible only through the normal bounded multiplayer stale-peer window.
- Screenshot mode should disable shared-room sync.
- `/api/multiplayer` should expose the current server multiplayer transport status even when the transport is currently disabled.
- The CLI should be able to read the running local web server's shared model with `web query <repo> <gist|recent|last>`, scoped to `local` or `team`, without gaining any write, reply, file-read, or arbitrary-command capability.
- `web query <repo> gist` is the dedicated light checkup path before deeper inspection. It should return a short state sync containing top hot file changes from `activity.hotChanges` plus active agents with state, last message, and last file change.
- `recent` and `last` are deeper bounded projections for agents/events when the gist suggests overlap, blockers, or missing detail.
- `scope=team` should use only the coordinated multiplayer fleet already rendered by an open browser client; if no shared-room cache exists, it should report local data rather than attempting to connect directly to the shared-room transport.
- Web CLI APIs should be loopback-only, bounded, projected to recent agent/event data, and should not expose raw shared-room credentials or mutable browser action surfaces.

### Boss / lead behavior

- Lead sessions with active subagents should move into a dedicated left-side boss-office column.
- Each boss slot in that column should render as a compact office shell with the boss workstation placed inside the office footprint.
- The boss-office column should start one floor tile below the floor start and continue contiguously to the bottom of the room.
- In the standard room height, the default internal boss-office layout should fit four stacked bosses by using contiguous 3-tile-tall office slots with no vertical gap.
- The boss-office column must stay compact enough for several bosses to stack vertically on the left side of the room without consuming the main desk floor.
- Boss-to-subagent relationships may be shown on hover, but they should stay secondary to desk occupancy and scene motion.
- Any lead session with visible subagents should be eligible for boss-to-subagent hover arrows, even if it has only one subagent and therefore remains in the ordinary workstation layout instead of the boss-office column.
- Boss-to-subagent relationship arrows should only appear when the user is hovering or focusing that boss in the scene; hovering a child, a generic desk agent, or a session card should not reveal them.
- Relationship arrows should render above offices and avatars inside the map scene, but still remain behind toasts, hover cards, and other browser chrome.
- Relationship arrows should use smooth spline-like curves with explicit arrowheads aligned to the curve's end direction so the target is unambiguous.
- Boss office footprint should come from internal tile settings rather than per-renderer pixel literals.
- If the selected workspace is otherwise empty, the rec area may temporarily show up to the 4 most recent resting lead sessions from other tracked workspaces until local workspace activity exists.

### Desk spacing and grouping

- A desk pod is the basic active-work prefab and should keep a stable tile footprint.
- Desk pod origins should snap to the same tile grid used by rec-area furniture instead of starting from free-floating pixel math.
- Related work should stay visually grouped by cubicle/workstation group before spilling into a new column.
- Space between related-work cubicle groups should stay tighter than space between major desk columns.
- The current internal defaults are:
  `space between cubicle groups = 1 tile`
  `space between columns = 3 tiles`
- A single occupied two-seat pod should keep the live workstation anchored to a real seat cell on the grid instead of recentring within the whole pod footprint.
- The two seat cells inside a pod should be tile-aligned halves of that pod footprint so the workstation and avatar read as part of the same pixel grid as the surrounding room furniture.
- By default, the first occupied seat in a two-seat pod should use the left seat cell, and a newly added second seat should grow in the right seat cell.
- Within a two-seat pod, left/right seat choice should remain stable for an already-seated agent whenever possible, including across ordinary rerenders and refreshes.

### Rec-area placement

- The rec strip belongs on the upper floor band, not as a detached inset room.
- Rec-area furniture should start on the first row of the tile grid.
- Rec-area furniture should not extend deeper than 2 tiles from the start of the floor grid.
- Waiting and resting agents can occupy the walkway / wall-side slots beneath that first furniture row.
- The rec strip should use the same PixelOffice object language as the work floor: vending, shelf, sofa, counter, plants, doors, and wall props.
- Sofa placement is furniture-relative. If the sofa moves, the derived idle/rest seats move with it.
- Facility-provider placement is also furniture-relative. If a provider furniture item moves, agents must walk to that furniture item's current live service point instead of an old default tile.
- Rec-room seat stability matters more than strict most-recent sorting once an agent is already visibly seated; ordinary updates should not create a visible shuffle party.

### Idle rec-area behavior

- Resting lead avatars in the rec area should occasionally mirror their facing direction while seated.
- Idle seated flips should happen on a randomized interval between 4 and 20 seconds.
- Resting lead avatars may autonomously stand up, walk to a rec-area facility provider, collect one serviced item, and return to their sofa seat with that item held in-hand.
- Resting lead avatars should visit providers relatively rarely instead of pacing constantly; the current default trip interval is a randomized 30 to 90 seconds.
- Resting lead autonomous walks should read as leisurely movement, at about 60% of the regular avatar travel speed.
- After returning to the sofa, the held item should follow the avatar hand position until its per-item hold duration expires.
- The first implementation uses a default hold duration of 15 seconds per item, while still allowing duration overrides per serviced item in configuration.
- If a resting lead stops being idle/done and becomes active again before the hold duration ends, the held item should be discarded immediately with a small jump-plus-fade animation and must stop following the avatar.

### Facility providers and held items

- Rec-area furniture should be expandable through a provider definition model instead of one-off hard-coded logic per furniture sprite.
- A facility provider definition should live on the furniture item itself and contain:
  - a randomizable list of serviced item ids
  - a live service tile definition derived from the placed furniture position
  - an optional visual approach offset so the avatar can keep its 1x1 foot collider on the walkable tile while reaching closer to the furniture sprite
- A held-item definition should live in startup-loaded scene config and contain:
  - the sprite key to render
  - the default hold duration
  - the hand offset for where it should follow the avatar sprite
- Held-item rendering should treat source sprites as base 16px pixel art by default, then apply one global held-item scale from scene config so all carried items can be made smaller together without editing each item entry.
- Initial provider/item mappings:
  - bookshelf provides `book`
  - water machine / cooler provides `water-bottle`
  - snack machine / vending provides a randomizable pool including `snack` plus soda and juice variants
- The runtime should make it easy to add new providers and new serviced items without editing the core routing logic.

## State and workload rules

- `waitingOnApproval` maps to `blocked`.
- `waitingOnUserInput` maps to `waiting`.
- failed command or turn state maps to `blocked`.
- in-progress turns map to active desk work unless a more specific state exists.
- `plan` items and in-progress turns without stronger evidence map to `planning`.
- `thinking` is reserved for stronger signals such as live reasoning, commentary, or context compaction.
- Secondary adapters should follow the same rule where possible: generic active-but-unspecified state should prefer `planning`, while `thinking` should imply visible reply/reasoning/compaction evidence.
- recent completed replies map to `done`.
- old inactive threads map to `idle`.
- `needsUser` waits keep a raised-hand marker above the actor's head; blocked errors without `needsUser` use the exclamation marker only when the block is backed by explicit system or failed activity evidence.
- `thinking` uses the light marker above the actor's head only before the first visible assistant message/toast arrives.
- `planning` uses the clipboard marker above the actor's head.
- head markers render at a reduced small-icon size so they stay readable without overpowering the sprite or toast layers
- seated active desk states should not all share one generic bob; planning, scanning, editing, running, validating, and delegating should each have distinct but subtle micro-motion
- when the exclamation marker is shown, the hover summary should prefer the current error detail over stale latest-message text
- blocked failure hover summaries should render that error text in red so it reads as the reason for the `!`, not as ordinary chat

Current-workload rules:

- local threads stay current while the live monitor still considers them ongoing
- `notLoaded` threads still stay current when `thread/read` shows an in-progress turn
- fresh read-only `notLoaded` desktop threads without a final answer stay current through quiet text gaps, with `thread/list` freshness overriding stale `thread/read` timestamps for that classification
- recent non-final local work events can keep desktop-backed threads current through temporary `readOnly` or `idle` observer gaps
- fresh unhydrated `notLoaded` timestamps with no readable turns get an about-8-second planning-current window after a user prompt; older fallback rows cool out instead of staying desk-seated
- observer-owned unload/runtime-idle transitions do not count as a stop by themselves; `thread/status/changed -> notLoaded` may trigger a reread, but an already observed ongoing thread remains ongoing unless that reread finds a final answer
- non-final turn completion/interruption does not count as session completion; only final-answer completion or hard terminal state should start the desk cooldown
- recent non-final, subscribed, or transiently `notLoaded` local desk-live states can stay current for about 3 minutes as a fallback between updates, while explicit live-monitor `isOngoing` state remains current without that age cap
- once a local top-level thread actually stops, it should keep its workstation for about 3 seconds so the last reply can still be read before cooling into rec-area idle visibility
- stale local `notLoaded` threads that are no longer ongoing must not keep a workstation just because freshness/currentness still marks them recent
- completed process-only items such as `plan`, `reasoning`, and `contextCompaction` should settle to `done` while recent, then age to `idle`; they must not leave a finished thread stuck in synthetic `thinking`
- stale blocked/waiting history should not remain current forever without ongoing state or a current user need
- browser workstation seating may be intentionally stickier than raw `isCurrent` only for truly ongoing live local work and the explicit stop cooldown, not for stale `notLoaded` summaries

## Notifications and toasts

- File changes, commands, approvals, input waits, turn lifecycle events, and useful reply text should surface as toasts.
- Command-window toasts should aggregate per agent instead of stacking duplicates.
- Keep one command toast per agent, append new command lines at the bottom, and cap it at 3 visible lines.
- Read-like shell actions such as `sed`, `cat`, `rg`, `ls`, `find`, and `tree` should collapse into short summary toasts instead of echoing raw commands.
- Message/reply toasts may replace older toasts for the same agent/thread so the latest speech stays readable, but they must not clear unrelated agents' active toasts.
- Final reply text should not disappear just because command/read toasts also happened on the same thread.
- Agent-anchored toasts should track the agent root while the agent is moving, instead of staying frozen at the original spawn point.

## Visual expectations

- The office map should communicate state mostly through motion, placement, hover cards, and the session panel.
- Clicking a replyable scene agent should open one compact chat panel on the right edge of that project floor, not a card anchored above the avatar.
- While a scene chat panel is open, hover tooltips should close and remain closed until the chat closes.
- The scene chat panel should use compact pixel/toast-like message bubbles, stay inside the visible floor viewport, and slide in/out quickly.
- Live refreshes must not recreate an already-open scene chat panel or replay its slide-in animation. Update keyed message rows in place, animate only newly appended bubbles from the bottom stack, and avoid full scene redraws for text-only thread changes.
- If the user is scrolled to the bottom of the scene chat history, new messages should keep the history pinned to the bottom. If the user has scrolled upward, refreshes should preserve that reading position.
- Scene chat message bubbles should clamp long content to eight visible lines with a tappable `Show more` / `Show less` control. Command-style entries should use the command toast/window visual language and thread/event icons where available.
- A resting agent with an open chat should stage slightly left/down from its idle position. Closing without sending should dismiss it back to idle placement, while sending should close the chat and reserve a short desk-work intent until official live state seats it at a workstation.
- Entering, leaving, and seat-change movement should read as short routed walks across the floor, not teleports between idle and desk states.
- Ordinary polling or view refresh must not look like movement. If a destination did not meaningfully change, the agent should keep its current placement.
- A visible room change should render as two motions: an old-room exit toward that room's door and a new-room entry from the destination room's door. The renderer must not reinterpret old-room coordinates inside the destination room.
- Avoid large task-title overlays inside the room scene.
- Keep Codex-native typed state visually distinct from inferred Claude state, including inferred Claude workflow/subagent children, while allowing typed Claude hook activity to reuse common visual families such as file-change, command, and delegated-agent work.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
- Exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled intentionally from the asset sheet, not from a pasted example scene.
- Tile translation should preserve the feel of the existing PixelOffice scene language even when exact pixel-for-pixel placement is relaxed.
- Temporary placeholder geometry is acceptable during development, but not as the final renderer language.

## Runtime expectations

- Treat the listener on `4181` as explicit runtime state.
- Do not assume the browser matches the latest source tree until the server has been rebuilt and restarted.
- `api/server-meta` is the source of truth for PID, start time, build time, fleet mode, and live bound projects.
- `api/fleet` is the source of truth for the current normalized fleet snapshot.
- `api/events` is the live SSE stream for browser fleet refreshes.
- `api/settings/integrations` is the machine-local browser integration settings surface, currently used for Cursor API key storage.
- `api/multiplayer` reports the current multiplayer transport status, even when that status is disabled or placeholder-only.
- In fleet mode, cloud polling should run once centrally and be shared across monitors.
- Rate limits from the cloud surface should degrade into a human-readable note plus backoff, not repeated raw per-project failure spam.

## Internal doc map

- [agent-workflows.md](./agent-workflows.md)
  GPT-5.6 Codex configuration, roles, delegation, permission boundaries, skills, and workflow validation.

- [architecture.md](./architecture.md)
  System design and module ownership.
- [integration-hooks.md](./integration-hooks.md)
  Exact upstream surfaces and how they map into the product.
- [self-development.md](./self-development.md)
  Improvement priorities.
- [references.md](./references.md)
  External sources.
