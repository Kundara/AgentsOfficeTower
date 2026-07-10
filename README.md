# Agents Office Tower

A live pixel-office view for agent work across Codex, Claude, Cursor, Hermes, OpenClaw, cloud tasks, and shared rooms.

Agents Office Tower is not a chat replay tool. It is a workload surface: what is active, who is waiting, where work is happening, and which sessions need attention.

![Agents Office Tower preview](docs/images/tower-preview.png)

## Highlights

- **Live office map**: active agents sit at desks, blocked or waiting work is visible, and recent finished leads rest in the rec area.
- **Fleet mode by default**: discovered Codex workspaces appear together, with projectless Codex tasks, locally materialized Claude Home work, and recent remote Claude Home work metadata combined at tables on the street-level Chat Café floor. Codex Quick Chat becomes visible after **Add to task**; ordinary ChatGPT and Claude chat history remains outside the supported local session APIs.
- **A real tower cutaway**: blue-brick workspace floors with restrained seams share a straight full-width crown, facade, and foundation above a pixel-art Chat Café; grounded avatars move through the navigation grid while only roaming Hermes/OpenClaw orchestrators fly outside the building.
- **Per-workspace colors**: Customize beside Shared/Focus selects browser-local Floor, Wall, and Board base colors; bounded lighter/darker shades are derived automatically and persist across merged or split worktree views.
- **Codex-first visibility**: local Codex app-server data, Codex CLI activity, typed goals, cloud tasks, subagents, approvals, input waits, and typed events share one model.
- **Hermes and OpenClaw support**: Hermes sessions come from durable state, live process hints, and optional hook sidecars, while OpenClaw sessions come from its Gateway; projectless Hermes and unmatched OpenClaw orchestrators hover in the left-side sky outside the tower instead of creating fake floors.
- **CLI built in**: inspect snapshots, watch terminal views, launch the web server, or query the running tower from scripts.
- **Repo-packaged skills**: Codex skills help agents run the tower CLI and coordinate with local or team workload data.
- **Shared rooms**: sync active agents across machines with PartyKit-backed rooms and explicit per-project sharing controls.
- **Same model everywhere**: browser, terminal, and VS Code surfaces render the same normalized snapshot.
- **Subtle scene intelligence**: viewport-level hover cards, command toasts, and hot-file cues stay subordinate to the map, while the scrollable Sessions index keeps `Needs You`, every active session, and a globally capped recent list readable across desktop and narrow layouts.

## Surfaces

- Browser office view
- Terminal `snapshot`, `watch`, and `web query`
- VS Code activity-bar panel
- Repo-discovered Codex skills in `.agents/skills/`

## Supported Sources

| Source | Visibility |
| --- | --- |
| Codex local | Best support through `codex app-server`, CLI/runtime discovery, typed goals, typed events, approvals, inputs, and subagents |
| Codex cloud | Cloud task list through `codex cloud list --json` |
| Claude | Local Claude Code logs, Agent SDK session reads, inferred workflow/subagent child rows from local `subagents` files, hook-backed typed sidecars, Agent Teams cowork floors, Agent View background jobs, locally materialized Claude Home work folders, and bounded read-only metadata for recent remote Home work sessions |
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
npm run check:agent-workflows
npm run check
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

This repo ships auto-discovered Codex skills for working with the tower from inside agent sessions:

- `.agents/skills/agents-tower`: start, restart, verify, and query the local tower, including the lightweight `gist` state sync.
- `.agents/skills/agents-tower-coordination`: inspect local or team workload before editing, starting with `gist` before deeper `recent`/`last` queries to avoid duplicate work and file conflicts.

They are designed for bounded visibility, not remote control. Skills can query tower state, but they do not approve requests, send replies, or mutate another agent's session.

## Codex Workflow

The trusted-project config pins lead and review work to `gpt-5.6-sol`, enables bounded multi-agent v2 collaboration, and registers read-only mapping, copy, and verification roles. The lead agent owns integration and final validation; workers stay one level deep and do not share edit scopes.

See [docs/agent-workflows.md](docs/agent-workflows.md) for the model baseline, role-selection rules, delegation handoff, permission boundary, and validation commands.

## Optional Integrations

