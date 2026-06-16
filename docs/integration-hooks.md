# Integration Hooks

## Purpose

This document answers two questions:

1. What signals can Codex Agents Office read from Codex, Claude, Hermes, OpenClaw, and Cursor today?
2. How does each signal get represented in this project?

The goal is practical transparency. This is not a generic event catalog. It is the list of hooks this codebase can already ride, plus the places where we are still leaving signal on the table.

## Normalized Model

Everything eventually lands in the shared `DashboardSnapshot` and `DashboardAgent` model from `packages/core/src/types.ts`.

The important normalized agent fields are:

- `source`
  `local`, `cloud`, `cursor`, `presence`, `claude`, or `openclaw`
- `sourceKind`
  where the session came from, such as `cli`, `vscode`, `subAgent`, `claude:<model>`, `openclaw:<provider/model>`, or `cursor:<model>`
- `parentThreadId`
  parent Codex thread when the agent is a spawned subagent
- `state`
  `planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`, `blocked`, `done`, `idle`, or `cloud`
- `detail`
  short human-readable summary of the latest useful activity
- `paths`
  file or directory paths used for room mapping
- `activityEvent`
  optional event object used for visual notifications
- `provenance`
  whether the visible state comes from typed Codex data, typed OpenClaw gateway data, typed Cursor API data, inferred Claude or Hermes data, cloud tasks, or synthetic presence
- `confidence`
  whether the visible state is typed truth or inferred best effort
- `resumeCommand`
  local Codex resume affordance when available

The shared snapshot also carries:

- `events`
  recent normalized `DashboardEvent` records built from raw Codex notifications

That normalized model is what the web view, terminal view, and VS Code panel render.

## Codex Hooks

### `codex app-server`

Primary code path:

- `packages/core/src/app-server.ts`

Current use:

- resolves a runnable Codex command, then spawns `codex app-server`
- initializes a JSON-RPC-like session
- opts into `experimentalApi`
- keeps streamed `item/agentMessage/delta` notifications enabled so Codex reply toasts can update immediately from the typed live feed
- requests `thread/list`
- requests `thread/read`
- resumes active/recent threads with `thread/resume`
- unsubscribes stale observer-owned subscriptions with `thread/unsubscribe`
- parses app-server notifications
- parses server-initiated JSON-RPC requests such as approvals and input prompts
- summarizes `turn/plan/updated` from the documented `{ explanation?, plan }` payload and `turn/diff/updated` from the documented `{ diff }` payload
- normalizes newer activity/diagnostic notifications including file patch updates, MCP progress, terminal interaction, Codex hook runs, guardian auto-review, model reroute/verification notices, warnings, MCP startup/login failures, rate-limit notices, and Windows sandbox/setup warnings
- provides an explicit unsuccessful response to `item/tool/call` dynamic-tool requests because Agents Office does not execute arbitrary dynamic tools for observed Codex turns
- exposes `npm run check:codex-protocol` as a local drift check against the installed `codex app-server generate-ts --experimental` method set

Important note:

- raw notifications are parsed and exposed through `onNotification(...)`
- server requests are parsed and exposed through `onServerRequest(...)`
- `ProjectLiveMonitor` now consumes both streams directly
- targeted `thread/read` refreshes still happen, but they are triggered behind the event stream instead of replacing it
- the observer now answers the local typed request classes the browser can act on: command/file approvals, permission-profile approvals, `tool/requestUserInput`, and MCP elicitation

This means app-server is now both the main truth source and the first-class local event bus for browser notifications.

Signals intentionally classified as low-workload or no-op today:

- `thread/tokenUsage/updated`
- `skills/changed`
- `thread/name/updated`
- `thread/goal/updated`
- `thread/goal/cleared`
- `account/updated`
- `app/list/updated`
- `remoteControl/status/changed`
- `externalAgentConfig/import/completed`
- `fs/changed`
- `fuzzyFileSearch/sessionUpdated`
- `fuzzyFileSearch/sessionCompleted`
- `thread/realtime/*`
- `account/login/completed`

Current stance:

- these notifications are documented and valid, but they do not currently affect workload state or office occupancy; when useful, they are kept as status events or human-readable notes rather than live desk activity

Resolution details:

- prefer `CODEX_CLI_PATH` when explicitly set
- otherwise prefer `codex` on `PATH`
- on native Windows, if `codex.cmd` is unavailable but `codex` exists inside WSL, fall back to `wsl.exe --exec codex`
- on macOS, fall back to the bundled Codex app binary in `/Applications/Codex.app/Contents/Resources/codex` or `~/Applications/Codex.app/Contents/Resources/codex` when present
- on Windows and Windows+WSL, fall back to the Microsoft Store Codex app by copying its packaged `app/resources` bundle into `%LOCALAPPDATA%\\CodexAgentsOffice\\cache\\windows-store\\<version>` and spawning the cached `codex.exe`
- when both a native Windows CLI and a WSL-side Codex CLI exist, `codex` on `PATH` still wins unless `CODEX_CLI_PATH` overrides it
- when both a WSL-side Codex CLI and the Windows app exist, the WSL CLI now wins before the app fallback unless `CODEX_CLI_PATH` overrides it
- the VS Code embedded server on Windows now launches the WSL runtime through a login shell so `CODEX_HOME` and related environment defaults are preserved

### `thread/list`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/project-paths.ts`
- `packages/core/src/snapshot-lib/dashboard-builder.ts`
- `packages/core/src/live-monitor.ts`

What we read:

- thread ids
- thread cwd
- updated time
- source kind
- status shell

How we use it:

- discover Codex project roots from `thread.cwd`
- find threads for a specific project
- detect newly active or changed local sessions
- decide which threads need a full `thread/read`
- request `sortKey: "updated_at"` and `sortDirection: "desc"` explicitly because current app-server defaults to created-time ordering, which can hide resumed CLI or subagent work from a small current-workload page
- preserve the fresher `thread/list.updatedAt` when desktop-backed `thread/read` returns a stale hydrated transcript timestamp for the same thread

### Codex configured project discovery

Used in:

- `packages/core/src/project-paths.ts`

What we read:

- `~/.codex/config.toml`
- configured `[projects."..."]` roots

How we use it:

- seed fleet startup with configured Codex workspace roots even when no recent thread has been spawned there yet
- keep workspace tabs aligned with the user's known Codex project list instead of only the subset already exercised in the current observer session

### `thread/read`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/adapters/codex-local.ts`
- `packages/core/src/live-monitor.ts`

What we read:

- full thread metadata
- full turn list
- turn status
- turn items
- thread source metadata
- git info
- nickname and role metadata

How we use it:

- build the normalized `DashboardAgent`
- infer current state from the last relevant turn item
- infer ongoing-ness from the latest turn as well as runtime thread status, because `thread/list` / `thread/read` can still report `status.type = notLoaded` for persisted threads that have a current in-progress turn payload
- keep fresh read-only desktop turns without a final answer desk-live through quiet text gaps, using the merged `thread/list` freshness when `thread/read` lags
- use recent non-final command, file, tool, plan, or turn events as workload freshness for local desktop threads even when the observer is temporarily `readOnly` or the app-server thread status currently reads `idle`
- treat a fresh unhydrated `notLoaded` desktop timestamp with no readable turns as a just-sent prompt for an about-8-second planning-current window, not as a completed reply
- treat `thread/status/changed -> notLoaded` as a reread trigger rather than completion; an already observed ongoing local thread stays ongoing unless the reread exposes a final answer
- keep quiet desk-live local work current for about 3 minutes as a fallback when it has recent non-final activity, is still subscribed, or is sitting in a transient `notLoaded` transport state; explicit live-monitor ongoing state is not capped by that fallback
- infer subagent parentage and depth
- generate `resumeCommand`
- map the session into project rooms using extracted paths
- keep read-only visibility for older threads outside the live subscription window
- synthesize fallback assistant-message events from reread desktop rollout threads when the latest assistant message changed and no equivalent recent live message event exists, so read-only or subscribed threads can still toast if the live terminal message notification is missed
- only synthesize those fallback assistant-message events when the latest assistant message belongs to the latest turn, so an older missed final answer is not replayed as fresh activity after a newer user prompt starts the next turn
- treat those synthesized `thread/read/agentMessage` events as recovery-only signal; streamed `item/completed` final answers remain the authoritative visible reply when both exist for the same thread, so a late reread cannot overwrite a newer live final answer in the UI
- keep synthesized `thread/read/agentMessage` commentary as `updated`; only a latest assistant message with `phase = final_answer` is treated as completed

