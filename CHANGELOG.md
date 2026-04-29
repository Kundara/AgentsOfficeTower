# Changelog

All notable changes to this project should be recorded in this file.

This changelog is maintained against the current root `package.json` version.
Entries stay under the active version until an explicit version bump is requested.

## [0.1.0] - 2026-03-25

### Added

- Added browser-side approval actions to the durable `Needs You` queue for local typed Codex approval waits, allowing `Accept`, `Always for session`, `Decline`, and `Cancel` decisions to flow back through the app-server observer connection.
- Added inline `Needs You` input composers for local typed Codex `tool/requestUserInput` waits, sending schema-backed `answers` payloads back through the app-server observer connection.
- Added inline `Reply` composers to app-server-owned local typed Codex session cards, routing follow-up text through app-server so idle threads resume with `turn/start` and active turns accept nudges through `turn/steer`.
- Added hook-backed Claude `Needs You` actions for typed `PermissionRequest` and schema-backed `Elicitation` waits, using a local response-file bridge plus synthetic queue-clearing sidecar markers so browser approvals and form answers can flow back into the Agent SDK hooks.
- Added scene-click thread cards for local Codex agents, exposing recent typed thread history directly from the office map with reply controls only when the thread is owned by the same app-server connection.

- Added a machine-local image-only hat selector in the browser `Settings` popup, with a first `no hat` option and immediate application across the local player's visible agents.
- Added hat manifest entries under `packages/web/src/config/pixel-office-manifest.json`, including shared default scale/offset values plus per-hat override hooks for outlier sprites.

### Changed

- Changed Codex app-server reply payloads to match the current generated schema, including `text_elements: []` on text turn inputs, `{ decision }` approval responses, MCP elicitation responses, and permission-profile approval responses.
- Changed Claude Agent SDK integration to `@anthropic-ai/claude-agent-sdk` `^0.2.118` and added typed coverage for newer hook events including `PostToolBatch`, `UserPromptExpansion`, `PermissionDenied`, and `TaskCreated`.
- Changed Cursor cloud API requests to prefer the documented Bearer-token authorization path before falling back to the older Basic-auth compatibility path.
- Changed per-project Agents Office state so room configs, appearance rosters, presence snapshots, Claude hook bridges, and Cursor hook sidecars now write into machine-local Agents Office user data keyed by project root instead of creating or mutating `.codex-agents/` inside the tracked project.
- Changed the browser `Needs You` input cards to show required/optional question labels, per-request completion summaries, clearer missing-answer guidance, and explicit clear actions so multi-question prompts read more like structured forms than raw field dumps.
- Changed the browser chat surfaces so scene thread cards, reply composers, and `Needs You` input cards use compact message bubbles, grouped controls, and consistent field styling instead of inline raw form fragments.
- Changed scene agent chat so the thread panel is a compact right-edge floor dock with slide motion instead of an avatar-follow card, suppressing hover tooltips while open and staging resting agents slightly left/down until close or send.
- Changed scene chat refresh handling so an already-open thread panel is reconciled in place instead of recreated, with keyed message bubbles, bottom-follow scrolling, new-message-only animation, eight-line `Show more` clamps, and toast-inspired command/icon styling.
- Changed the browser `Needs You` queue so app-server-owned local Codex input waits without schema-backed questions can open the inline reply composer directly, while observed desktop, VS Code, and CLI threads keep the raw `codex resume ...` fallback.
- Changed local Codex workstation seating so fresh read-only turns without a final answer stay desk-seated through quiet text gaps and only release after the finished-workstation cooldown.
- Changed the browser office scene so recent typed `turn/started`, `turn/completed`, `turn/interrupted`, and `turn/failed` events now raise short above-head Pixi badges (`START`, `DONE`, `STOP`, `FAIL`) in addition to the existing toast treatment.
- Changed the browser office animation so waiting desk work now pulses its cue, blocked desk work gets a subtle shake treatment, and validating desk work uses a brighter pulsing workstation glow instead of the generic busy glow.
- Changed seated active desk animation so planning, scanning, editing, running, validating, and delegating work now use distinct micro-motion profiles instead of one shared bob.
- Changed scene movement so visible room changes now render as a doorway exit in the old room plus a doorway entry in the destination room, instead of retargeting one live sprite across rooms.
- Changed motion reuse so tiny same-slot refresh deltas now keep the settled target instead of triggering unnecessary reroutes on ordinary polling.
- Changed scene event visibility so recent typed plan, command, file/diff, and tool-call events now raise short animated `PLAN`, `RUN`, `EDIT`, and `TOOL` cues near the actor in addition to their toast treatment.
- Changed request lifecycle visibility so typed approval waits, input waits, and request resolution now raise short animated `WAIT`, `ASK`, and `OK` cues near the actor in addition to the durable queue and toast surfaces.
- Changed activity/request cue rendering so those chips now include mode-specific icon adornments and icon-side motion instead of relying on color and text alone.
- Changed workstation activity rendering so recent typed command, edit, tool, approval, input, and resolve events now also raise short mode-specific desk-side Pixi effects instead of depending only on floating cue chips.
- Changed request workstation effects so approval waits now reflect decision breadth/type and input waits now reflect question and required-answer load instead of reusing one generic approval/input pulse.
- Added a `/scene-effects-audit` browser route that runs the normal client bundle against mocked typed approval/input fleet data so the new request-specific scene effects can be visually checked on demand.
- Changed the scene audit fixture so mocked request threads now include typed message history, making the new click-open thread cards visually inspectable on the audit route as well.
- Changed shared-room fleet payloads so each peer now broadcasts its selected `hatId`, letting merged remote agents keep their own hat styling instead of collapsing to the viewer's local cosmetic choice.
- Changed avatar rendering so hats are now attached to the same Pixi motion/depth pipeline as the base avatar sprite, keeping hats aligned through seating, walking, fading, and workstation occlusion.
- Changed Codex scene thread panels to read-only history only, removing browser Send fields and local resume/launch/copy controls from the in-scene agent chat.

