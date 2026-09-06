# AGENTS

## Purpose

`AgentsOfficeTower` is a workspace-level observability layer for agent sessions across Codex, Claude, Cursor, Hermes, OpenClaw, cloud tasks, and shared rooms. Codex has the deepest typed support; every provider is normalized into the same workload model.
It renders current workload across local and cloud agent work as:

- a browser office view
- a terminal snapshot/watch view
- a VS Code panel

The project goal is not generic chat replay. It is live workload visibility:

- which workspaces are active now
- which parent sessions are leading work
- which subagents are active, waiting, blocked, or done
- what room or project area that work maps to

## Repo map

- `packages/core`
  Shared project discovery, room parsing, appearance storage, workload classification, and live snapshot plumbing.
- `packages/web`
  Browser server and renderer for the office / terminal views.
- `packages/cli`
  CLI entrypoints for watch, snapshot, room scaffolding, Aseprite inspection, and web hosting.
- `packages/vscode`
  VS Code activity-bar integration.
- `CHANGELOG.md`
  Versioned record of notable additions, fixes, and behavior changes.
- `docs/architecture.md`
  High-level system design and current rendering model.
- `docs/integration-hooks.md`
  Exact Codex, Claude, and Cursor integration surfaces, plus how they map into the product.
- `docs/agent-workflows.md`
  GPT-6 Astra model policy, Codex role selection, delegation boundaries, skill layout, and workflow validation.
- `docs/self-development.md`
  Project-quality bar, iteration priorities, and what to improve next.
- `docs/references.md`
  External references used by this project.
- `.codex/agents`
  GPT-6 Astra Codex role config layers for read-only mapping, copy, and verification.
- `.agents/skills`
  Auto-discovered Tower operation and coordination skills.
- `.codex-agents`
  Legacy project-local runtime path. New per-project runtime data lives in Agents Office user data keyed by project root, with `.codex-agents` kept as a read-compatible fallback.

## Working rules

- Treat the current workload view as the primary product surface.
- Prefer official Codex surfaces over transcript scraping.
- Keep rooms data-driven through the saved per-project `rooms.xml` in Agents Office user data.
- Keep appearance persistence in the saved per-project `agents.json` in Agents Office user data.
- Do not introduce fake “boss” agents as the main solution path.
  If current desktop visibility is missing, prefer improving real session discovery.
- The office map should communicate activity mostly through motion, placement, hover cards, and the session panel.
  Avoid large task-title overlays inside the room scene.
- Prefer small in-scene transparency cues over separate dashboard furniture.
  High-level summaries should stay subtle and not read like a detached admin panel.
- Keep Codex-native typed state visually distinct from Claude-inferred state.
  Hover cards, session panels, and event surfaces should expose provenance/confidence when that distinction matters.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
  Workstations may reveal on entry, but exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled from the asset sheet intentionally.
  Do not use the example scene PNG as a runtime collage substitute.
- Keep `CHANGELOG.md` current for notable additions, fixes, compatibility changes, and behavior shifts.
  Do not treat formatting-only churn, local IDE noise, or generated artifacts as changelog-worthy unless shipped behavior changed.
- Keep delegation bounded to independent work with non-overlapping file scopes.
  The lead agent owns integration, user communication, shared-file edits, and the final validation claim.
- Use `office_mapper` for broad read-only discovery, `content_designer` for constrained UI wording, and `office_verifier` for an independent post-change review.
- Keep role selection metadata in `.codex/config.toml` and role-specific model, effort, sandbox, and instructions in `.codex/agents/*.toml`.
- Keep repo skills under `.agents/skills` so Codex discovers them without user-level installation.

## Commands

```bash
npm install
npm run build
npm run typecheck
npm run check:agent-workflows
npm run check
npx codex-agents-office demo preview --port 4181
npx codex-agents-office watch
npx codex-agents-office snapshot /abs/project/path
npx codex-agents-office web --port 4181
```

## Web ops

- Treat the listener on `4181` as explicit runtime state.
  Do not assume the page in the browser matches the latest source tree unless the server was rebuilt and restarted.
- If the browser shell looks stale or empty, verify the live server first:

```bash
curl http://127.0.0.1:4181/api/server-meta
curl http://127.0.0.1:4181/api/fleet
```

- `api/server-meta` is the source of truth for:
  - `pid`
  - `startedAt`
  - `buildAt`
  - `explicitProjects`
  - `entry`
  - bound projects / port
- Default browser deploys must run in fleet mode.
  Launch `web` without a project argument so all discovered Codex workspaces remain visible.
  Only pass explicit project roots for temporary focused debugging, and verify `explicitProjects: false` in `api/server-meta` after normal restarts.
- If a stale listener is on `4181`, kill it explicitly:

```bash
lsof -iTCP:4181 -sTCP:LISTEN -n -P
lsof -tiTCP:4181 -sTCP:LISTEN | xargs -r kill
pkill -f 'packages/web/dist/server.js --port 4181'
```

- If launching through the CLI entrypoint, rebuild core, web, and CLI packages first:

```bash
npm run build -w packages/core
npm run build -w packages/web
npm run build -w packages/cli
node packages/cli/dist/index.js web --port 4181
```

- If you only need the raw web server path for validation, this is acceptable:

```bash
node packages/web/dist/server.js --port 4181
```

- The in-page `Refresh` button refreshes fleet data.
  It does not replace a stale Node listener with a fresh build.
- If the UI suddenly shows only the current repo again, assume the listener was restarted in explicit-project mode first.
  Check `api/server-meta` before debugging discovery logic.
- For visual validation, prefer real browser captures against `4181`.
  Snapshot mode is acceptable when you want a stable still render:

```bash
'/mnt/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless --disable-gpu --no-first-run \
  --disable-background-networking --disable-sync \
  --window-size=920,1600 \
  --virtual-time-budget=20000 \
  --timeout=25000 \
  --screenshot='C:\temp\codex-agents-office-validate.png' \
  'http://127.0.0.1:4181/?project=/abs/project/path&screenshot=1'
```

## Renderer expectations

- Use current workload by default.
- Keep the browser map fixed to live agents on desks plus the 4 most recent lead sessions in the rec area.
- Keep browser layout responsive across wide and narrow screens.
- Compact fleet floors size themselves to seating demand: minimum height fits two boss booths and two desk pod rows, maximum is the configured 16-tile room, and floor-height changes tween quickly instead of snapping.
- Empty rooms should read as quiet space, not error states.
- Rec Room is for resting/recent-finished lead sessions only.
- Waiting, blocked, validating, running, and other still-live local Codex work should stay at workstations.
- When `thread/list` reports a fresher desktop-backed Codex thread than `thread/read`, preserve the fresher `thread/list` timestamp for current-workload classification.
- Fresh non-final local Codex work activity such as command, file, tool, plan, or turn events should refresh current-workload seating even when a restarted observer temporarily sees the thread as `readOnly` or `idle`.
- Browser replies are only supported for Codex threads owned by the same app-server connection as Agents Office outside the scene chat. The in-scene agent thread panel is read-only history only; do not present generic browser Send, resume, or launch controls there.
- A fresh desktop `notLoaded` thread timestamp with no readable turns should reserve a desk for about 8 seconds as a just-sent prompt, but stale `notLoaded` recovery must fall back to the 3-second finished cooldown rather than keeping a finished thread desk-active for minutes.
- Do not treat `thread/closed`, `turn/completed`, or `turn/interrupted` as proof that an active Codex session is finished. Keep the desk until a final-answer message, hard failure/archive, or confirmed idle unload releases it.
- A fresh read-only `notLoaded` Codex thread without a final answer should remain desk-seated through quiet text gaps; once a top-level thread actually stops, keep the desk for about 3 seconds before cooling into rec-room visibility.
- Workstations should match the chosen PixelOffice station language consistently across rows.
- Command-window toasts should aggregate per agent instead of stacking duplicate windows.
  Keep one toast per agent, append new command lines at the bottom, and cap the bubble at 3 visible lines.
- The session panel should keep the durable approval/input "Needs You" queue visible when those states exist.
- The session panel should present pinned Needs You, then every live session, then at most 10 recent sessions across the selected scope. Its own scroll region must keep the final row reachable and preserve scroll/focus during live refresh; cards must wrap instead of clipping at narrow widths, 200% zoom, and maximum text scale.
- Private rootless account agents such as observed Claude Home remote work should render exactly once in Chat Café and Sessions, remain read-only, and never enter project snapshots or shared multiplayer payloads. Codex Quick Chat must not be synthesized before the user chooses Add to task.
- Hover details should expose the useful live state:
  - name
  - role
  - state
  - last useful action
  - provenance / confidence when relevant
  - resume/open affordance when available

## Documentation expectations

When architecture or behavior changes materially, update:

- `CHANGELOG.md`
- `README.md`
- `docs/architecture.md`
- `docs/integration-hooks.md` if hook usage or representation changed
- `docs/agent-workflows.md` if model, role, delegation, permission, or skill behavior changed
- `docs/self-development.md` if priorities changed
- `docs/references.md` if a new external source shaped the implementation

## Changelog expectations

- Keep entries under the current root `package.json` version until the user explicitly asks for a version bump.
- Do not bump versions autonomously.
- Seed changelog entries from the real Git change set, not guessed summaries.
- Prefer `Added`, `Changed`, `Fixed`, `Removed`, and `Docs` headings as needed, and skip empty sections.
- Focus on shipped behavior, compatibility, product surface changes, and meaningful documentation changes.