### `thread/resume` / `thread/unsubscribe`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/live-monitor.ts`

How we use it:

- active threads and threads updated in the last 10 minutes are resumed on the observer connection
- active threads are included in that tracked set even when they fall outside the normal recent-thread limit, so startup discovery does not wait for a fresh delta before subscribing them
- the observer keeps at most 8 project threads subscribed at once
- subscription sync now runs in the background so the web server can render and publish its first snapshot before slow desktop thread attaches finish
- desktop-backed `thread/resume` attaches can take tens of seconds in practice, so the observer now gives subscription sync a 60-second timeout budget before degrading that thread back to `readOnly`
- stale observer-owned subscriptions are unsubscribed
- subscribed threads surface as `liveSubscription = subscribed`; older threads stay `readOnly`

In fleet mode, every discovered workspace keeps a live monitor. The selected workspace only changes browser focus; it does not change which projects are subscribed.
The web server's `/api/server-meta` route now reports that live bound project set, so fleet diagnostics reflect the current monitor scope instead of only the startup seed roots.
Fleet mode also shares one `codex cloud list --json` poller across those monitors instead of running the same cloud query once per project, and a `429` now degrades into a single human-readable rate-limit note plus temporary backoff rather than duplicated raw failure notes on every project.

### Thread status and active flags

Consumed in:

- `packages/core/src/snapshot-lib/thread-summary.ts`

Codex status hooks we currently use:

- `systemError`
- `active` with `waitingOnApproval`
- `active` with `waitingOnUserInput`
- last-turn `failed`
- last-turn `inProgress`
- last-turn `interrupted`
- last-turn `completed`

Representation today:

- `waitingOnApproval` -> `blocked`
- `waitingOnUserInput` -> `waiting`
- `systemError` or failed command/turn -> `blocked`
- `plan` or in-progress turn with no stronger item signal -> `planning`
- typed reasoning, commentary, or context-compaction activity -> `thinking`
- secondary adapters should prefer the same split when they have enough signal: generic active fallback -> `planning`, explicit reply/reasoning/compaction -> `thinking`
- recent completed answer -> `done`
- old inactive thread -> `idle`

Current-workload occupancy rules on top of that state:

- a local thread stays `isCurrent` while the live monitor still considers the thread ongoing, even if the latest turn now reads as `done`
- browser desk seating now treats local `status = active` as authoritative for occupancy, so active Codex sessions remain on desks even when the summarized state currently reads `waiting`, `blocked`, or recent `done`
- a `notLoaded` thread still stays `isCurrent` when `thread/read` shows its latest turn is `inProgress`
- a fresh read-only `notLoaded` desktop thread without a final answer still stays `isCurrent` through quiet text gaps, even if `thread/read` returned an older transcript timestamp than `thread/list`
- recent non-final local work events can also keep a desktop-backed thread `isCurrent` through temporary `readOnly` or `idle` observer gaps
- stale `notLoaded` fallback replies are capped to the 3-second finished cooldown; they should not keep a finished top-level thread current for minutes
- observer-owned unload/runtime-idle transitions such as `thread/closed` or `thread/status/changed -> notLoaded` are not stop signals by themselves; `notLoaded` rereads only clear ongoing local state when they reveal a final answer
- non-final `turn/completed` and `turn/interrupted` notifications keep the thread live instead of marking it stopped; only a final-answer `agentMessage`, hard failure, or archive starts workstation release
- resumed/subscribed desktop threads whose latest hydrated turn has non-final work but no `final_answer` are promoted into monitor-tracked ongoing state, so they keep a desk through quiet gaps until the final answer or a hard terminal event arrives
- recent non-final, subscribed, or transiently `notLoaded` desk-live local states keep currentness and workstation eligibility for about 3 minutes as a fallback between updates, while explicit monitor-tracked ongoing threads remain desk-live until final answer or hard terminal state
- local desk occupancy no longer uses a generic freshness fallback for non-idle summaries; if a thread is not ongoing, not waiting on the user, and not inside the stop grace window, it is no longer `isCurrent`
- once a top-level thread actually stops, it remains current and workstation-seated for about 3 seconds so final reply text can still surface before the lead cools into rec-area visibility
- stale local `notLoaded` threads no longer keep a workstation just because they are still recent or subscribed; desk seating now requires actual ongoing work or the explicit stop grace
- completed process-only items such as `plan`, `reasoning`, and `contextCompaction` now settle to `done` while recent and then `idle` once stale instead of leaving the thread in synthetic `planning` or `thinking`
- non-local `idle` sessions still drop out of current-workload filtering immediately

In the browser this becomes:

- workstation occupancy
- above-head state markers for needs-user waits, planning, pre-message typed thinking, and explicit blocked failures, rendered at a smaller icon size above the actor
- floating notifications for newly blocked or waiting agents
- hover and session detail text

### Turn item types we currently map

Mapped in:

- `packages/core/src/snapshot.ts`

Current item-to-state mapping:

| Codex item type | State | Representation |
| --- | --- | --- |
| `fileChange` | `editing` or `blocked` | desk worker, file-change notification, room mapping from changed paths |
| `commandExecution` | `running`, `validating`, or `blocked` | desk worker, command notification |
| `webSearch` | `scanning` | active worker, typed web-search toast when the observer receives the event |
| `imageView` | `scanning` | active worker, image-view icon coverage and viewing summary |
| `mcpToolCall` | `scanning` or `blocked` | active worker, detail text names `server.tool` |
| `dynamicToolCall` | `scanning` or `blocked` | active worker, tool-call summary |
| `collabAgentToolCall` | `delegating` | active worker, delegation summary |
| `collabToolCall` | `delegating` | active worker, subagent spawn/wait summary |
| `plan` | `planning` or `done` | planning summary while in progress, recent finished summary once the turn completes |
| `reasoning` | `thinking` or `done` | thinking summary while in progress, recent finished summary once the turn completes |
| `enteredReviewMode` | `validating` | review-start summary and icon coverage |
| `exitedReviewMode` | `thinking` or `done` | review-finished summary and icon coverage |
| `contextCompaction` | `thinking` or `done` | compaction summary while active, recent finished summary once the turn completes |
| `agentMessage` | `thinking` or `done` | message summary, live notification when subscribed, fallback notification from reread desktop threads |
| `userMessage` | `planning` or `idle` | assigned-work summary and icon coverage |

### File change semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

### Web search visibility

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

Current behavior:

- when Codex app-server emits a native `webSearch` item or event, it maps to `state = scanning`
- typed `webSearch` events render a dedicated browser toast instead of a generic message toast
- if the observer path only sees commentary messages and no native search item, the office cannot currently reconstruct a typed web-search toast from that Codex desktop activity alone

What we read from Codex:

- changed file paths
- change kind such as create, delete, move, rename, or edit
- line deltas when the item carries them

How we use it:

- set `activityEvent.type = fileChange`
- set `activityEvent.action = created|deleted|moved|edited`
- mark image paths so the browser can show image previews
- map changed paths into rooms
- anchor the toast to the workstation instead of the avatar
- show filename-first floating text plus optional green/red `+/-` line deltas such as `client.tsx`, `+200`, `-100`