### Fixed

- Fixed fleet autodiscovery on Windows so the browser keeps the launched seed workspace visible when another adapter discovers work first, recognizes `codex.exe` PATH candidates, normalizes Codex app-server `\mnt\c\...` roots onto `/mnt/c/...`, and sends Windows-native cwd filters back to the app-server so those projects can populate their agents.
- Fixed browser `Needs You` approval actions for current Codex app-server builds by sending approval responses as structured JSON-RPC results instead of bare decision strings.
- Fixed browser Codex replies for current app-server builds by sending the required `text_elements` field on text turn inputs.
- Fixed browser chat action submissions so a stalled local app-server request times out with a visible error instead of leaving the composer stuck in a permanent sending state.
- Fixed browser Codex reply submissions so desktop thread attach/reread/steer work gets a longer dedicated timeout instead of aborting after the generic 15-second action budget.
- Fixed browser Codex reply routing so observed desktop, VS Code, and CLI threads are rejected server-side instead of attempting `turn/start` / `turn/steer` from the observer connection and hanging or creating a detached side turn.
- Fixed command and file activity cue styling so the in-scene `RUN` / `EDIT` chips use the existing dark pixel toast palette instead of a bright rounded badge that looked unrelated to the rest of the office UI.
- Fixed scene chat opening so clicking an agent renders the thread panel immediately and repeated clicks on the same character keep it open instead of toggling it closed.
- Fixed local Codex currentness when `thread/list` reports a fresh desktop-backed thread but `thread/read` returns a stale transcript timestamp, preserving the fresher list timestamp for workload classification.
- Fixed local Codex threads that are still producing fresh non-final command/tool/file activity so they reserve a workstation even when the observer is temporarily `readOnly` or the app-server top-level thread status temporarily reads `idle`.
- Fixed desktop reread fallback messages so commentary stays `Reply updated` and only `final_answer` assistant messages become `Reply completed`, preventing active work from starting the finished-workstation cooldown too early.
- Fixed subscribed desktop final replies that update `latestMessage` but miss the live message event by letting hydrated rereads backfill a deduped `thread/read/agentMessage` toast event.
- Fixed active Codex workstation release so `thread/closed`, non-final `turn/completed`, and non-final `turn/interrupted` no longer send an active desktop session back to the rec area between assistant progress updates.
- Fixed desktop `notLoaded` prompt handling so fresh unhydrated rows reserve a desk for about 8 seconds after the user types, while stale finished fallback rows use the 3-second cooldown instead of keeping completed threads looking active for about a minute.
- Fixed Codex request parsing so MCP elicitation requests, permission-profile approval requests, and legacy approval request names surface as typed waiting or blocked work instead of disappearing from the durable queue.
- Fixed Windows Codex runtime candidate ordering so a native `codex.cmd` on `PATH` is tried before WSL fallbacks, matching the documented CLI-first behavior.
- Fixed workspace discovery path normalization so Codex desktop wrapper roots like `/mnt/c/.../app/resources/\\?\F:\...`, nested drive roots like `/some/project/F:/...`, and Windows extended-drive roots like `\\?\F:\...` now collapse onto the real WSL project root instead of showing duplicate empty workspace floors.
- Fixed existing project setups after the storage move by keeping legacy project-local `.codex-agents` room, roster, and hook files readable as a fallback until they are regenerated in user data.
- Fixed local Codex `tool/requestUserInput` validation so questions marked `required: false` can actually be omitted from the submitted `answers` payload, matching the browser queue and Claude hook behavior.
- Fixed browser message toast timing so typed Codex reply events now surface from `snapshot.events` immediately, instead of waiting for per-agent summary fields like `latestMessage` to catch up first.
- Fixed browser message toast replacement scope so a new reply toast now clears older toasts only for that same agent/thread, instead of wiping unrelated active toasts globally.
- Fixed browser workstation seating so local Codex sessions in a `waiting` state now still count as desk-live during read-only or transient `notLoaded` gaps, preventing in-progress agents from dropping into the rec room between subagent/input waits and the next reply chunk.
- Fixed browser Codex replies for app-server-owned active threads so the monitor rereads missing turn state and uses `turn/steer`, refusing to fall back to `turn/start` when no live turn is steerable instead of creating a detached side turn.
- Fixed shared-room self-duplication so the browser view and VS Code panel now reuse the same machine-local multiplayer device identity, preventing the same user's Codex agents from reappearing as remote peers when both clients join the same room.
- Fixed exit-scene continuity so doorway departure ghosts now survive scene refreshes long enough to finish their walk-and-fade instead of getting reset mid-exit.

