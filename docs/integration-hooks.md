# Integration Hooks

## Purpose

This document answers two questions:

1. What signals can Codex Agents Office read from Codex and Claude today?
2. How does each signal get represented in this project?

The goal is practical transparency. This is not a generic event catalog. It is the list of hooks this codebase can already ride, plus the places where we are still leaving signal on the table.

## Normalized Model

Everything eventually lands in the shared `DashboardSnapshot` and `DashboardAgent` model from `packages/core/src/types.ts`.

The important normalized agent fields are:

- `source`
  `local`, `cloud`, `presence`, or `claude`
- `sourceKind`
  where the session came from, such as `cli`, `vscode`, `subAgent`, or `claude:<model>`
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
  whether the visible state comes from typed Codex data, inferred Claude data, cloud tasks, or synthetic presence
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

- spawns `codex app-server`
- initializes a JSON-RPC-like session
- requests `thread/list`
- requests `thread/read`
- parses app-server notifications

Important note:

- raw notifications are parsed and exposed through `onNotification(...)`
- `ProjectLiveMonitor` now consumes those raw notifications directly
- targeted `thread/read` refreshes still happen, but they are triggered behind the event stream instead of replacing it

This means app-server is now both the main truth source and the first-class local event bus for browser notifications.

### `thread/list`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/project-paths.ts`
- `packages/core/src/snapshot.ts`
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

### `thread/read`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/snapshot.ts`
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
- infer subagent parentage and depth
- generate `resumeCommand`
- map the session into project rooms using extracted paths

### Thread status and active flags

Consumed in:

- `packages/core/src/snapshot.ts`

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
- in-progress turn with no better signal -> `thinking`
- recent completed answer -> `done`
- old inactive thread -> `idle`

In the browser this becomes:

- workstation occupancy
- waiting / blocked indicators
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
| `webSearch` | `scanning` | active worker, no explicit notification |
| `mcpToolCall` | `scanning` or `blocked` | active worker, detail text names `server.tool` |
| `collabAgentToolCall` | `delegating` | active worker, delegation summary |
| `collabToolCall` | `delegating` | active worker, subagent spawn/wait summary |
| `plan` | `planning` | active worker, planning summary |
| `reasoning` | `thinking` | active worker, thinking summary |
| `agentMessage` | `thinking` or `done` | message summary, optional notification |
| `userMessage` | `planning` or `idle` | assigned-work summary |

### File change semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/server.ts`

What we read from Codex:

- changed file paths
- change kind such as create, delete, move, rename, or edit

How we use it:

- set `activityEvent.type = fileChange`
- set `activityEvent.action = created|deleted|moved|edited`
- mark image paths so the browser can show image previews
- map changed paths into rooms
- show floating text such as `Edited client.tsx` or `Created rooms.xml`

### Command execution semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/server.ts`

What we read from Codex:

- command string
- command cwd
- command status

How we use it:

- classify validation-like commands as `validating`
- classify other commands as `running`
- failed or declined commands become `blocked`
- render floating text such as `Ran npm run build`

### Subagent metadata

Mapped in:

- `packages/core/src/snapshot.ts`

What we read from Codex:

- `thread.source`
- `subAgent.thread_spawn.parent_thread_id`
- `subAgent.thread_spawn.depth`
- role hints from prompt text and user message text
- `thread.agentRole`

How we use it:

- identify spawned subagents
- link them to parent threads
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
- notifications are filtered to the current project by known thread ids and discovered paths
- matching notifications are converted into normalized `DashboardEvent` records
- those events are attached to the next `DashboardSnapshot`
- matching threads are re-read so stable state and event detail stay aligned

Why it matters:

- the browser can react to real event boundaries instead of only snapshot diffs
- command, file, approval, input, subagent, and turn lifecycle transitions now arrive as typed events

### `codex cloud list --json`

Implemented in:

- `packages/core/src/cloud.ts`
- `packages/core/src/snapshot.ts`

What we read:

- task id
- URL
- title
- status
- updated time
- environment label
- file/line change summary

How we use it:

- create `source = cloud` agents
- attach them to project snapshots when the cloud environment label matches the project name
- render cloud sessions in the same fleet/session model

## Claude Hooks

Claude support is intentionally second priority and inference-based.

Primary code path:

- `packages/core/src/claude.ts`

### Claude project discovery

What we read:

- `~/.claude/projects/*/*.jsonl`

How we use it:

- scan project directories
- sample the head and tail of each log
- infer the project root from `cwd`
- merge Claude-discovered roots into workspace discovery

### Claude session sampling

What we read:

- recent JSONL records from the head and tail of each session file
- record timestamps
- message model names
- `cwd`
- `gitBranch`

How we use it:

- identify the session
- derive a display label from the Claude model
- infer the most recent meaningful activity
- assign an appearance and render it as a `claude` agent

### Claude record types we currently map

Mapped in:

- `packages/core/src/claude.ts`

Current Claude inference rules:

| Claude signal | State | Representation |
| --- | --- | --- |
| assistant `tool_use` with `edit`, `write`, `multiedit` | `editing` | file-change style notification and room mapping from paths |
| assistant `tool_use` with `bash`, `shell` | `running` or `validating` | command-style notification |
| assistant `tool_use` with `read`, `grep`, `glob`, `search`, `ls`, `list` | `scanning` | active worker without explicit notification |
| assistant `tool_use` with `task`, `delegate`, `agent` | `delegating` | delegation summary |
| latest user text newer than latest assistant text | `planning` | planning summary |
| recent assistant text | `thinking` | message summary, optional recent update notification |
| older assistant text | `done` then `idle` | finished or idle state |

### Claude activity events

What we synthesize:

- `fileChange`
- `commandExecution`
- `agentMessage`

How we use it:

- exactly the same browser notification path as Codex agents
- same room mapping via normalized `paths`
- same session-card and hover-card surfaces

What Claude does not currently provide here:

- typed waiting-on-approval state
- typed waiting-on-user-input state
- official parent/subagent hierarchy
- official resume/open command
- raw push notifications

## Representation In This Project

### Shared snapshot

Built in:

- `packages/core/src/snapshot.ts`

The snapshot builder merges:

- local Codex threads
- cloud tasks
- optional synthetic presence entries
- Claude inferred sessions

Then it:

- maps paths to rooms
- assigns appearances
- flags current workload with `isCurrent`
- carries recent event-native notifications in `events`

### Browser office

Rendered in:

- `packages/web/src/server.ts`

How normalized fields become visuals:

| Normalized field | Browser representation |
| --- | --- |
| `roomId` | desk placement inside a room |
| `state` | desk pose, rec-room placement, waiting/blocked bubbles, session labels |
| `activityEvent` | floating text notifications and image previews |
| `events` | event-native command, file, approval, input, subagent, and turn notifications |
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

- server-sent events from `/api/events`

Important detail:

- the browser still receives refreshed fleet snapshots
- those snapshots now include normalized `events` derived from raw Codex notifications
- notification text is generated from both event-native `snapshot.events` and snapshot-diff compatibility paths

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

Missing representation:

- direct action affordances back into the originating Codex surface
- richer blocked-vs-waiting posture/motion in-scene

### Claude confidence signaling

Status:

- Claude is merged into the same snapshot model
- Claude agents carry `provenance = claude` and `confidence = inferred`
- Codex, cloud, and presence entries carry typed provenance

Current representation:

- visual distinction between typed Codex truth and inferred Claude activity in hover and session detail
- explicit confidence and provenance surfaces in the shared model

Missing representation:

- stronger in-scene styling differences between Codex-native and Claude-inferred agents

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
- Claude provenance/confidence signaling

Today the project does not yet fully ride:

- richer turn lifecycle motion
- typed Claude waiting/blocking equivalents
- direct approval/input action affordances

That is the current observability contract of Codex Agents Office.