### Command execution semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/runtime/seating-source.ts`
- `packages/web/src/client/toast-source.ts`

What we read from Codex:

- command string
- command cwd
- command status

How we use it:

- classify validation-like commands as `validating`
- classify other commands as `running`
- failed or declined commands become `blocked`
- render command notifications as a command-prompt style mini window with monospace text and a blinking cursor
- keep one command window toast per agent, append new commands to the bottom, keep only the last 3 lines, and extend the expiry when new lines arrive
- keep recently stopped agents on-desk for the stop grace window; only non-current recent leads move into the rec area after that grace period
- render floating text such as `Ran npm run build`
- collapse read-only shell inspection commands such as `sed`, `cat`, `head`, `tail`, `rg`, `grep`, `ls`, `find`, and `tree` into short summary toasts like `Read workload.ts` or `Exploring 2 files`

### Browser scene layout semantics

Mapped in:

- `packages/web/src/scene-config.ts`
- `packages/web/src/client/runtime/layout-source.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/runtime/scene-source.ts`
- `packages/web/src/client/styles.css`

What we define internally:

- scene tile size and compact tile size
- desk pod span and capacity
- boss office footprint
- boss office top inset
- wall/top-band depth
- desk-area start ratio
- cubicle-group spacing
- desk-column spacing
- rec-strip furniture row and walkway row
- rec-strip maximum depth from the top of the floor grid

How we use it:

- derive browser office layout from tile spans instead of free-floating per-renderer pixel literals
- keep desk slots stable across live updates so current workload does not repack unpredictably
- keep the left boss column compact enough for stacked offices instead of one oversized booth per lead, starting one floor tile below the floor start and running as contiguous 3-tile office slots
- place rec-strip furniture on the first grid row and keep it within the top 2 rows of floor depth
- treat text scale as a global viewer setting while keeping prefab geometry internal
- keep the browser map as a retained scene host so live data updates scene entities without replacing the map subtree

### Tool call semantics

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/pixel-office.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

What we read from Codex:

- `item/tool/call` server requests
- `dynamicToolCall` / `mcpToolCall` items when present in thread data
- exact app-server method names for typed snapshot events

How we use it:

- normalize dynamic-tool server requests into typed `DashboardEvent.kind = tool`
- keep dynamic tool activity visible in the local thread summary path
- resolve toast icons from exact method-shaped asset paths such as `sprites/icons/item/tool/call.svg`
- resolve semantic thread-item icons from `sprites/icons/thread-item/*.svg` or reused exact-method icons
- expose a visual verification surface at `/icon-audit` so every thread-item icon can be inspected side by side

Important note:

- the official Codex app-server events page currently documents `item/tool/call` as the experimental client-executed dynamic-tool request path, not as an MCP-specific event

### Subagent metadata

Mapped in:

- `packages/core/src/snapshot.ts`

What we read from Codex:

- `thread.source`
- `subAgent.thread_spawn.parent_thread_id`
- `subAgent.thread_spawn.depth`
- `subAgent.thread_spawn.agent_nickname`
- `subAgent.thread_spawn.agent_role`
- direct app-server subagent spawn shapes such as `source.type = "subAgentThreadSpawn"` plus `parentThreadId` / `parent_thread_id`
- top-level `thread.agentNickname`
- `thread.agentRole`
- role hints from prompt text and user message text as a legacy fallback
- `collabAgentToolCall` items for parent-thread delegation status, including the current `receiverThreadIds` / `agentsStates` shape when present
- multi-agents v2 `collabAgentToolCall.tool` values such as `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, and `close_agent`, plus camelCase app-server aliases and receiver thread IDs from live `item/started` and `item/completed` notifications

How we use it:

- identify spawned subagents
- link them to parent threads
- retain listed descendant subagent threads when their parent session is already tracked, in addition to retaining ancestor parents for tracked children
- ignore stale active subagent rows after an about-20-minute no-progress window so app-server leftovers do not appear as live workers
- refresh newly referenced receiver threads promptly from v2 collab notifications instead of waiting for the next broad `thread/list` poll
- attach role-based grouping to workstations
- show parent/child linkage in the session panel

### Local thread file path watch

Implemented in:

- `packages/core/src/live-monitor.ts`

What we read:

- the `thread.path` file path returned by Codex
- local file modification times via `fs.watch` and `watchFile`

How we use it:

- trigger a debounced `thread/read` when a local thread file changes
- reduce the lag between actual Codex work and the office snapshot

This is not a primary truth source. It is a refresh trigger layered on top of app-server.

### App-server notifications

Available in code:

- `packages/core/src/app-server.ts`

What is available:

- any app-server notification method and params
- this includes the event stream described in Codex docs, such as turn, item, approval, command, and file-change notifications

How we use it today:

- `ProjectLiveMonitor` subscribes to the raw notification stream
- `ProjectLiveMonitor` also listens for server-request messages carrying approval/input waits
- notifications are filtered to the current project by known thread ids and discovered paths
- matching notifications are converted into normalized `DashboardEvent` records
- approval/input requests are also attached to the owning agent as typed `needsUser` state
- those events are attached to the next `DashboardSnapshot` and also feed the derived `activity` summary used by the in-scene Ops Wall
- matching threads are re-read so stable state and event detail stay aligned

Why it matters:

- the browser can react to real event boundaries instead of only snapshot diffs
- command, file, approval, input, subagent, and turn lifecycle transitions now arrive as typed events
- file-change transitions can also be summarized as decayed script/doc/media hot changes without scraping terminal transcripts as a primary source; command and tool transitions remain event/history cues rather than hot-stuff board rows
- the durable "needs you" queue now comes from real request hooks and `serverRequest/resolved`

Verified `tool/requestUserInput` contract:

- request params include `threadId`, `turnId`, `itemId`, and `questions`
- each question has `header`, `id`, `question`, optional `options`, and optional `isOther`
- the browser now answers with `{ answers: { "<questionId>": { answers: ["..."] } } }`
- local queue submit stays disabled until every required question has at least one answer
- optional questions can be left blank and are omitted from the browser response payload
- incomplete answers are rejected server-side before the observer responds to app-server

Verified current app-server response and input contracts:

- `turn/start` and `turn/steer` text inputs are sent as `{ type: "text", text, text_elements: [] }`
- browser follow-up replies are limited to Codex threads owned by the same app-server connection as Agents Office. For those threads, active replies are routed through `turn/steer`; `turn/start` is reserved for idle/resumed threads, and `turn/started` / `turn/completed` notifications update the cached turn list so active steering stays attached to the live turn.
- observed desktop, VS Code, and CLI Codex threads are view-only for generic chat in Agents Office; the scene thread panel should expose read-only history only instead of a browser Send field or local launch controls.
- command and file approval requests are answered with `{ decision }`
- MCP elicitation requests are answered with `{ action: "accept", content, _meta: null }`
- permission-profile approvals are answered with `{ permissions, scope }`, where `scope` is `turn` or `session`
- dynamic tool-call requests are answered with `{ success: false, contentItems: [{ type: "inputText", text: "..." }] }` so a Codex turn does not wait indefinitely on an observer that cannot execute that tool

### `codex cloud list --json`

Implemented in:

- `packages/core/src/cloud.ts`
- `packages/core/src/codex-command.ts`
- `packages/core/src/snapshot.ts`

What we read:

- task id
- URL
- title
- status
- updated time
- environment label
- file/line change summary

Resolution details:

- `cloud list` uses the same Codex-command resolution path as `app-server`
- Windows Store app installs can provide cloud task visibility through the same extracted-binary fallback

How we use it:

- create `source = cloud` agents
- attach them to project snapshots when the cloud environment label matches the project name
- render cloud sessions in the same fleet/session model

## Claude Hooks

Claude support still stays secondary to Codex app-server, but Claude Code now has an official hook surface that is strong enough to carry more than transcript heuristics when we choose to wire it in.

Primary code path:

- `packages/core/src/claude.ts`

### Claude project discovery

What we read:

- `listSessions()` from `@anthropic-ai/claude-agent-sdk` when available
- `~/.claude/projects/*/*.jsonl`
- `$CLAUDE_CONFIG_DIR/jobs/*/state.json`, falling back to `~/.claude/jobs/*/state.json`, for Claude Code Agent View background sessions
- Claude Desktop Co-work app data under `local-agent-mode-sessions`, including `spaces.json` and recent `local_*.json` session files

How we use it:

- prefer official Claude session metadata when the Agent SDK is installed
- scan project directories
- fall back to sampling the head and tail of each log when the SDK path is unavailable
- infer the project root from session `cwd`
- add Co-work `spaces[].folders[].path` and session `userSelectedFolders` paths as workspace floors
- add Agent View background job project roots as workspace floors with `sourceKind = claude:background`; jobs running under `<project>/.claude/worktrees/*` are grouped back to `<project>`
- merge Claude-discovered roots into workspace discovery

### Claude session sampling

What we read:

- `getSessionMessages()` from `@anthropic-ai/claude-agent-sdk` when available
- recent JSONL records from the head and tail of each session file as fallback
- local workflow/subagent JSONL files under `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/**/agent-*.jsonl`
- matching workflow/subagent metadata files such as `agent-*.meta.json`
- workflow journals such as `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/workflows/<workflow-id>/journal.jsonl`
- optional per-project hook sidecars in Agents Office user data at `claude-hooks/<session-id>.jsonl`
- Claude Agent Teams config files under `~/.claude/teams/*/config.json`
- Claude Agent View background session state under `$CLAUDE_CONFIG_DIR/jobs/*/state.json` or `~/.claude/jobs/*/state.json`
- Claude Desktop Co-work session files under `local-agent-mode-sessions/**/local_*.json`
- record timestamps
- message model names
- `cwd`
- teammate `cwd` / `worktreePath`
- Co-work `spaceId`, `title`, `initialMessage`, `lastActivityAt`, `userSelectedFolders`, and `fsDetectedFiles`
- background job `sessionId`, `cwd`, `name`, `prompt`, state/status text, activity summary, and timestamps when present
- `gitBranch`

How we use it:

- identify the session
- derive a display label from the Claude model
- prefer supported Agent SDK session reads over raw transcript layout assumptions
- infer the most recent meaningful activity from transcript data when no hook sidecar exists
- prefer typed Claude hook events when a sidecar exists for that session
- assign the Claude `sessionId` to the normalized `threadId` field so browser event matching can treat Claude like other tracked sessions
- derive inferred child Claude agents from local workflow/subagent transcripts, metadata, and journals when hooks are absent
- derive typed child Claude agents from hook `agent_id` and Agent Teams `leadSessionId` / teammate metadata when those typed identifiers are available
- add teammate `worktreePath` or `cwd` values to Claude project discovery so cowork/team workspaces can appear as floors
- add Agent View background jobs as read-only `claude:background` agents keyed by the Claude session id when available, otherwise by the background job id
- expose `claude attach <job>` as the read-only resume command for those rows
- add Claude Desktop Co-work project folders as floors and show matching Co-work local-agent sessions as read-only Claude agents
- assign an appearance and render it as a `claude` agent

### Claude Desktop Co-work local store

The Claude Desktop Co-work view keeps its project/task state in app data, not in `~/.claude/teams`. On Windows this has been observed under `%APPDATA%/Claude/local-agent-mode-sessions`; macOS and Linux candidates follow the normal Claude application-support/config locations.

What Agents Office reads from that store:

- bounded recursive `spaces.json` scans for Co-work spaces and their folder roots
- bounded recursive `local_*.json` scans for local-agent sessions
- session metadata such as `sessionId`, `cliSessionId`, `processName`, `title`, `initialMessage`, `model`, `spaceId`, `createdAt`, and `lastActivityAt`
- project roots from `userSelectedFolders`
- recent file touches from `fsDetectedFiles[].hostPath`

How Agents Office uses it:

- Co-work folders become workspace floors in fleet mode
- matching Co-work sessions become read-only Claude agents with `sourceKind = claude:cowork:<model-or-app>`
- recent `fsDetectedFiles` entries become file-change activity for hover cards, session history, and file-change surfaces
- state is freshness-based because this local store does not expose a Codex-style live thread protocol
- this is treated as observed local app state rather than an official Claude API contract

### Claude Agent View background jobs

Claude Code Agent View (`claude agents`) keeps a local supervisor roster and per-job state for background sessions. The documented useful path for Agents Office is `$CLAUDE_CONFIG_DIR/jobs/<id>/state.json`, falling back to `~/.claude/jobs/<id>/state.json`.

What Agents Office reads from that store:

- bounded scans of `$CLAUDE_CONFIG_DIR/jobs/*/state.json` and `~/.claude/jobs/*/state.json`
- flexible background session metadata such as `sessionId`, `cwd`, `name`, `prompt`, `status`, `state`, `currentActivity`, `summary`, `createdAt`, and `updatedAt`

How Agents Office uses it:

- matching jobs become read-only Claude agents with `sourceKind = claude:background`
- if the job exposes a Claude session id, that id is reused for the normalized lead-agent row so background state can merge with Agent SDK/transcript state
- project roots from explicit project/workspace fields, workspace-root arrays, or `<project>/.claude/worktrees/*` paths become workspace floors in fleet mode
- `claude attach <job>` becomes the row's resume command, but the browser still treats the row as read-only and does not send generic replies into Claude
- state is mapped into the common activity model (`running`, `waiting`, `blocked`, `done`, or `idle`) from the job status/activity text and freshness
- this path does not expose the subagents running inside a foreground session, and it is not a workflow progress API

### Claude dynamic workflows and protocol boundary

Claude Code dynamic workflows / `ultracode` are a separate research-preview surface. Official docs describe workflow scripts that coordinate dozens to hundreds of subagents, `/workflows` progress UI with phases, token totals, agent prompts/tool calls/results, and `ultracode` as `xhigh` effort plus automatic workflow orchestration.

Agents Office consumes the local child-agent artifacts Claude writes beside each project session: `subagents/**/agent-*.jsonl`, matching `agent-*.meta.json`, and workflow `journal.jsonl` files. Those files create inferred child `DashboardAgent` rows under the lead Claude session, including rows from journal `started` records before the child transcript has useful assistant text and `result` records when the workflow finishes a child.

This is still not a full `/workflows` progress API: Agents Office does not currently reproduce Claude's phase tree, token totals, or run controls. Hook sidecars remain the strongest implemented typed path for local Claude subagent hierarchy today, and they override matching inferred child rows by `agent_id`. The best official hookless protocol candidate for richer future live state is Claude Code OpenTelemetry export:

- `OTEL_LOGS_EXPORTER` can export structured prompt, API, tool, permission, MCP, hook, compaction, skill, and other events
- trace spans include `agent_id`, `parent_agent_id`, and `subagent_type` attributes for subagent/model/tool correlation
- an Agents Office OTLP collector would be needed before this can replace hook sidecars for passive live workflow/subagent observability

### Official Claude hook surface

Official docs:

- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)

What Anthropic exposes in hook input:

- `session_id`
- `transcript_path`
- `cwd`
- `hook_event_name`
- `tool_name`
- `tool_input`
- `tool_response` for successful tool completions
- error information for failed tool calls
- typed lifecycle events such as `PermissionRequest`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Elicitation`, and `TaskCompleted`
- supported session APIs such as `listSessions()` and `getSessionMessages()` for passive inspection
- SDK hook callbacks that receive `tool_use_id` for tool-call correlation
- `agent_id` and `agent_type` on subagent-scoped hook callbacks