### Docs

- Updated integration-hook and reference docs with the verified current Codex app-server request/response payloads, newer Claude hook-event coverage, and Cursor cloud Bearer-auth behavior.
- Updated AGENTS, README, product spec, architecture notes, integration hooks, and self-development guidance to describe the move from project-local `.codex-agents` writes to machine-local per-project Agents Office storage.
- Updated the README, architecture notes, product spec, integration hooks, and self-development roadmap to document actionable local approval handling in the browser `Needs You` queue and to narrow the remaining gap to general input/reply flows.
- Updated the README, architecture notes, product spec, integration hooks, and self-development roadmap to document actionable local `tool/requestUserInput` handling in the browser `Needs You` queue.
- Updated the README, architecture notes, product spec, and self-development roadmap to document the new scene-native turn lifecycle badges and to promote them into the acceptance checks.
- Updated the docs to record the verified `tool/requestUserInput` response schema, queue submit gating, and the end-to-end mock app-server validation path used to confirm the browser action flow.
- Updated the README, architecture notes, product spec, integration hooks, and self-development roadmap to document that scene thread panels are read-only history, while inline browser Codex replies remain limited to app-server-owned non-scene controls.
- Updated the README, architecture notes, product spec, integration hooks, and self-development roadmap to document the new hook-backed Claude browser action path and to clarify that Cursor remains read-only.
- Updated the README, product spec, architecture notes, and self-development roadmap to document doorway-based room-change motion, preserved exit ghosts across refreshes, and the tighter no-op motion reuse rule.
- Updated the README, product spec, architecture notes, and self-development roadmap to document the new typed `PLAN`/`RUN`/`EDIT`/`TOOL` activity cues and their acceptance checks.
- Updated the README, product spec, architecture notes, and self-development roadmap to document the new typed `WAIT`/`ASK`/`OK` request lifecycle cues and their acceptance checks.
- Updated the README, product spec, architecture notes, and self-development roadmap to document the richer icon-and-motion treatment for typed activity/request cues.
- Updated the README, product spec, architecture notes, and self-development roadmap to document the new workstation-side non-text activity effects and their acceptance checks.
- Updated the README, product spec, architecture notes, and self-development roadmap to document the new structured request signatures inside workstation-side approval/input effects.
- Updated the README, architecture notes, and self-development checks to document the new `/scene-effects-audit` visual verification route.
- Updated AGENTS, README, architecture notes, integration hooks, product spec, and self-development checks to document read-only Codex desktop seating through quiet text gaps, `thread/list` freshness preservation, the 8-second unhydrated prompt reserve, and the 3-second top-level desk cooldown.

- Updated the README, product spec, architecture notes, and self-development checks to describe the new hat selector, config-driven hat placement, and shared-room hat propagation.

### Changed

- Changed the VS Code activity-bar surface to embed the real Agents Office renderer for the current workspace through a local web server, replacing the older simplified placeholder room-grid view.
- Changed the VS Code activity-bar container title from `Codex Office` to `Agents Office Tower` so the panel label matches the product name and installed extension display name.
- Changed the web server startup order so it binds the HTTP listener before fleet warmup, letting UI clients connect immediately while monitors finish warming in the background.

### Fixed

- Fixed restarted live Codex recovery so startup now seeds project discovery from the app-server loaded-thread set and continues subscribing older in-progress threads, preventing the office from settling on historical rows while missing the actually current desktop thread.
- Fixed current-workload bridging for recent local `notLoaded` Codex replies after restart so a stalled `thread/resume` attach does not immediately cool the just-active desktop thread out of the office before recovery has a chance to catch up.
- Fixed the browser workstation policy so those same restart-bridged current local `notLoaded` replies stay seated on-desk for the quiet-live window instead of dropping into rec-room behavior after the short done cooldown.
- Fixed local Codex workstation seating so threads that are still in progress stay at their desks through quiet gaps between messages instead of bouncing into the rec area until the next event arrives.
- Fixed busy-session classification so ongoing local Codex threads stay treated as active in session-oriented browser views even when transport status briefly lags behind the underlying in-progress thread.
- Fixed Windows-hosted Codex runtime selection so mixed Windows+WSL setups prefer the WSL-backed Codex CLI when available, keeping the VS Code panel aligned with browser-visible WSL Codex activity instead of silently falling back to a narrower Windows-local view.
- Fixed Windows-backed WSL project identity matching so the VS Code embedded office no longer splits the same repo across mixed-case `/mnt/...` paths, which had been hiding Codex activity on a duplicate floor and could make local Cursor sessions appear twice.

### Changed

