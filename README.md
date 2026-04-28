# Agents Office Tower

A pixel-art shared workspace for all agents (Codex + Claude + Cursor).

## Main Features

- Sessions represented as agent avatars.
- Observe active local agents per project (project = floor) plus the last 4 agents.
- Subagents: an agent becomes a boss with a booth once it has more than 2 subagents.
- Multiplayer: share activity with friends or machines running on the same projects and see your agents together.
- Worktrees: split floors per worktree or collapse them together.
- Web and VS Code plugin views.

Agents Office Tower shows active work across local and cloud agent sessions in three places:

- a browser office view
- a terminal snapshot/watch view
- a VS Code activity-bar panel

It is built for current workload visibility, not transcript replay.

![Agents Office Tower preview](docs/images/tower-preview.png)

## What It Does

- Discovers active workspaces and renders them in fleet mode by default.
- Supports a focused single-project view when you want one repo at a time.
- Normalizes Codex, Claude, Cursor, OpenClaw, presence, and cloud inputs into one shared snapshot model.
- Keeps the browser, terminal, and VS Code views on that same model.
- Treats current work as the primary scene, with only light recent-history visibility.

## Current Surfaces

- Browser office view
- Terminal `snapshot` and `watch`
- VS Code activity-bar panel

## Supported Sources

- Codex local runtime via `codex app-server`
- Codex cloud tasks via `codex cloud list --json`
- Claude local logs, hooks, and Agent SDK signals
- Cursor local hook sidecars and Cursor cloud agents
- OpenClaw gateway sessions

Codex is still the strongest integration path.

## Quick Start

Run the web view:

```bash
npm start
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).

`npm start` installs dependencies if needed, rebuilds the workspace, and launches the web server on port `4181` unless you pass another port.

## Other Modes

Web, single-project focus:

```bash
npm start -- /abs/project/path --port 4181
```

Terminal snapshot:

```bash
node packages/cli/dist/index.js snapshot /abs/project/path
```

Terminal watch:

```bash
node packages/cli/dist/index.js watch /abs/project/path
```

Demo preview:

```bash
node packages/cli/dist/index.js demo preview --port 4181
```

Build and typecheck:

```bash
npm run build
npm run typecheck
```

## Browser Notes

- Fleet mode is the default browser mode.
- Fleet mode only keeps autodiscovered workspaces with session activity in the last 7 days.
- Git worktrees from the same repo merge onto one floor by default.
- The browser exposes a global `Split Worktrees` toggle when you want one floor per worktree instead.
- Single-project focus uses the same compact scene geometry as the tower view.
- Desk behavior follows normalized modes: working and waiting sessions stay on-desk, blocked failures stand at the desk, done/idle sessions cool into resting visibility, and cloud work stays separate.
- Desktop-backed Codex sessions preserve the fresher `thread/list` timestamp when `thread/read` lags, so a visibly working read-only session stays current instead of falling back to stale idle state.
- Fresh non-final local Codex activity from command, file, tool, plan, or turn events also refreshes desk seating, even if the restarted observer is temporarily `readOnly` or the app-server thread status reads `idle`.
- Fresh `notLoaded` desktop timestamps with no readable turns are treated as just-sent prompts for an 8-second recovery window, so the agent reserves a desk immediately after the user types; stale `notLoaded` replies use only the 3-second finished cooldown and no longer stay desk-active for minutes after completion.
- `thread/closed`, `turn/completed`, and `turn/interrupted` are treated as transport/update boundaries, not workstation release signals. The desk releases on final-answer completion, hard failure/archive, or a confirmed idle unload.
- Quiet local Codex desk-live work now stays current and workstation-seated for about 3 minutes between reply chunks when recent non-final activity is still flowing or the transport is transiently `notLoaded`, so slow thinking gaps do not bounce into the rec area.
- Ongoing local Codex threads now stay treated as active in the browser session logic too, so a quiet in-progress thread does not look desk-live in the map while simultaneously cooling off in session-oriented views.
- After a top-level local Codex thread actually stops, its workstation remains visible for about 3 seconds so the final reply can toast/read before the lead cools into rec-area visibility.
- The office view uses smaller above-head state markers for needs-user waits, planning, pre-message typed thinking moments, and blocked-error states in addition to the toast layer.
- Recent typed `turn/*` lifecycle events now also raise short above-head turn badges for `START`, `DONE`, `STOP`, and `FAIL`, so turn transitions read directly in-scene instead of only through toasts.
- Waiting desk work now visibly pulses its `...`/hand cue, blocked desk work gets a short shake treatment, and validating work uses a brighter pulsing workstation glow instead of sharing the generic busy motion.
- Planning, scanning, editing, running, validating, and delegating desk work now use distinct seated micro-motion profiles instead of one shared idle bob.
- Room changes now render as an old-room doorway exit plus a fresh doorway entry in the destination room, and tiny same-slot refresh deltas now reuse the settled target so ordinary polling does not look like movement.
- Recent typed plan, command, file/diff, and tool-call events now also raise brief animated in-scene activity cues (`PLAN`, `RUN`, `EDIT`, `TOOL`) near the actor instead of relying only on toast updates.
- Typed approval waits, input waits, and queue-clearing request resolution now also raise brief in-scene lifecycle cues (`WAIT`, `ASK`, `OK`) so the room reflects the same request lifecycle that the durable `Needs You` queue is tracking.
- Those activity/request cues now include mode-specific iconography and motion inside the chip itself, so the scene differentiates planning, command, edit, tool, wait, ask, and resolve work even before you read the label.
- Recent typed desk activity now also drives short workstation-side non-text effects, so command, edit, tool, wait, ask, and resolve work read off the station itself instead of depending only on floating cue chips; approval waits now reflect decision breadth and input waits reflect question load.
- `/scene-effects-audit` now boots the normal browser client against mocked typed approval/input fleet data so request-specific scene effects can be visually inspected even when the live fleet has no current `Needs You` cases.
- Message/reply toasts now replace older toasts only for that same agent/thread, so one agent's new speech does not wipe unrelated active toasts elsewhere in the room.
- Slow first hydration from the Codex app-server is now treated as baseline state instead of fresh activity, so older first-seen Codex agents do not doorway-enter late and old replies do not replay as new toasts just because the observer attached after the page rendered.
- The browser `Needs You` queue can now answer local Codex approval waits directly with `Accept`, `Always for session`, `Decline`, or `Cancel`, can submit local typed Codex `tool/requestUserInput` answers inline, and can now answer hook-backed Claude `PermissionRequest` and schema-backed `Elicitation` waits from that same queue.
- The verified `tool/requestUserInput` response shape is `{ answers: { "<questionId>": { answers: ["..."] } } }`; queue submit stays disabled until every required question has at least one answer, while optional prompts can be left blank and are omitted from the payload.
- General local Codex input waits without schema-backed questions can open the browser reply composer only when the thread is owned by the same app-server connection as Agents Office; observed desktop, VS Code, and CLI threads stay view-only in the browser.
- Hook-backed Claude waits now use a machine-local per-project file bridge in Agents Office user data; the browser writes approval/input responses there, the Claude Agent SDK hook returns the official structured decision, and Agents Office appends a synthetic resolution marker so the queue clears immediately.
- App-server-owned local typed Codex session cards can include an inline `Reply` composer that resumes idle threads with `turn/start` and steers active ones with `turn/steer`. Observed desktop, VS Code, and CLI Codex threads are view-only from the browser because the observer app-server cannot reliably inject a normal chat message into those already-open clients.
- Local Codex agents in the map can now be clicked directly to open a small in-scene thread card with recent typed thread history. The scene card is read-only history only, with no Send, resume, launch, or copy controls.
- While that in-scene thread card is open, map hover tooltips stay suppressed and the chat is rendered as a compact right-edge floor panel instead of following the avatar, so it remains readable inside short floor viewports. The panel is reconciled in place during live refreshes: new messages animate into the bottom of the stack, bottom-scrolled users stay pinned to the latest message, and long bubbles clamp to eight lines until `Show more` is opened.

## Optional Integrations

- Codex CLI for the best local visibility
- Codex desktop app as a fallback runtime
- Cursor local hooks in `.cursor/hooks.json`
- Cursor cloud-agent API via `CURSOR_API_KEY` or the browser settings flow
- PartyKit-backed shared browser room sync

<details>
<summary>Cursor hooks</summary>

This repo ships project-level Cursor hooks in [`.cursor/hooks.json`](.cursor/hooks.json) and [`.cursor/hooks/capture-cursor-hook.mjs`](.cursor/hooks/capture-cursor-hook.mjs).

When the repo is opened in a trusted Cursor workspace, those hooks append typed local sidecars into the matching per-project Agents Office user-data folder instead of writing `.codex-agents/` into the repo. Agents Office reads local Cursor activity from those sidecars.

To add the same integration to another repo:

1. Create a `.cursor/` folder in that repo.
2. Copy [`.cursor/hooks.json`](.cursor/hooks.json).
3. Copy [`.cursor/hooks/capture-cursor-hook.mjs`](.cursor/hooks/capture-cursor-hook.mjs).
4. Keep the command path as `node .cursor/hooks/capture-cursor-hook.mjs <event-name>`.
5. Open that repo in a trusted Cursor workspace and send one fresh prompt.

Minimal verification:

1. Confirm a new Cursor sidecar appears in Agents Office machine-local project storage.
2. Refresh Agents Office.

For Cursor cloud-agent visibility, set `CURSOR_API_KEY` or save the key in the browser `Settings` popup.

More detail: [docs/integration-hooks.md](docs/integration-hooks.md)
</details>

<details>
<summary>PartyKit shared-room sync</summary>

The browser can join a shared PartyKit room from the `Settings` popup.

Fields:

- `Sharing`: toggle sync on or off
- `Host`: your PartyKit host such as `your-app.partykit.dev`
- `Room`: a shared room name such as `team/project-name`
- `Nickname`: an optional short label shown on remote agents

Once connected, each local project floor also gets a persisted `Shared` toggle in its header so you can stop broadcasting that project without leaving the room. Remote-only projects exposed by the room now stay visible even when they are not local to your machine, show active participant nicknames in the floor header, grey the title slightly when you are not involved locally, and cool down for 1 hour before disappearing after sharing stops. The browser and VS Code panel also reuse the same machine-local room identity now, so opening both views at once will not mirror your own Codex agents back in as a fake remote peer.

Quick relay flow:

```bash
npm run party:dev
npm run party:deploy
```

After deploy, use the generated `partykit.dev` host in the browser `Settings`.

More detail:

- [docs/references.md](docs/references.md)
- [docs/architecture.md](docs/architecture.md)
</details>

## VS Code

Build the extension:

```bash
npm run build -w packages/vscode
```

The VS Code activity-bar panel embeds the real office renderer by starting a local Agents Office web server.

After building, reload VS Code or press `F5` in extension development. The activity-bar container title is `Agents Office Tower`.

## Repo Layout

- `packages/core`: shared model, discovery, adapters, snapshot assembly, and workload policies
- `packages/web`: HTTP server and bundled browser client
- `packages/cli`: `web`, `snapshot`, `watch`, and demo entrypoints
- `packages/vscode`: VS Code panel
- `packages/party`: optional PartyKit relay
- `docs`: architecture, hooks, references, and priorities

## Docs

- [docs/spec.md](docs/spec.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/integration-hooks.md](docs/integration-hooks.md)
- [docs/self-development.md](docs/self-development.md)
- [docs/references.md](docs/references.md)
- [CHANGELOG.md](CHANGELOG.md)


## Asset Credits

- Main PixelOffice environment assets come from [2D Pig's Pixel Office pack](https://2dpig.itch.io/pixel-office).
- Pixel food/drink held-item icons in `packages/web/public/pixel-office/sprites/props/drinks/` come from [Alex Kovacs Art's "100 Free Pixel Art Foods!"](https://alexkovacsart.itch.io/free-pixel-art-foods), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
