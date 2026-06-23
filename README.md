# Agents Office Tower

A live pixel-office view for agent work across Codex, Claude, Cursor, Hermes, OpenClaw, cloud tasks, and shared rooms.

Agents Office Tower is not a chat replay tool. It is a workload surface: what is active, who is waiting, where work is happening, and which sessions need attention.

![Agents Office Tower preview](docs/images/tower-preview.png)

## Highlights

- **Live office map**: active agents sit at desks, blocked or waiting work is visible, and recent finished leads rest in the rec area.
- **Fleet mode by default**: discovered Codex workspaces appear together, with optional focus on one project or worktree.
- **Codex-first visibility**: local Codex app-server data, Codex CLI activity, typed goals, cloud tasks, subagents, approvals, input waits, and typed events share one model.
- **Hermes and OpenClaw support**: Hermes sessions come from durable state, live process hints, and optional hook sidecars, while OpenClaw sessions come from its Gateway; projectless Hermes and unmatched OpenClaw orchestrators hover in the left-side sky outside the tower instead of creating fake floors.
- **CLI built in**: inspect snapshots, watch terminal views, launch the web server, or query the running tower from scripts.
- **Repo-packaged skills**: Codex skills help agents run the tower CLI and coordinate with local or team workload data.
- **Shared rooms**: sync active agents across machines with PartyKit-backed rooms and explicit per-project sharing controls.
- **Same model everywhere**: browser, terminal, and VS Code surfaces render the same normalized snapshot.
- **Subtle scene intelligence**: viewport-level hover cards, session panels, command toasts, hot-file cues, and the `Needs You` queue surface detail without turning the map into a dashboard.

## Surfaces

- Browser office view
- Terminal `snapshot`, `watch`, and `web query`
- VS Code activity-bar panel
- Codex skills in `Skills/`

## Supported Sources

| Source | Visibility |
| --- | --- |
| Codex local | Best support through `codex app-server`, CLI/runtime discovery, typed goals, typed events, approvals, inputs, and subagents |
| Codex cloud | Cloud task list through `codex cloud list --json` |
| Claude | Local logs, Agent SDK session reads, inferred workflow/subagent child rows from local `subagents` files, hook-backed typed sidecars, Agent Teams cowork floors, Agent View background jobs, and Claude Desktop Co-work project folders |
| Cursor | Local hook sidecars, workspace/log inference, and Cursor cloud agents |
| Hermes | Durable `state.db` sessions, profile stores, live process cwd/env hints, and optional hook bridge sidecars folded into the matching session |
| OpenClaw | Gateway sessions and config surfaces, with unmatched orchestrators rendered as fixed sky agents |
| Shared rooms | Remote peer presence and active agent snapshots from explicitly shared PartyKit rooms |

## Quick Start

```bash
npm start
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).

`npm start` installs dependencies if needed, rebuilds the workspace, and starts fleet mode on port `4181`.

## Common Commands

```bash
# Web tower
npm start
npm start -- /abs/project/path --port 4181

# Build and checks
npm run build
npm run typecheck
npm run check:codex-protocol

# Terminal views
node packages/cli/dist/index.js snapshot /abs/project/path
node packages/cli/dist/index.js watch /abs/project/path

# Query the running local tower
node packages/cli/dist/index.js web query CodexAgentsOffice gist scope=local --json
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=local type=agents limit=5 --json
node packages/cli/dist/index.js web query CodexAgentsOffice recent scope=team type=events limit=10 --json