- Changed the file-size guard so generated `packages/web/src/client/app-runtime.ts` no longer blocks the release gate as if it were hand-authored source, while the remaining oversized transitional web runtime/style files now use explicit temporary ceilings instead of one blanket limit.
- Fixed the VS Code embedded server launch on Windows+WSL so it runs inside a login shell with `CODEX_HOME` preserved, restoring Codex session visibility in the activity-bar panel.
- Fixed `/api/server-meta` and home-route startup timing so those endpoints return immediately from the in-memory project list instead of blocking on project discovery.
- Fixed live monitor startup so the first snapshot is no longer blocked on thread subscription sync, reducing empty-office warmup stalls.

### Added

- Added extra vending-machine drink variants for idle rec-room visits, including soda and juice held items sourced from Alex's CC BY 4.0 `100 pixel food icons pack`, with README attribution for the new asset library.
- Added per-project shared-room broadcasting controls in the browser floor headers, persisting each local project's `Shared` preference client-side so users can opt specific floors out of PartyKit room sync without leaving the room.
- Added a shared adapter contract in `packages/core` with a static built-in registry for Codex local/cloud, Claude, Cursor local/cloud, OpenClaw, and presence sources.
- Added a shared snapshot assembler plus refresh-scheduler/domain helper layers so snapshot assembly, room mapping, and workload-currentness policy are no longer spread across several source-specific call sites.
- Added a bundled external browser client build under `packages/web/dist/client`, replacing inline HTML delivery of the main browser JS/CSS payloads.
- Added repo rail guards for file-size limits and import-boundary checks, plus adapter-registry and bundled-client asset tests.
- Added a server-backed Cursor API key field in the web Settings popup, persisting a machine-local key outside the repo so Cursor background-agent visibility can be enabled once without relaunch-time env wiring.
- Added inferred local Cursor session support by reading Cursor workspace storage and recent logs, so repos opened in the local Cursor app now surface read-only local Cursor activity alongside cloud agents.
- Added a neutral multiplayer status interface in the web server so a secured sync transport can plug in later without another contract change.
- Added browser-side PartyKit shared-room settings with persisted `host`, `room`, and short `nickname` inputs, publishing all tracked workspace activity into the room and labeling remote agents with that nickname when available.
- Added a bundled PartyKit relay package in `packages/party` plus root `party:dev` and `party:deploy` scripts so the shared-room transport can be hosted from this repo.
- Added a persisted shared-room on/off toggle so users can stop syncing without clearing the saved PartyKit host and room.
- Added this changelog and a repo-level maintenance policy for tracking notable additions, fixes, and behavior changes.
- Added a grid-first scene layout foundation in the web renderer with explicit tile-based scene configuration and scene grid helpers aligned to the `16px` PixelOffice unit.
- Added persisted browser scene settings and local furniture layout overrides, including a user-facing text-scale control for the office view.
- Added Windows Codex command fallback support by extracting the Microsoft Store app bundle into a local cache, with WSL path conversion support for mixed Windows/WSL setups.
- Added an opt-in OpenClaw integration that reads official Gateway session and config surfaces, discovers recent OpenClaw workspaces, and maps matching OpenClaw sessions into the shared office snapshot model.
- Added a Claude Agent SDK bridge in `packages/core` that can write typed Claude hook sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl` for stronger session and tool correlation.
- Added committed project-level Cursor hooks in `.cursor/hooks.json` plus a repo hook recorder script that writes typed local Cursor sidecars into `.codex-agents/cursor-hooks/<conversation-id>.jsonl`.
- Added a root `npm start` bootstrap flow that installs if needed, rebuilds the workspace, and launches the web server on `4181`.

### Fixed

- Fixed shared-room settings so host, room, and nickname now restore from machine-local Agents Office user data on launch, no longer disappear on refresh, and no longer fight active input while the user is typing in the Settings popup.
- Fixed Codex reply-event precedence so a streamed `item/completed` final answer now keeps ownership of the visible latest reply even if a later `thread/read/agentMessage` fallback arrives from a stale reread, preventing the UI from briefly snapping back to older commentary text after the real final answer already rendered.
- Fixed live workstation z-ordering so the assembled client runtime preserves workstation shell depth metadata instead of dropping it through a duplicate sprite factory, which had been forcing desk computers back onto fixed layer `9` and bypassing the row sorter entirely.
- Fixed seated workstation layering so mounted users now win the same-row tie against their own workstation shell, keeping the avatar visually above the computer while still letting higher-row passersby stay behind the desk.
- Fixed workstation occupant layering so any avatar mounted on a workstation slot now keeps that front-layer priority even outside the narrow active-seat state set, instead of dropping behind the chair/computer until the state became fully active.
- Fixed workstation startup posing so idle and done desk occupants now use the same seated mount pose as active workstation users, instead of starting in the old standing pose and only looking correctly mounted once an active desk animation kicked in.
- Fixed workstation startup posing for blocked and fallback desk states too, so workstation occupants no longer spawn in the side-standing branch before later transitions move them into the seated mount pose.
- Fixed room-scene z-ordering so moving agents now sort from their current logical foot-tile row while workstation shells and seated avatars sort from the workstation footprint row, keeping higher-row snack-route pass-bys behind desk computers.
- Fixed workstation occlusion depth so desk computers keep a small extra front-plane inset, preventing passersby from popping over the screen while their feet are still only barely below the desk row.
- Fixed hover cards and session labels so path-heavy Codex titles/messages are normalized instead of surfacing raw `/mnt/...` workspace paths as the primary visible title.
- Fixed finished subagent visibility so child sessions keep a longer readable cooldown, take the door-exit path, and then fall out of recent-session UI instead of lingering like ordinary history.

### Fixed

- Fixed scene/session title display so path-heavy helper labels such as `Read /mnt/...` now normalize into repo-local file labels instead of leaking raw WSL mount paths into hover cards and session titles.
- Fixed departing scene retention so finished agents keep enough ghost lifetime for the room-door exit walk to render reliably, with subagents holding that exit state longer than top-level leads.

### Changed

- Changed actor placement so normalized `waiting` sessions now stay on-desk instead of moving into the rec strip, and the browser docs/spec now separate universal modes from the renderer's actor behavior states.
- Changed the per-floor shared-room `Shared` toggle to update immediately in place instead of waiting for a later workspace rerender, avoiding one-frame office-scene blanking while connected to a room.
- Changed shared-room rendering so remote-only projects exposed by the room now stay visible as standalone floors, show active participant nicknames in the title bar, grey titles slightly when they are not local, and cool down for 1 hour before disappearing after updates stop.
- Changed browser state cues so desk actors now get above-head RPGIAB markers for needs-user waits, typed thinking, planning, and blocked error states, layered below the toast system.
- Changed Codex thread summarization so `plan` items and in-progress turns without stronger evidence map to `planning`, reserving `thinking` for stronger reasoning/commentary/compaction signals.
- Changed state-marker rendering so the above-head icons now render about one-third smaller, keeping them legible but less visually heavy over the actor sprites.
- Changed Cursor local typed state fallback so generic active hook/transcript states prefer `planning`, reserving `thinking` for clearer response, reasoning, or compaction evidence.
- Changed the thinking light marker so it only shows before the first visible assistant message/toast arrives, preventing the light bulb from competing with actual reply text.
- Changed the blocked failure marker to an exclamation icon so hands stay reserved for human-needed states, and kept it restricted to explicit `systemError` or failed command/file/tool activity.
- Changed blocked failure hover cards so they prefer the current error detail, making the reason for the exclamation marker visible without opening logs.
- Changed blocked failure hover summaries to style the current error text in red so the exclamation reason reads as an error state instead of a normal message.
- Changed browser workload visibility so runtime-active local subagents stay seated/visible even when `isCurrent` momentarily shifts to another related thread update, matching the scene's current-workload-first rules more closely.
- Changed subagent post-finish handling so finished subagents keep a longer in-scene cooldown before they walk out through the room door, making boss/subagent completion easier to read in the office view.
- Changed browser agent/session title rendering to normalize repo-local path-heavy labels instead of surfacing raw WSL-style `/mnt/...` paths as the primary visible title.
- Changed rec-room idle behavior so seated flip timing is slower, provider trips are much rarer, resting avatars walk at 60% speed, provider approach points can visually reach closer to furniture, held items now render from a shared 16px base with a global scale control, the cooler serves `water-bottle`, and the vending machine serves a mixed snack/soda/juice pool.
- Changed fleet floor grouping so Git worktrees now merge onto one repo floor by default across Codex, Claude, and Cursor snapshots, with a persisted global `Split Worktrees` toggle to restore one-floor-per-worktree layout when needed.
- Changed worktree rendering so split worktree floors now use a bright blue worktree title treatment, and agent hover cards expose the source worktree name to keep duplicate repo clones distinguishable.
- Changed Codex worktree naming so split floors now prefer readable branch-derived labels such as `worktree-floor-merge` over opaque `.codex/worktrees/<id>` folder ids when Git worktree metadata is available.
- Changed several browser icon mappings to use the new RPGIAB pixel pack where the semantics were clearly stronger, including worktree, message, command execution, web search, and image-view icons.
- Reworked the core internals so dashboard snapshot assembly now lives in `snapshot-lib`, app-server event and rollout-hook parsing live in `live-monitor-lib`, and Cursor local/cloud helpers live in `cursor-lib` instead of staying stacked inside `snapshot.ts`, `live-monitor.ts`, and `cursor.ts`.
- Changed the browser runtime composition so `packages/web/src/client/runtime-source.ts` now only joins the final runtime sections; layout, scene, navigation, render, settings, and UI behavior are edited directly in their own section modules instead of being rewritten through string patch helpers.
- Changed the browser client bootstrap so the shipped app now starts from generated `packages/web/src/client/app-runtime.ts` output instead of evaluating a giant runtime string with `new Function(...)`, while the focused section sources remain the editing surface.
- Changed the browser runtime section ownership so workstation/current-workload seat rules now live only in `packages/web/src/client/runtime/seating-source.ts`, while `layout-source.ts`, `render-source.ts`, `scene-source.ts`, `navigation-source.ts`, and `ui-source.ts` no longer leak partial function bodies across file boundaries.
- Changed file-size and import-boundary guards to walk source files with Node filesystem helpers instead of shelling out to `rg`, so the repo rails keep working in restricted environments.
- Changed Codex app-server event handling so `turn/plan/updated` now summarizes the documented `{ explanation?, plan }` payload, `turn/diff/updated` summarizes the documented `{ diff }` payload, and `item/tool/call` is labeled as a generic tool-call request instead of an MCP-specific event.
- Changed fleet startup discovery so Codex workspaces configured in `~/.codex/config.toml` now seed the live project set even before any thread has been spawned in this browser session, and fleet refresh now asks for a broad enough discovery window to keep the full configured/discovered workspace list visible.
- Changed fleet-mode workspace visibility so autodiscovered projects now age out after 7 days without session activity, and config-only Codex roots no longer stay visible unless a session-backed source also reports recent activity for that workspace.
- Changed `buildDashboardSnapshotFromState()` to assemble source snapshots in parallel and evaluate workload currentness against snapshot start time, fixing the stale-freshness race for recently finished local threads.
- Changed project discovery to consult the shared adapter registry instead of hardcoding every secondary source in one discovery function.
- Changed the web server structure to use `server/`, `render/`, and `client/` internal folders while keeping the public routes and `startWebServer` surface stable.
- Changed Cursor API key resolution so saved app settings now backfill `CURSOR_API_KEY` for Cursor background-agent loading across snapshot and watch flows, while the process environment still takes precedence.
- Changed Cursor documentation and settings copy to distinguish automatic local Cursor visibility from optional API-key-backed Cursor cloud/background agents.
- Changed local Cursor session loading so project hook sidecars in `.codex-agents/cursor-hooks` are now the only local Cursor source; transcript and workspace-state inference no longer drive the office view.
- Expanded the shared snapshot shape with git-backed project identity metadata and generic remote-agent provenance so a future secured multiplayer sync path can reuse the existing model.
- Reworked the office renderer around internal scene settings, grid-based placement, and reusable scene render state instead of looser ad hoc layout math.
- Expanded Cursor integration to treat agents as cloud work, support paginated agent fetches, and normalize repository identity across direct repo URLs and PR or merge-request URLs.
- Updated the main docs to describe the new grid-first renderer direction, minimal viewer controls, and the Windows Codex runtime fallback path.
- Reframed the README around the current `Agents Office Tower` product name with a shorter multi-source support matrix instead of a mostly Codex-centric landing page.
- Moved scene controls into a toggleable settings popup in the web header, removing the manual refresh and rooms scaffold actions from the main toolbar and hiding the toast preview trigger.
- Changed the scene text-size slider to apply on release instead of during drag so the settings popup stays stable while adjusting scale.
- Extracted browser toast queueing, stacking, preview, and DOM rendering from the main client script into a dedicated `toast-script` module.
- Extracted PartyKit shared-room transport, settings persistence, and remote fleet merge helpers from the main client script into the dedicated `multiplayer-source` module.
- Removed the unused DOM office-map renderer path from the web client so the browser map now runs through the retained Pixi scene only.
- Changed Claude secondary discovery to prefer the official Agent SDK `listSessions()` and `getSessionMessages()` APIs before falling back to raw JSONL transcript sampling.

### Docs

- Updated the README and architecture/self-development docs to describe the new `snapshot-lib`, `live-monitor-lib`, `cursor-lib`, and browser runtime section boundaries.
- Updated the README and architecture/integration/self-development docs to describe the generated `app-runtime.ts` bootstrap, the single-owner `seating-source.ts` desk policy, and the cleaned runtime section boundaries.
- Documented the current official Codex app-server event coverage more precisely, including the dynamic-tool meaning of `item/tool/call` and the documented notifications we still ignore for workload rendering (`thread/tokenUsage/updated`, `fuzzyFileSearch/*`, and `windowsSandbox/setupCompleted`).
- Updated the README and integration/architecture/reference docs to describe the new Cursor Hooks path, the committed `.cursor/hooks.json`, and the typed `.codex-agents/cursor-hooks` sidecars.
- Expanded the README with explicit step-by-step instructions for copying the committed Cursor hook files into another repo and verifying that local sidecars are being written.
- Updated the README and architecture/self-development docs to describe the adapter-first core layout, async snapshot assembly, and external bundled browser client delivery.
- Added a short PartyKit hosting walkthrough to the README and references so shared-room setup includes the current official create, deploy, and generated-host flow.
- Expanded the README shared-room section with the rebuild steps for a missing `/vendor/partysocket/index.js` browser import and clarified that connection is room-based via shared `Host` and `Room` values.
- Clarified that Codex CLI is the preferred runtime, the desktop app is a fallback, and native Windows can bridge to a WSL-installed CLI.
- Expanded the product spec with the current normalized snapshot definitions, browser/runtime settings surfaces, shared-room behavior, and live API contract notes.

### Fixed

- Fixed worktree floor grouping so the default unsplit tower now collapses Codex worktrees onto one repo floor even when a stale worktree snapshot is missing `projectIdentity`, by falling back to stable repo-origin data and keeping split-only floor badges derived from the worktree path when needed.
- Fixed Pixi office depth sorting so agents and workstation shell sprites now sort from their on-screen foot position instead of fixed layer numbers, preventing walkers from drawing above desks they are still behind.
- Fixed Pixi floor-depth precision so moving agents now sort from their continuous foot position instead of a rounded whole-pixel row, and stopped giving walking avatars an extra front-of-scene bias that could let them pop above lower workstations too early.
- Fixed workstation shell depth anchors so the chair and computer now sort from their own actual bottom edge instead of inheriting the desk panel’s foot depth, which could still leave a visibly lower workstation rendering behind a higher walker.
- Fixed workstation front-edge depth so the computer now sorts from the lower of its own sprite bottom and the desk front plane, preventing agents in higher screen rows from stepping over a workstation that should still occlude them.
- Fixed live motion avatar placement so moving desk agents keep their rendered sprite offsets and rendered height while walking, instead of snapping back to the logical unscaled box and drifting out of sync with workstation occlusion depth.
- Fixed moving desk-agent depth so live sprite motion now keeps using the rendered feet pivot after slot scaling, preventing walkers in higher screen rows from drawing over workstation computers before they actually pass the desk base.
- Fixed the remaining `cursor.ts` monolith by moving Cursor cloud-agent loading, repo normalization helpers, and local discovery into focused modules, bringing the file back under the repo size guard.
- Fixed snapshot activity precedence so a recent typed file-change event can override a trailing summary message without reactivating a completed thread, while fresh command-start events still do not wake a finished desk back into running state.
- Fixed the browser client tests to assert against the real runtime section modules after the runtime patch-assembler removal, so the suite now validates behavior instead of legacy string-rewrite scaffolding.
- Fixed freshly opened or otherwise empty selected workspaces staying visually blank by reusing the 4 most recent resting lead sessions as rec-room placeholders until that workspace has its own live or recent local agents.
- Fixed Codex local state classification so completed command, file-change, and tool turns now settle to done/idle instead of remaining `running`/`validating`/`editing`, and recent command/file events no longer reactivate a thread that already finished.
- Fixed typed Codex `Needs You` handling so approval waits surface as blocked desk work, input waits surface as waiting work, and browser workstation seating now respects those visible states instead of treating every `status.type = active` thread as desk-active.
- Fixed browser desk motion so `running` and `validating` workers stay in the seated workstation pose, and current local desk-live work now gets a short grace window through transient `status.type = notLoaded` gaps instead of bouncing into the rec area between live updates.
- Fixed Codex local live-monitor stop detection so `thread/status/changed -> notLoaded` now waits about 3 seconds and confirms with a reread before clearing ongoing desk work, reducing brief unload/reload desk bounce between live messages.
- Fixed long quiet Codex pauses between reply chunks so recent non-final, subscribed, or transiently `notLoaded` desk-live local agents now remain current and workstation-seated for about 3 minutes before they cool into rec-room behavior.
- Fixed Pixi workstation reveal flicker so newly occupied desks once again carry their `enteringReveal` flags through the assembled scene runtime, and desk returns now blink based on workstation slot transitions instead of only firing for brand-new agent keys.
- Fixed browser scene continuity so current local threads remain visible in the map while they transition between desk and rec-area placement, and active local `idle`/`done` wobbles now get a short desk settle window instead of making the agent and workstation pop out between updates.
- Fixed rec-room rendering so only the 4 most recent top-level resting lead sessions occupy the rec seats, preventing older hidden resters and subagents from wrapping onto duplicate sofa coordinates.
- Fixed rec-room sofa seat anchors so resting avatars now sit on centered cushion points derived from the actual sofa sprite width instead of drifting left from older hard-coded placement offsets.
- Fixed office map scaling so selected and focused single-workspace views now reuse the same compact scene geometry as the tower overview instead of inflating avatars and workstations with a separate prefab scale.
- Fixed desk-pod placement so workstation pods and their internal seat cells now snap back onto the shared `16px` tile grid, matching the rec-strip furniture alignment contract.
- Fixed Codex workstation visibility so local sessions that app-server still reports as `active` no longer fall through the browser’s `waiting/done` seating exclusions and disappear from desks while they are still live.
- Fixed slow desktop Codex observer attaches from degrading too early by widening the live `thread/resume` subscription timeout, so restarted fleet servers recover current threads back to `subscribed` instead of lingering in stale `readOnly` mode.
- Fixed two-seat workstation growth so a pod's first occupied seat stays anchored to its grid cell and a second seat expands on the right instead of recentering the original workstation.
- Fixed workstation desk geometry so adding the right-side seat no longer shifts the already placed left desk shell and computer inside the pod.
- Fixed boss-lane rendering so boss sessions now render inside compact square office shells with centered workstations, using a stacked left-column layout that fits four 3-tile-tall boss offices in a standard room instead of the old rounded offset frame.
- Fixed workspace/project labels in the web UI so camel-case names like `CodexAgentsOffice` and `ProjectAtlas` render with spaces between words.
- Fixed Codex runtime discovery on native Windows so the app can fall back to `wsl.exe --exec codex` when Codex CLI is only installed inside WSL.
- Fixed the silent empty-state path for Cursor integration so snapshots now explain when the current process is missing `CURSOR_API_KEY` or when a project has no `git remote.origin.url`.
- Fixed Claude agent labels so synthetic/system transcript model placeholders like `<synthetic>` no longer appear in the office UI.
- Fixed Cursor project matching when the API only exposes GitHub pull request, GitLab merge request, or similar PR-backed repository URLs.
- Fixed inferred local Cursor chat discovery so a new Cursor chat no longer revives every stale retained composer as a separate live office agent.
- Fixed local Cursor observability by upgrading repos opened in trusted Cursor workspaces from transcript/workspace inference to typed hook-backed session state when the committed project hooks run.
- Fixed the committed Cursor project hook recorder on Windows-style shells by restoring multi-encoding stdin decoding and stable project-root resolution, so fresh local Cursor hook activity writes sidecars again instead of silently dropping payloads.
- Fixed Cursor hook-backed local session selection so stale future-skewed rows in an existing `.codex-agents/cursor-hooks/<conversation-id>.jsonl` file no longer mask newer appended Cursor activity from the same conversation.
- Fixed browser speech bubbles and other display-text surfaces so Markdown emphasis markers like `**bold**` are stripped while preserving the readable text.
- Improved Cursor cloud tracking by polling the official agent conversation API for active/recent agents and mapping newly seen prompts/replies into typed office events without replaying old history on startup.
- Fixed Codex local startup hydration so the first full `thread/read` no longer replays preloaded assistant history as a fresh live reply, while later rereads still surface genuinely new replies.
- Fixed local Cursor active/inactive inference so stale `selectedComposerIds` no longer outrank the most recently focused composer when tab order and actual chat focus diverge.
- Fixed Cursor message toasts so user-authored prompts no longer render as if the Cursor agent said them.
- Fixed workstation occupancy so waiting leads stay on-desk while finished top-level threads keep a 3-second desk cooldown for final-message readability before returning to rec-area idle visibility.
- Fixed workload currentness so future-skewed source timestamps no longer keep finished local threads marked active indefinitely, while genuinely live local sessions still remain visible.
- Fixed Codex local startup hydration so the first fleet snapshot now waits for initial `thread/resume` hydration and immediately rereads resumed threads, preventing an actively replying desktop thread from appearing as stale `readOnly/notLoaded` rec-room idle after a web-server restart.
- Fixed Codex local thread discovery so `status.type = active` sessions are always kept in the tracked startup/refresh set even when newer idle threads would otherwise consume the recent-thread limit, preventing a real active desktop session from appearing only after its first fresh update.
- Fixed browser workstation seating so stale local `notLoaded` threads no longer occupy desks just because workload currentness still marks them recent; only truly ongoing local work or the explicit done cooldown can keep a workstation.
- Fixed Codex desk occupancy so non-current local threads no longer stay seated on the live floor from a separate browser-side "recently live" fallback; workstation seating now matches the current-workload/session-panel model.
- Fixed completed Codex process items such as context compaction and reasoning so they no longer leave finished desktop threads stuck in a synthetic `thinking` state after the turn has ended.
- Fixed Codex local activity detection so future-skewed or invalid subscribed thread timestamps no longer keep idle `running` or `thinking` sessions counted as current workload just because they still look live.
- Fixed Codex reply streaming so the browser now reads official `item/agentMessage/delta` notifications directly instead of replaying old assistant history as fresh startup events after `thread/read` hydration.
- Fixed Codex read-only thread fallback so reread assistant replies still surface as typed events when live `thread/resume` delivery is unavailable, without reintroducing startup replay for healthy subscribed threads.
- Fixed Codex runtime discovery on Windows and Windows+WSL environments where the CLI is absent but the Codex desktop app is installed.
- Improved Cursor agent loading compatibility by tolerating auth scheme differences and multi-page API responses.
- Extended text message toast lifetime by 1 second without changing other toast types.
- Fixed stacked toast behavior so file-change toasts append new rows into the active toast body and both file-change and command toasts restart their upward float when new stacked content extends their lifetime.
- Fixed text-message toasts so they spawn from the same agent-head anchor as other agent toasts instead of starting from workstation height.
- Removed the generic `OK` speech bubble from idle and validating avatars so the office scene does not imply a separate approval or success state that is not otherwise modeled.
- Fixed Claude typed hook handling so official events such as `FileChanged`, `Notification`, `TeammateIdle`, `Setup`, and compaction transitions map into normalized office states instead of dropping back to transcript-only inference.
- Fixed stale Claude hook-backed live states so quiet Claude chats age into done/idle instead of holding a workstation indefinitely after activity stops.
- Fixed Claude hook-backed sessions so assistant reply text from transcripts or Agent SDK session messages still surfaces in the UI instead of only showing user prompts and tool-state updates.
- Fixed Claude session snapshots so they now emit normalized events with stable session-backed `threadId` values, restoring file-change bubbles and later message updates in the browser.

### Removed

- Removed the experimental LAN peer transport and UDP discovery path while leaving a disabled multiplayer interface in place for a future secured sync implementation.