How this project uses that surface:

- the loader now prefers the official Agent SDK session APIs for Claude project discovery and message backfill
- we still do not scrape Claude internals directly from a private process stream
- instead, we support a project-owned bridge that writes hook JSONL sidecars into the matching per-project Agents Office user-data folder
- `packages/core/src/claude-agent-sdk.ts` exports a reusable Agent SDK hook bridge that appends those sidecars with `session_id`, `hook_event_name`, `tool_use_id`, `agent_id`, and `agent_type` when available
- that same bridge now gives `PermissionRequest` and `Elicitation` hooks a browser response path by waiting on the matching project-scoped response file in Agents Office user data and then returning the official structured hook output back to Claude
- Agents Office also appends a synthetic resolution marker into the Claude hook sidecar after a browser response so the queue clears immediately even for permission requests that do not emit a later official hook result
- when those sidecars exist, Claude agents can surface typed permission, input, tool, subagent, stop, user-prompt, session-start/end, and compacting state with `confidence = typed`
- subagent-scoped hook records with `agent_id` become child `DashboardAgent` rows under the lead Claude session, override matching inferred workflow/subagent rows, and attach their events to the child row instead of the parent when possible
- Claude Agent Teams config files can upgrade teammates into child agents with teammate name, role, active/idle state, parent `leadSessionId`, and cowork project/worktree floor discovery
- Claude Desktop Co-work session records can add read-only Claude agents and workspace floors, but they do not provide hook-backed browser replies or typed subagent control
- when they do not exist, Claude falls back to transcript inference with `confidence = inferred`

### Claude transcript inference rules

Mapped in:

- `packages/core/src/claude.ts`

Current Claude transcript inference rules:

| Claude signal | State | Representation |
| --- | --- | --- |
| assistant `tool_use` with `edit`, `write`, `multiedit` | `editing` | file-change style notification and room mapping from paths |
| assistant `tool_use` with `bash`, `shell` | `running` or `validating` | command-style notification |
| assistant `tool_use` with `read`, `grep`, `glob`, `search`, `ls`, `list` | `scanning` | active worker without explicit notification |
| assistant `tool_use` with `task`, `delegate`, `agent` | `delegating` | shared `collabAgentToolCall` activity and subagent-style dashboard event |
| latest user text newer than latest assistant text | `planning` | planning summary |
| recent assistant text | `thinking` | message summary, optional recent update notification |
| older assistant text | `done` then `idle` | finished or idle state |

Transcript inference is strictly timestamp-driven. Untimestamped metadata rows such as title or last-prompt updates do not refresh an old tool call, tool-result payloads do not become new user prompts, and a later assistant final reply wins over earlier `tool_use` records.

### Claude hook event rules

When a project-scoped Claude hook sidecar exists, the loader can map these official Claude hook events directly:

| Claude hook event | State | Representation |
| --- | --- | --- |
| `PermissionRequest` | `blocked` | typed approval-needed state from Claude hook input |
| `Elicitation` | `waiting` | typed waiting-for-input state |
| `ElicitationResult` | `planning` | typed input-submitted or declined state |
| `AgentsOfficePermissionDecision` | `planning` | synthetic queue-clearing marker after a browser approval/deny response |
| `AgentsOfficeElicitationResponse` | `planning` | synthetic queue-clearing marker after a browser elicitation response |
| `UserPromptSubmit` | `planning` | typed user-prompt state with `userMessage` activity |
| `UserPromptExpansion` | `planning` | typed expanded-prompt state with `userMessage` activity |
| `Setup` | `planning` | typed initialization or maintenance state |
| `SessionStart` | `planning` | typed session-start state |
| `SessionEnd` | `done` | typed session-ended state |
| `PreCompact` | `thinking` | typed context-compacting state |
| `PostCompact` | `thinking` | typed context-compacted state |
| `PreToolUse` / `PostToolUse` with edit or write tools | `editing` | file-change style notification and room mapping from paths |
| `PostToolBatch` | `thinking` | typed batch tool completion state |
| `PreToolUse` / `PostToolUse` with bash or shell tools | `running` or `validating` | command-style notification |
| `PostToolUseFailure` | `blocked` | failed command/tool state |
| `PermissionDenied` | `blocked` | typed permission-denied state |
| `FileChanged` | `editing` | typed file-change activity from Claude hook input |
| `Notification` | `thinking`, `waiting`, or `blocked` | typed Claude-side message or warning surface |
| `TaskCreated` | `delegating` | typed delegated-task creation state with shared `collabAgentToolCall` activity |
| `SubagentStart` | `delegating` | typed delegation summary plus child-agent row when `agent_id` is present |
| `SubagentStop` | `done` | typed subagent-finished summary plus child-agent row when `agent_id` is present |
| `Stop` / `TaskCompleted` | `done` | typed completion state |
| `StopFailure` | `blocked` | typed turn-failure summary |
| `TeammateIdle` | `waiting` | typed teammate-idle summary |
| `CwdChanged` / `WorktreeCreate` / `WorktreeRemove` / `ConfigChange` / `InstructionsLoaded` | `planning` | typed workspace or config transitions |

### Claude activity events

What we synthesize:

- `userMessage`
- `fileChange`
- `commandExecution`
- `collabAgentToolCall`
- `agentMessage`

How we use it:

- merge Claude session activity into normalized `DashboardEvent` records on `snapshot.events`
- use the Claude `sessionId` as the event and agent `threadId` match key for lead sessions
- use a synthetic child thread id, or the teammate `sessionId` when Claude exposes one, for subagent/team-scoped Claude events
- exactly the same browser notification path as Codex agents
- same room mapping via normalized `paths`
- same session-card and hover-card surfaces

What Claude still does not provide here:

- Codex-style resume/open command
- Codex app-server style live push stream into this process without a user-configured hook bridge
- a complete Codex-grade hierarchy for every child; local workflow/subagent files provide inferred child rows, while hook `agent_id`, teammate `sessionId`, and team `leadSessionId` provide typed hierarchy where available
- a stable documented local API for `/workflows` phase/agent progress; Agent View jobs and workflow-managed child rows are visible, but the full phase tree still needs a future protocol path such as OpenTelemetry
- a general thread-steer/reply API comparable to Codex app-server, so Claude session cards are still read-only even though hook-backed approval/input waits are now actionable

## OpenClaw Gateway Sessions

OpenClaw support uses the official Gateway control plane as a typed secondary source.

Primary code path:

- `packages/core/src/openclaw.ts`

### OpenClaw workspace matching

What we read:

- `config.get`
- `agents.list`
- `sessions.list`

How we use it:

- read configured agent workspace roots from `config.get`
- read agent identities from `agents.list`
- read typed session rows, parent links, timestamps, and previews from `sessions.list`
- match OpenClaw workspaces onto the current office project by normalized workspace-path equality or child-path containment under the project root
- attach active sessions outside known fleet project roots as `sourceKind = openclaw:roaming` agents, so harness/orchestrator work floats instead of creating fake floors
- map OpenClaw parent/child session structure into `parentThreadId` and depth instead of flattening it into project tasks

### Official OpenClaw surface

Official docs:

- [OpenClaw repository](https://github.com/openclaw/openclaw)
- [OpenClaw ACP bridge](https://github.com/openclaw/openclaw/blob/main/docs.acp.md)

What OpenClaw exposes:

- Gateway WebSocket `connect`
- `config.get` for typed config snapshots
- `agents.list` for agent identities
- `sessions.list` for typed session rows with `parentSessionKey`, `childSessions`, timestamps, labels, status, and previews

How this project uses that surface:

- enables OpenClaw visibility only when `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` is configured
- connects to the official Gateway WebSocket and performs the same nonce-based `connect.challenge` handshake model OpenClaw documents
- keeps the integration read-only
- renders OpenClaw sessions with `confidence = typed`
- discovers OpenClaw-backed workspace floors only from active recent sessions, not from guessed local transcript files
- renders unmatched active OpenClaw orchestrators in the shared fixed left-side sky layer, with the same screen-space desk handoffs and cross-floor transfer ghost behavior used for projectless Hermes

### OpenClaw state mapping

Operational validation:

- `GET /api/fleet` should show assigned OpenClaw sessions on a project floor when their configured workspace equals the project root or sits underneath it
- `GET /api/fleet` may show unmatched active OpenClaw sessions as `source = openclaw`, `sourceKind = openclaw:roaming`, attached to an existing snapshot for transport; the web client should render them in the fixed sky layer, not in a room or rec area
- OpenClaw movement from roaming to an assigned floor, assigned floor to roaming, or one known floor to another should animate through screen-space rect handoffs without duplicating the durable OpenClaw session

| OpenClaw signal | State | Representation |
| --- | --- | --- |
| `status = running` with active child sessions | `delegating` | typed lead session supervising other OpenClaw sessions |
| `status = running` without active child sessions | `thinking` | active typed OpenClaw session |
| `status = done` | `done` | recently completed OpenClaw session |
| `status = failed` / `killed` / `timeout` | `blocked` | typed terminal failure or interrupted session |
| no usable status | `idle` | inactive OpenClaw session |

## Hermes Agent Sessions

Hermes support is read-only and based on the durable local surfaces in `nousresearch/hermes-agent`.

Primary code path:

- `packages/core/src/hermes.ts`

### Hermes project matching

What we read:

- typed hook sidecars written by the optional `codex-agents-office` Hermes plugin
- `~/.hermes/state.db` or `HERMES_STATE_DB`
- `~/.hermes/profiles/<name>/state.db`
- live Linux process cwd and env hints from Hermes CLI/TUI processes

How we use it:

- read session rows, bounded session-level text fields, and a bounded recent-message window from Hermes SQLite `sessions` and `messages`; if SQLite is unavailable, Hermes visibility reports a diagnostic instead of falling back to stale legacy session files
- install optional global Hermes plugin hooks with `codex-agents-office agents link hermes`; this writes `~/.hermes/plugins/codex-agents-office` and enables it in `~/.hermes/config.yaml` without launching Hermes
- write `codex-agents-office.status.json` in the hook output directory when the plugin registers or hits a record/register error, so gateway load state can be verified without waiting for a Hermes tool call
- treat `hermes:<session-id>` as the stable agent identity across project floors
- keep Hermes SQLite session ids as the only normal workstation agents; hook-only ids such as `default`, `process-<pid>`, and UUID task/tool streams are folded into the nearest durable Hermes session by direct session id, payload session id, platform, cwd, and time window instead of creating separate avatars
- treat Hermes cron run ids such as `cron_<job>_<timestamp>` and SQLite rows with `source = cron` as temporary Hermes agents (`role = temporary`, `sourceKind = hermes:cron`) with compact project tick labels instead of raw scheduler prompts or raw cron ids
- treat fresh `ended_at IS NULL` Hermes gateway sessions as current open work, even after the latest assistant reply, so the still-open main session stays desk-visible instead of only contributing activity history
- treat Hermes compression-continuation children as the lead session, matching Hermes' own latest-descendant/session-list behavior, instead of rendering them as subagents under the compressed parent
- keep Hermes `latestMessage` tied to the latest useful assistant/subagent conversation text; terminal commands, process-management calls, file changes, MCP calls, dynamic tool calls, and user prompts update `detail`, labels, typed events, and toasts/history instead of becoming the visible agent-speech message
- do not copy Hermes hook `user_message` text into `latestMessage`; prompts can shape labels and history, but `latestMessage` is rendered as Hermes speech in hover cards and the room scene
- map Hermes `process(...)` hooks such as background `wait`, `poll`, and `log` to the command/process-management family, while model API request hooks map to reasoning/thinking activity rather than generic dynamic-tool activity
- decode Hermes tool hooks through Hermes' own registry/display semantics: `todo` is planning, `read_file`/`search_files`/`skill_view` are scanning tool activity, and only `write_file`/`patch` are file-edit activity
- ignore generic Hermes maintenance prompts, including skill-library review prompts, when choosing display message text so they do not replace the prior real conversation message
- prefer the latest project-bearing hook payload paths over Hermes process cwd when deciding which floor the session currently belongs on
- keep that project relation through 20 rootless hook actions; after more than 20 actions with no known project root, the Hermes session becomes projectless/roaming until a new project-bearing hook path or cwd appears
- use `system_prompt` working-directory text, live `HERMES_CWD` / `TERMINAL_CWD`, tool path arguments, and absolute paths in messages to associate work with a project
- seat stored Hermes DB sessions on one current floor, chosen from the live process cwd when present or the latest project-bearing message path, instead of duplicating the same session across every historical project path
- resolve discovered paths up to a git root when possible so nested file activity still seats on the repo floor
- contribute fleet project discovery only from live Hermes process cwd roots and the latest current root of fresh hook sessions; Hermes database history and older hook path candidates are not broad-discovered into floors
- ignore exact transient system roots such as `/tmp`, `/var/tmp`, and `/dev/shm` during project discovery, even if a temporary `.git` directory or hook cwd points there
- ignore the Hermes gateway/runtime source checkout when it is discovered through Hermes' own adapter, so the running gateway does not create an empty `hermes-agent` floor
- attach hook sessions whose latest activity is outside known workspace floors to the tower as `sourceKind = hermes:roaming` agents rather than creating new floors; the browser renders those agents in the fixed left-side sky outside the building, with deterministic screen-space scatter and measured-rect handoff motion back to desks when the project relation returns
- when the same durable Hermes session moves from one known workspace root to another, keep the server representation as one current-floor agent and let the browser show a short fixed-layer transfer ghost from the old desk hit rect to the new desk hit rect
- map Hermes parent session ids into `parentThreadId` when present
- keep browser actions read-only because Hermes does not expose an Agents Office-owned steering or approval channel here

Installed plugin hooks:

- session and gateway lifecycle: `on_session_start`, `pre_gateway_dispatch`, `on_session_end`, `on_session_finalize`, `on_session_reset`
- LLM/API lifecycle: `pre_llm_call`, `post_llm_call`, `transform_llm_output`, `pre_api_request`, `post_api_request`
- tools and delegation: `pre_tool_call`, `post_tool_call`, `transform_tool_result`, `transform_terminal_output`, `subagent_stop`
- approval lifecycle: `pre_approval_request`, `post_approval_response`

The plugin writes observation sidecars and returns `None`; transform hooks are registered only for visibility, not to rewrite Hermes data. String payloads are truncated before writing so terminal/tool/LLM output cannot make the sidecar stream unbounded. The reader also caps hook files to recent tails, skips oversized single JSONL lines, and limits hook scan/session scan counts during fleet refresh. The retained hook tail is intentionally large enough to keep the most recent useful conversation text even after many tool calls, because command/tool-only windows should not force the hover card to show a shell command as speech. The plugin maintains a non-session status marker named `codex-agents-office.status.json`; Agents Office ignores that file as workload input and uses only `*.jsonl` sidecars for session activity.

Operational validation:

- `GET /api/server-meta` may include a Hermes-discovered floor only when it comes from a live process cwd or a fresh hook session's latest current project root
- `GET /api/fleet` may include `source = hermes` agents on matching floors, or `sourceKind = hermes:roaming` agents attached to an existing floor when the hook session is outside known workspace roots; the web client should show roaming Hermes in the sky layer, not inside a room, and should animate transitions using screen-space DOM hit rects rather than adding fake project/floor agents
- `GET /api/fleet` should show durable ids like `hermes:20260515_...` or `hermes:cron_...`; it should not show hook-only ids such as `hermes:default`, `hermes:process-<pid>`, or `hermes:<uuid>`, including in roaming agents
- `GET /api/fleet` should show Hermes cron runs as temporary `sourceKind = hermes:cron` agents while they are active or recently done; their `detail` / `activityEvent` should not expose the scheduler wrapper prompt
- active Hermes command/process/planning/tool sessions should expose the command, process action, planning update, or tool in `detail` / `activityEvent`, while `latestMessage` remains either prior Hermes assistant/subagent text or `null`; a command string such as `sleep 75` should not appear as the agent's last message
- the hook output directory should contain `codex-agents-office.status.json` with `status_event_name = registered` and the current gateway pid after Hermes reloads the plugin
- if a Hermes validation run starts producing many unexpected workspace floors, stop the web listener immediately and inspect project discovery before restarting it; do not reintroduce DB-history or all-path hook sweeps as discovery inputs

### Hermes state mapping

| Hermes signal | State | Representation |
| --- | --- | --- |
| latest user message in a fresh open session | `planning` | inferred active Hermes prompt |
| Hermes cron run id `cron_<job>_<timestamp>` or SQLite `source = cron` | `planning`, `thinking`, `done`, or `idle` by latest activity | temporary Hermes agent with a compact project tick label; scheduler wrapper prompt is stripped from display text |
| plugin `pre_llm_call` / `pre_gateway_dispatch` | `planning` | typed prompt/session activity |
| plugin `pre_tool_call` / `post_tool_call` / `transform_tool_result` / `transform_terminal_output` | `running`, `editing`, `scanning`, `delegating`, or `blocked` | typed tool activity by tool name, args, output, and result |
| command, file, MCP, or dynamic tool hook while earlier assistant/subagent text exists | current tool-derived state | current action in `detail` / `activityEvent`; prior useful Hermes assistant/subagent text remains `latestMessage` |
| hook-only `default`, `process-<pid>`, or UUID task/tool streams | parent session state update | folded into the matching durable Hermes session; never a standalone desk agent |
| plugin `subagent_stop` | `delegating` or `blocked` | typed child-agent completion activity |
| plugin `post_llm_call` / `transform_llm_output` | `done` with recent speech | typed reply activity from Hermes |
| plugin `pre_api_request` / `post_api_request` | `thinking` | typed provider/model request activity |
| latest assistant message with a tool call | `running`, `editing`, `scanning`, or `delegating` | inferred tool activity by tool name and arguments |
| latest tool result with failure metadata | `blocked` | inferred failed tool result |
| final assistant reply in a fresh open `ended_at IS NULL` gateway session | `waiting` | current Hermes session waiting for the next user turn |
| final assistant reply or ended session | `done` / `idle` | recent completion or inactive Hermes session |
| live Hermes process without a matched session | `planning` | process-level workspace presence fallback |

Hermes plugin-hook entries carry `provenance = hermes` and `confidence = typed`. SQLite/process fallback entries carry `confidence = inferred`.

## Cursor

Cursor support now combines a typed local hook-sidecar adapter and the official cloud-agent API.

Primary code path:

- `packages/core/src/cursor.ts`

### Cursor local hook adapter

What we read:

- project-owned Cursor hooks from `<project-root>/.cursor/hooks.json`
- typed hook sidecars in the matching per-project Agents Office user-data folder

How we use it:

- treat typed Cursor local hook sidecars as the only local Cursor source
- decode hook stdin defensively for Windows shell encodings as well as UTF-8 so project hooks keep writing sidecars in mixed Windows/WSL setups
- map official Cursor hook events such as `beforeSubmitPrompt`, `preToolUse`, `postToolUseFailure`, `afterFileEdit`, `afterAgentResponse`, `afterAgentThought`, `sessionStart`, `sessionEnd`, `stop`, `subagentStart`, `subagentStop`, and `preCompact`
- surface typed local Cursor prompt, file-change, command, MCP, reasoning, and assistant-response events in the shared office model
- age stale hook-backed live states into `done` and then `idle` instead of leaving a workstation occupied forever
- map generic active Cursor hook/transcript fallback to `planning` when no stronger reply/reasoning/tool state is present, reserving `thinking` for explicit response/reasoning/compaction signals
- render hook-backed sessions with `confidence = typed`

### Cursor cloud project matching

What we read:

- project git `remote.origin.url`
- Cursor cloud-agent `source.repository`
- Cursor cloud-agent `source.prUrl` and `target.prUrl` when work is attached to an existing PR

How we use it:

- normalize both repo URLs into a comparable HTTPS form
- collapse GitHub/GitLab/Bitbucket PR URLs back to their repository URL before comparison
- query the documented Cursor cloud API with `Authorization: Bearer <api key>` first, while keeping a legacy Basic-auth retry only for older local setups
- match Cursor background agents onto the currently selected project

### Official Cursor cloud surface

Official docs:

- [Cursor hooks](https://cursor.com/docs/hooks)
- [Cursor background agents](https://cursor.com/docs/cloud-agent)
- [Cursor cloud-agent API](https://cursor.com/docs/cloud-agent/api/endpoints)

What Cursor exposes:

- project and user hook configuration in `hooks.json`
- typed local hook events for session lifecycle, prompts, tool use, shell/MCP execution, file edits, thoughts/responses, compaction, and subagent lifecycle
- `GET /v0/agents` for agent ids, status, summary, repo/ref, branch, and target URLs
- `GET /v0/agents/{id}/conversation` for typed `user_message` / `assistant_message` history
- agent conversation history
- status-change webhooks
- model listing for background-agent creation

How this project uses that surface:

- reads the official Cursor API when `CURSOR_API_KEY` is configured or a Cursor API key has been saved through the web Settings popup
- follows `GET /v0/agents` pagination through `cursor` / `nextCursor`
- polls `GET /v0/agents/{id}/conversation` for active or recently updated agents and maps newly seen messages into typed office message events
- keeps `user_message` and local prompt history separate from assistant/output speech so only replies surface as visible message toasts
- authenticates against the current API surface and falls back to the older bearer form for compatibility
- matches agents by normalized repository URL, including PR-backed repository URLs
- maps agent status into shared workload state
- renders Cursor agents with `confidence = typed`
- keeps them read-only because this project is observing, not driving Cursor agent execution
- currently treats webhooks as a future terminal-state accelerator because the documented webhook surface only emits `statusChange` for `ERROR` and `FINISHED`, not live message deltas

### Cursor state mapping

| Cursor status | State | Representation |
| --- | --- | --- |
| `CREATING` / `RUNNING` | `running` | active typed Cursor work item |
| `FINISHED` | `done` | recently completed Cursor task |
| `ERROR` | `blocked` | typed failure state |
| `EXPIRED` | `idle` | no longer active |

What Cursor still does not provide here:

- Codex-style local live thread subscriptions
- durable typed approvals or input-wait state for local IDE sessions
- an official local push feed equivalent to the Codex app-server

## Representation In This Project

### Shared snapshot

Built in:

- `packages/core/src/snapshot.ts`

The snapshot builder merges:

- local Codex threads
- cloud tasks
- optional synthetic presence entries
- Claude sessions from transcript/workflow inference or optional hook sidecars
- Hermes sessions matched by cwd, system-prompt working directory, tool paths, and git-root discovery
- OpenClaw gateway sessions matched by configured workspace root
- Cursor background agents matched by normalized repository URL

Then it:

- maps paths to rooms
- assigns appearances
- flags current workload with `isCurrent`
- carries recent event-native notifications in `events`

### Browser office

Rendered in:

- `packages/web/src/render-html.ts`
- `packages/web/src/client/index.ts`
- `packages/web/src/client/app-runtime.ts`
- `packages/web/src/client/runtime/*.ts`

How normalized fields become visuals:

| Normalized field | Browser representation |
| --- | --- |
| `roomId` | desk placement inside a room |
| `state` | desk pose, state-marker icon, rec-room placement, and session labels |
| `activityEvent` | floating text notifications and image previews |
| `events` | event-native command, file, approval, input, subagent, and turn notifications |
| `needsUser` | durable per-agent approval/input state for queueing and raised-hand desk markers |
| `isCurrent` | default current-workload filtering |
| `parentThreadId` and `role` | grouping into lead clusters and role pods |
| `detail` | hover summary and session-card text |
| `resumeCommand` and `url` | session actions when available |
| `provenance` and `confidence` | hover/session indication of typed Codex truth vs inferred Claude activity |

- block count from `blocked`
- top active work modes from the current normalized state mix such as `edit`, `run`, `verify`, `plan`, or `scan`
- cross-project "needs you" queue for approval and input waits

### Browser live updates

Transport:

- `packages/web/src/fleet-live-service.ts`
- `packages/web/src/router.ts`
- `packages/web/src/client/index.ts`
- `packages/web/src/client/app-runtime.ts`
- `packages/web/src/client/runtime/ui-source.ts`
- `packages/web/src/client/multiplayer-source.ts`

How it works:

- the browser loads the initial page shell from `render-html.ts`
- `/api/fleet` provides the current normalized snapshot
- `/api/multiplayer` exposes the current multiplayer transport status; it is currently a disabled placeholder until a secured sync path exists
- `/api/events` streams live fleet updates over SSE
- `/api/web-cli/query` exposes loopback-only, read-only `recent` and `last` lookups by repo name for the CLI; it returns projected agent/event summaries from the live local fleet or the latest coordinated team cache
- `/api/web-cli/team-fleet` accepts a bounded same-origin browser POST of the already-rendered shared-room fleet so local CLI queries can read the same coordinated data without connecting directly to PartyKit
- `FleetLiveService` owns project monitors and publishes fresh fleet payloads to connected browser clients
- browser-side rendering starts from `client/index.ts`, executes the generated `app-runtime.ts` module, and then delegates behavior across the focused runtime section files
- optional PartyKit room sync, shared-room draft handling, machine-local shared-room settings hydration via `/api/settings/integrations`, a server-backed multiplayer device identity for self-peer suppression across local viewers, explicit per-project share preferences, active-agent-only remote merges, and the debounced team-fleet cache post for `web query scope=team` live in `multiplayer-source.ts`
- `web query <repo> gist` is the light CLI coordination read. It projects the same workspace `activity.hotChanges` used by the in-scene hot-stuff board plus active agents with last message and last file-change hints, so agents can do a short state sync before requesting broader `recent` or `last` data.

- server-sent events from `/api/events`

Important detail:

- the browser still receives refreshed fleet snapshots
- those snapshots now include normalized `events` derived from raw Codex notifications
- notification text is generated from both event-native `snapshot.events` and snapshot-diff compatibility paths
- typed message notifications now prefer the event-native `snapshot.events` path directly, so browser message toasts no longer wait for `latestMessage` or other per-agent summary fields to catch up before they surface

That means the browser is no longer snapshot-diff-only. It can react to real app-server event boundaries while still keeping snapshot diffs as a compatibility layer.

### Terminal and VS Code

Used in:

- `packages/cli/src/index.ts`
- `packages/vscode/src/extension.ts`

Both surfaces ride the same snapshot model. They do not have their own ingestion path.

That keeps:

- state naming consistent
- room mapping consistent
- Claude/Codex coexistence consistent

The VS Code panel now hosts the same office renderer used by the browser surface through an embedded local web server for the current workspace, rather than a separate hand-built room-grid webview.

## Hooks We Are Not Fully Riding Yet

These are already available or nearly available, but not fully exploited:

### Raw Codex app-server notifications

Status:

- consumed in `ProjectLiveMonitor`
- normalized into `DashboardEvent`
- shipped to the browser inside the shared snapshot

Why it matters:

- better animation timing
- true start/finish/interrupt transitions
- less dependence on poll and re-read cadence

What is still missing:

- richer in-scene motion beyond notification text
- more explicit visual differences between started, completed, interrupted, and failed turns

### Full turn lifecycle

Status:

- represented in two layers today:
  - inferred from thread reads for stable current state
  - emitted from raw `turn/*` notifications for lifecycle transitions

Current representation:

- explicit turn started notification
- explicit turn completed notification
- explicit interrupted notification
- explicit failed notification

Missing representation:

- stronger state-specific motion inside the room, beyond the current notification path

### Approval and input request events

Status:

- represented from active flags and from raw notification events
- surfaced in a durable browser-side "needs you" queue across projects

Current representation:

- stronger event-driven alerts
- durable cross-project queue of agents waiting on the user
- anchored blocked/waiting notification text on the responsible agent
- raised-hand desk markers for approval/input waits, light markers for typed thinking before the first visible assistant message, exclamation markers for explicit failure blocks, and clipboard markers for planning
- local typed Codex approval waits in the browser queue can now send `accept`, `acceptForSession`, `decline`, or `cancel` back over the same app-server observer connection
- local typed Codex `tool/requestUserInput` waits in the browser queue can now send schema-backed `answers` payloads back over that same observer connection
- local typed Codex input waits without schema-backed questions can open the browser reply composer only for threads owned by the same app-server connection; observed desktop, VS Code, and CLI threads remain resume-only
- app-server-owned local typed Codex session cards can send follow-up text back over app-server using `turn/start` for idle/resumed threads and `turn/steer` for active in-flight turns; if an active thread row has no known in-progress turn yet, the monitor rereads the thread and refuses to start a detached side turn when the turn still is not steerable
- hook-backed Claude `PermissionRequest` waits in the browser queue can now send `accept` or `decline` through the local Agent SDK sidecar bridge
- hook-backed Claude schema-backed `Elicitation` waits in the browser queue can now submit browser-collected answers through that same local sidecar bridge, with optional Claude fields no longer blocking submit

Missing representation:

- richer blocked-vs-waiting posture/motion in-scene

### Claude confidence signaling

Status:

- Claude is merged into the same snapshot model
- transcript-derived Claude agents carry `provenance = claude` and `confidence = inferred`
- local workflow/subagent transcript and journal child rows carry `provenance = claude` and `confidence = inferred`
- hook-backed Claude sessions, subagents, and Agent Teams rows carry `provenance = claude` and `confidence = typed` when their state comes from typed hook/team metadata, including when a hook row upgrades a matching inferred workflow child
- Hermes agents carry `provenance = hermes` and `confidence = inferred`
- Codex, cloud, and presence entries carry typed provenance

Current representation:

- visual distinction between typed Codex truth, typed Claude hook/team activity, and inferred Claude transcript activity in hover and session detail
- explicit confidence and provenance surfaces in the shared model

Missing representation:

- stronger in-scene styling differences between Codex-native, Claude typed, and Claude-inferred agents

## Practical Summary

Today the project already rides:

- Codex thread discovery
- Codex full thread reads
- Codex status flags
- Codex turn-item summaries
- Codex raw app-server notifications
- Codex turn lifecycle events
- Codex approval and input request events
- Codex cloud task listing
- Codex thread file watches for fast refresh
- Claude local JSONL discovery
- Claude tool-use and message inference
- local Claude workflow/subagent transcript and journal discovery
- Claude provenance/confidence signaling
- hook-backed Claude approval and elicitation responses from the browser queue
- hook-backed Claude subagent child rows from `agent_id`
- Claude Agent Teams teammate rows and cowork/worktree floor discovery
- Claude Desktop Co-work project floors and read-only local-agent sessions
- Hermes local `state.db` session discovery
- Hermes cwd/env and system-prompt project matching

Today the project does not yet fully ride:

- richer turn lifecycle motion
- direct Claude or Cursor session reply steering

That is the current observability contract of Codex Agents Office.