- **Claude**: Claude Code sessions are read from the Agent SDK when available, then fall back to local project logs. Project-scoped hook sidecars can upgrade Claude Code sessions from inferred transcript state to typed state, including browser-answerable `PermissionRequest` / `Elicitation` waits, `MessageDisplay` assistant streaming, and shared delegated-work events for Agent/Task and subagent hooks. Hook records with `agent_id` appear as child agents under the lead Claude session, local workflow/subagent transcript and journal files can add inferred child rows without hooks, Agent Teams can add teammate child rows plus cowork/worktree floors, Claude Agent View background jobs from `$CLAUDE_CONFIG_DIR/jobs/*/state.json` or `~/.claude/jobs/*/state.json` can appear as read-only `claude:background` agents with `claude attach <job>` resume commands, and locally materialized Claude Home work folders can appear as read-only workspace floors. Claude rows also expose inferred normalized goal metadata from session titles, prompts, teammate prompts, job names, and child descriptions so API consumers can correlate goal context without treating Claude as a typed Codex goal source.

  Claude's current UI calls this surface **Home**; the desktop bundle still uses `cowork` names internally, so Agents Office keeps `claude:cowork` as a compatibility source kind. The Agent SDK session inventory belongs to the separate Code surface and must not be reclassified as Home. Agents Office may parse bounded watch responses already present in Claude Desktop's local HTTP cache, but it only extracts the remote Home-work metadata allowlist; it never extracts, retains, or exposes cookies, storage tokens, messages, prompts, event cursors, or calls Claude's private endpoint. Ordinary personal Home chats still have no supported live listing API and are not synthesized.

  Codex Quick Chat is likewise separate from the Codex app-server thread inventory. Use **Add to task** in Codex to turn that conversation into a supported task that can appear in the Chat Café.
  Dynamic workflows / `ultracode` can fan out many workflow-managed subagents. Agents Office discovers those children from local `subagents` transcripts, matching `*.meta.json`, and workflow `journal.jsonl` records under the Claude project session folder; hook sidecars still upgrade matching rows to typed confidence when available.

- **Hermes**: install a user-level hook bridge:

  ```bash
  node packages/cli/dist/index.js agents link hermes
  ```

  The command writes `~/.hermes/plugins/codex-agents-office`, enables it in `~/.hermes/config.yaml`, removes a stale `plugins.disabled` entry for the bridge if present, and records bounded Hermes lifecycle hooks into machine-local Agents Office storage. Normal workstation avatars still come from durable Hermes session ids; plugin streams such as `default`, `process-<pid>`, or tool-task UUIDs are activity sidecars. Hermes sessions whose recent hook stream no longer points at a known workspace hover in the left-side sky until a project-bearing action seats them again; the last project relation expires after more than 20 rootless hook actions. Hermes cron sessions such as `cron_<job>_<timestamp>` render as temporary project tick agents. Hermes command, process, verification, planning, file-edit, MCP/tool, and subagent lifecycle hooks drive typed toasts, session history, and current action detail while the visible last message stays on Hermes assistant/subagent text rather than user prompts or unsent verification answers; read/search/skill-view tools stay scanning/tool activity instead of file edits.

- **OpenClaw**: configure `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` to read the Gateway in read-only mode. Sessions whose configured agent workspace matches a known project root, including child paths under that root, sit at desks with OpenClaw parent/child structure preserved. Active sessions outside the known project set render as `openclaw:roaming` orchestrators in the same fixed left-side sky layer used for projectless Hermes, with screen-space desk handoffs and cross-floor transfer motion.

- **Cursor**: this repo includes `.cursor/hooks.json` and `.cursor/hooks/capture-cursor-hook.mjs` for local hook sidecars. Cursor cloud visibility can use `CURSOR_API_KEY` or the browser settings flow.

- **Shared rooms**: use the browser `Settings` popup to join a PartyKit room. Each local project floor also has a persisted `Shared` toggle that defaults off; turning it on publishes that project's active agents to connected peers, and incoming shared activity appears on each peer's matching local project without requiring a second opt-in.

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

- `.agents/skills`: repo-discovered Codex skills for tower operations and coordination
- `.codex`: GPT-5.6 project defaults and bounded specialist role definitions
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
- [docs/agent-workflows.md](docs/agent-workflows.md)
- [docs/self-development.md](docs/self-development.md)
- [docs/references.md](docs/references.md)
- [CHANGELOG.md](CHANGELOG.md)

## Asset Credits

- Main PixelOffice environment assets come from [2D Pig's Pixel Office pack](https://2dpig.itch.io/pixel-office).
- Pixel food/drink held-item icons in `packages/web/public/pixel-office/sprites/props/drinks/` come from [Alex Kovacs Art's "100 Free Pixel Art Foods!"](https://alexkovacsart.itch.io/free-pixel-art-foods), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Chat Café tiles in `packages/web/public/pixel-office/sprites/cafe/` are derived from [Gherwit's free CAFE TILES and CITY TILES packs](https://gherwit.itch.io/cafe-tiles-16x16).