# Demo scene
node packages/cli/dist/index.js demo preview --port 4181
```

`web query` is read-only and loopback-only. `gist` is the light state-sync command for a quick checkup before deeper inspection: it returns top hot file changes plus active agents with their last message and last file change. `scope=local` reads the server's fleet snapshot. `scope=team` reads the coordinated shared-room cache when an open browser page is connected to sharing.

## Skills

This repo ships Codex skills for working with the tower from inside agent sessions:

- `Skills/agents-tower`: start, restart, verify, and query the local tower, including the lightweight `gist` state sync.
- `Skills/agents-tower-coordination`: inspect local or team workload before editing, starting with `gist` before deeper `recent`/`last` queries to avoid duplicate work and file conflicts.

They are designed for bounded visibility, not remote control. Skills can query tower state, but they do not approve requests, send replies, or mutate another agent's session.

## Optional Integrations

- **Claude**: Claude sessions are read from the Agent SDK when available, then fall back to local project logs. Project-scoped hook sidecars can upgrade Claude sessions from inferred transcript state to typed state, including browser-answerable `PermissionRequest` / `Elicitation` waits and shared delegated-work events for Agent/Task and subagent hooks. Hook records with `agent_id` now appear as child agents under the lead Claude session, local workflow/subagent transcript and journal files can add inferred child rows without hooks, Agent Teams can add teammate child rows plus cowork/worktree floors, Claude Agent View background jobs from `$CLAUDE_CONFIG_DIR/jobs/*/state.json` or `~/.claude/jobs/*/state.json` can appear as read-only `claude:background` agents with `claude attach <job>` resume commands, and Claude Desktop Co-work project folders can appear as read-only workspace floors. Claude rows also expose inferred normalized goal metadata from session titles, prompts, teammate prompts, job names, and child descriptions so API consumers can correlate goal context without treating Claude as a typed Codex goal source.

  Co-work support is intended to work across Windows, macOS, and Linux wherever Claude Desktop exposes the same local Co-work project data.
  Dynamic workflows / `ultracode` can fan out many workflow-managed subagents. Agents Office discovers those children from local `subagents` transcripts, matching `*.meta.json`, and workflow `journal.jsonl` records under the Claude project session folder; hook sidecars still upgrade matching rows to typed confidence when available.

- **Hermes**: install a user-level hook bridge:

  ```bash
  node packages/cli/dist/index.js agents link hermes
  ```

  The command writes `~/.hermes/plugins/codex-agents-office`, enables it in `~/.hermes/config.yaml`, and records bounded Hermes lifecycle hooks into machine-local Agents Office storage. Normal workstation avatars still come from durable Hermes session ids; plugin streams such as `default`, `process-<pid>`, or tool-task UUIDs are activity sidecars. Hermes sessions whose recent hook stream no longer points at a known workspace hover in the left-side sky until a project-bearing action seats them again; the last project relation expires after more than 20 rootless hook actions. Hermes cron sessions such as `cron_<job>_<timestamp>` render as temporary project tick agents. Hermes command, process, planning, file-edit, and MCP/tool hooks drive typed toasts, session history, and current action detail while the visible last message stays on Hermes assistant/subagent text rather than user prompts; read/search/skill-view tools stay scanning/tool activity instead of file edits.

- **OpenClaw**: configure `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` to read the Gateway in read-only mode. Sessions whose configured agent workspace matches a known project root, including child paths under that root, sit at desks with OpenClaw parent/child structure preserved. Active sessions outside the known project set render as `openclaw:roaming` orchestrators in the same fixed left-side sky layer used for projectless Hermes, with screen-space desk handoffs and cross-floor transfer motion.

- **Cursor**: this repo includes `.cursor/hooks.json` and `.cursor/hooks/capture-cursor-hook.mjs` for local hook sidecars. Cursor cloud visibility can use `CURSOR_API_KEY` or the browser settings flow.

- **Shared rooms**: use the browser `Settings` popup to join a PartyKit room. Each local project floor also has a persisted `Shared` toggle that defaults off; only shared projects with active agents are broadcast, and remote activity appears only on matching local projects that you also marked shared.

  ```bash
  npm run party:dev
  npm run party:deploy
  ```

## VS Code

```bash
npm run build -w packages/vscode
```

The VS Code panel embeds the real office renderer by starting a local Agents Office web server. Reload VS Code or press `F5` in extension development after building.

## Repo Layout

- `Skills`: Codex skills for tower operations and coordination
- `packages/core`: discovery, adapters, room parsing, workload policy, and snapshot assembly
- `packages/web`: browser server, renderer, routes, and client bundle
- `packages/cli`: `web`, `snapshot`, `watch`, `web query`, demo, and integration commands
- `packages/vscode`: VS Code activity-bar integration
- `packages/party`: optional PartyKit relay
- `docs`: spec, architecture, hooks, references, and development notes

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
