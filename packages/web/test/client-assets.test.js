const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { renderHtml } = require("../dist/render-html.js");
const { renderSceneEffectsAuditHtml } = require("../dist/render/render-scene-effects-audit-html.js");
const { renderLayoutAuditHtml } = require("../dist/render/render-layout-audit-html.js");
const { renderWideOfficeAuditHtml } = require("../dist/render/render-wide-office-audit-html.js");
const { renderZOrderAuditHtml } = require("../dist/render-z-order-audit-html.js");

function readClientSource(...segments) {
  const source = readFileSync(join(__dirname, "../src/client", ...segments), "utf8");
  return segments.length === 1 && segments[0] === "styles.css"
    ? `${source}\n${readFileSync(join(__dirname, "../src/client/tower-visuals.css"), "utf8")}\n${readFileSync(join(__dirname, "../src/client/notifications.css"), "utf8")}`
    : source;
}

function readRuntimeSource(fileName) {
  return readClientSource("runtime", fileName);
}

function readTemplateExportValue(...segments) {
  const source = readClientSource(...segments);
  const start = source.indexOf("`");
  const end = source.lastIndexOf("`;");
  assert.ok(start >= 0 && end > start, `${segments.join("/")} should export a template literal`);
  return Function(`return ${source.slice(start, end + 1)}`)();
}

function extractRuntimeFunctions(source, names) {
  return names.map((name) => {
    const match = source.match(new RegExp(`      function ${name}\\([^]*?\\n      \\}`));
    assert.ok(match, `runtime should define ${name}`);
    return match[0];
  }).join("\n");
}

const navigationRuntimeFiles = [
  "navigation-pathing-source.ts",
  "navigation-overlays-source.ts",
  "floating-orchestrator-source.ts",
  "navigation-source.ts",
  "office-scene-lifecycle-source.ts",
  "furniture-interaction-source.ts",
  "attention-panel-source.ts"
];
const sceneRuntimeFiles = ["cafe-scene-source.ts", "scene-source.ts", "scene-renderer-source.ts"];

function readNavigationRuntime() {
  return navigationRuntimeFiles.map(readRuntimeSource).join("\n");
}

function readSceneRuntime() {
  return sceneRuntimeFiles.map(readRuntimeSource).join("\n");
}

test("renderHtml loads external client assets and bootstrap config", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /<link rel="stylesheet" href="\/client\/app\.css\?v=/);
  assert.match(html, /<script src="\/client\/app\.js\?v=.*"><\/script>/);
  assert.match(html, /window\.__AGENTS_OFFICE_CLIENT_CONFIG__/);
  assert.match(html, /"sceneDefinitions":\{/);
});

test("renderHtml can bootstrap a discovered fleet project list distinct from the seed options", () => {
  const html = renderHtml(
    {
      host: "127.0.0.1",
      port: 4181,
      explicitProjects: false,
      projects: [{ root: "/tmp/seed", label: "Seed" }]
    },
    [
      { root: "/tmp/seed", label: "Seed" },
      { root: "/tmp/discovered", label: "Discovered" }
    ]
  );

  assert.match(html, /"root":"\/tmp\/seed","label":"Seed"/);
  assert.match(html, /"root":"\/tmp\/discovered","label":"Discovered"/);
});

test("renderHtml includes the global split-worktrees toggle", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /id="split-worktrees-button"/);
  assert.match(html, /Split Worktrees/);
});

test("renderHtml exposes an accessible independently scrollable sessions region", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /<aside id="session-panel" class="panel sessions-panel" aria-labelledby="sessions-panel-title">/);
  assert.match(html, /<h2 id="sessions-panel-title">Sessions<\/h2>/);
  assert.match(html, /id="session-list" class="panel-body session-list" role="list" tabindex="0" aria-describedby="rooms-path"/);
});

test("sessions list keeps status, actions, wrapping, focus, scrolling, and responsive layout explicit", () => {
  const uiSource = readRuntimeSource("ui-source.ts");
  const attentionSource = readRuntimeSource("attention-panel-source.ts");
  const stylesSource = readClientSource("styles.css");

  assert.ok(uiSource.includes("function sessionCardState(agent) {"));
  assert.ok(uiSource.includes("function renderSessionHierarchy(projects, entries, renderEntry) {"));
  assert.ok(uiSource.includes("function sessionHierarchySummary(projects) {"));
  assert.ok(uiSource.includes('return { key: "needs-you", label: "Needs you" };'));
  assert.ok(uiSource.includes("return Boolean(agent && isBusyAgent(agent));"));
  assert.ok(uiSource.includes('class="session-card" role="listitem" tabindex="0"'));
  assert.ok(uiSource.includes('data-session-key="\\${escapeHtml(sessionKey)}"'));
  assert.ok(uiSource.includes('class="card-actions session-card-actions" aria-label="Session actions"'));
  assert.ok(uiSource.includes('class="session-group session-group-\\${key}" role="group" aria-labelledby="\\${titleId}"'));
  assert.ok(uiSource.includes('class="session-group-items" role="list"'));
  assert.ok(uiSource.includes('aria-label="Needs You, \\${escapeHtml(String(needsYou.length))} sessions"'));
  assert.ok(uiSource.includes('.slice(0, SESSION_RECENT_LEAD_LIMIT);'));
  assert.match(
    uiSource,
    /return needsYouHtml\n\s+\+ renderSessionGroup\("Active", "active", active, renderEntry\)\n\s+\+ renderSessionGroup\("Recent", "recent", recent, renderEntry\);/
  );
  assert.ok(uiSource.includes("sessionHierarchySummary(sessions)"));
  assert.ok(uiSource.includes("sessionHierarchySummary([sessionSnapshot || snapshot])"));
  assert.ok(uiSource.includes("preserveScroll: true, preserveFocus: true"));
  assert.ok(attentionSource.includes('class="needs-you-list" role="list"'));
  assert.ok(attentionSource.includes('class="needs-you-item" role="listitem" data-session-key='));
  assert.ok(stylesSource.includes(".sessions-panel {"));
  assert.ok(stylesSource.includes("max-height: calc(100vh - 24px);"));
  assert.ok(stylesSource.includes(".session-list:focus-visible {"));
  assert.ok(stylesSource.includes("overflow-y: auto;"));
  assert.ok(stylesSource.includes("scrollbar-gutter: stable;"));
  assert.ok(stylesSource.includes(".session-card:focus-visible {"));
  assert.ok(stylesSource.includes("-webkit-line-clamp: 2;"));
  assert.ok(stylesSource.includes(".session-group-header {"));
  assert.ok(stylesSource.includes(".session-group-items {"));
  assert.ok(stylesSource.includes(".session-group-needs {"));
  assert.ok(stylesSource.includes("position: sticky;"));
  assert.ok(stylesSource.includes("overscroll-behavior-y: auto;"));
  assert.ok(stylesSource.includes("@media (max-width: 860px) {"));
});

test("renderHtml includes explicit shared-room save and clear controls", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /id="multiplayer-save-button"/);
  assert.match(html, /id="multiplayer-clear-button"/);
});

test("renderHtml includes the image-only hat picker controls", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /id="hat-prev-button"/);
  assert.match(html, /id="hat-preview"/);
  assert.match(html, /id="hat-next-button"/);
});

test("z-order audit html exposes the visual workstation overlap harness", () => {
  const html = renderZOrderAuditHtml();

  assert.match(html, /Z-Order Audit/);
  assert.match(html, /Motion Sweep/);
  assert.match(html, /Front Edge/);
  assert.match(html, /data-sweep/);
  assert.match(html, /requestAnimationFrame\(tick\);/);
  assert.match(html, /avatar stays behind workstation/);
  assert.match(html, /same <code>sceneFootDepth\(\)<\/code> math as the app/);
  assert.match(html, /Pixi still sorts by <code>zIndex<\/code>/);
  assert.match(html, /\/z-order-audit/);
});

test("scene effects audit html mocks approval and input waits through the normal client bundle", () => {
  const html = renderSceneEffectsAuditHtml();

  assert.match(html, /Scene Effects Audit/);
  assert.match(html, /mocked typed Codex approval\/input fleet data/);
  assert.match(html, /audit-thread-approval-command/);
  assert.match(html, /audit-request-input/);
  assert.match(html, /Ready to dry-run publish once you approve the command\./);
  assert.match(html, /I need launch mode, a note, and the deploy token to proceed\./);
  assert.match(html, /window\.fetch = \(input, init = undefined\)/);
  assert.match(html, /window\.EventSource = MockEventSource/);
  assert.match(html, /\/client\/app\.js\?v=/);
});

test("wide office audit spawns many fake avatars for horizontal scroll validation", () => {
  const html = renderWideOfficeAuditHtml();

  assert.match(html, /Wide Office Scroll Audit/);
  assert.match(html, /32 synthetic active local avatars/);
  assert.match(html, /audit-wide-avatar-01/);
  assert.match(html, /audit-wide-avatar-32/);
  assert.match(html, /window\.fetch = \(input, init = undefined\)/);
  assert.match(html, /window\.EventSource = MockEventSource/);
  assert.match(html, /\/client\/app\.js\?v=/);
});

test("layout audit injects all synthetic scenarios before the normal client bundle", () => {
  const html = renderLayoutAuditHtml();
  const mockIndex = html.indexOf("window.EventSource = MockEventSource");
  const appIndex = html.indexOf('<script src="/client/app.js?v=');

  assert.match(html, /Workstation Layout Audit/);
  assert.match(html, /Layout A · 6 Bosses/);
  assert.match(html, /Layout B · 2 Bosses \+ Desks/);
  assert.match(html, /Layout C · Desks Only/);
  assert.match(html, /Layout E · Big Team/);
  assert.match(html, /Layout D · Quiet Floor/);
  assert.match(html, /const mockFleet = /);
  assert.ok(mockIndex >= 0 && appIndex > mockIndex, "the synthetic fleet must be installed before app.js starts");
});

test("client build assembles the runtime in memory without eval or a tracked generated module", () => {
  const buildSource = readFileSync(join(__dirname, "../scripts/build-client.mjs"), "utf8");
  const generatorSource = readFileSync(join(__dirname, "../scripts/generate-runtime-module.mjs"), "utf8");

  assert.match(buildSource, /const runtimeModuleSource = await generateRuntimeModuleSource\(\);/);
  assert.match(buildSource, /stdin: \{/);
  assert.match(buildSource, /startClientApp\(\);/);
  assert.doesNotMatch(buildSource, /entryPoints:/);
  assert.doesNotMatch(generatorSource, /\bFunction\(/);
  assert.match(generatorSource, /ts\.createSourceFile/);
  assert.doesNotMatch(generatorSource, /writeFile/);
  assert.match(generatorSource, /export async function generateRuntimeModuleSource\(\)/);
});

test("client runtime keeps current local desk-live work on a workstation through notLoaded transport gaps", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.doesNotMatch(layoutSource, /const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;/);
  assert.doesNotMatch(layoutSource, /return agent\.isOngoing === true \|\| hasCurrentLocalDeskGrace\(agent\);/);
  assert.match(
    seatingSource,
    /const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;/
  );
  assert.match(
    seatingSource,
    /const QUIET_LIVE_LOCAL_WORKSTATION_GRACE_MS = 3 \* 60 \* 1000;/
  );
  assert.match(
    seatingSource,
    /function hasCurrentLocalDeskGrace\(agent, maxAgeMs = CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent && agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /if \(agent\.statusText === "notLoaded"\) {\n\s+if \(agent\.state === "done"\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /return agent\.isOngoing === true\n\s+\|\| \(\n\s+agent\.isCurrent === true\n\s+&& Number\.isFinite\(updatedAt\)\n\s+&& Date\.now\(\) - updatedAt <= Math\.max\(workstationDoneGraceMs\(agent\), QUIET_LIVE_LOCAL_WORKSTATION_GRACE_MS\)\n\s+\);/
  );
  assert.match(
    seatingSource,
    /return agent\.isOngoing === true\n\s+\|\| agent\.isCurrent === true\n\s+\|\| hasCurrentLocalDeskGrace\(agent, QUIET_LIVE_LOCAL_WORKSTATION_GRACE_MS\);/
  );
});

test("client runtime keeps active local desks live, keeps waiting on-desk, and gives current idle/done work a short settle window", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.doesNotMatch(layoutSource, /if \(agent\.state === "waiting"\) {\n\s+return false;\n\s+}/);
  assert.match(
    layoutSource,
    /function isDeskLiveLocalState\(state\) {\n\s+return \[\n(?:.*\n)*?\s+"waiting",\n\s+"blocked"\n\s+\]\.includes\(String\(state \|\| ""\)\.toLowerCase\(\)\);/
  );
  assert.doesNotMatch(seatingSource, /if \(agent\.state === "waiting"\) {\n\s+return false;\n\s+}/);
  assert.match(
    seatingSource,
    /function hasCurrentLocalSeatCooldown\(agent\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent && agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /if \(agent\.statusText === "active"\) {\n\s+if \(isRuntimeActiveLocalAgent\(agent\)\) {\n\s+return true;\n\s+}\n\s+if \(\(agent\.state === "idle" \|\| agent\.state === "done"\) && hasCurrentLocalSeatCooldown\(agent\)\) {\n\s+return true;\n\s+}\n\s+return agent\.isCurrent === true\n\s+&& agent\.state !== "idle"\n\s+&& agent\.state !== "done";/
  );
  assert.match(
    seatingSource,
    /if \(agent\.isOngoing === true\) {\n\s+return true;\n\s+}\n\s+if \(agent\.isCurrent === true\) {\n\s+return true;\n\s+}\n\s+if \(agent\.state === "done"\) {\n\s+return agent\.isCurrent === true;\n\s+}/
  );
});

test("client runtime seats current local workload even when its latest item summarizes idle", () => {
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.match(
    seatingSource,
    /if \(agent\.isOngoing === true\) {\n\s+return true;\n\s+}\n\s+if \(agent\.isCurrent === true\) {\n\s+return true;\n\s+}\n\s+if \(agent\.state === "done"\) {/
  );
  assert.match(
    seatingSource,
    /function isFinishedLeadForRec\(agent\) \{[\s\S]*return isRecentLeadCandidate\(agent\)\n\s+&& agent\.isCurrent !== true\n\s+&& agent\.isOngoing !== true/
  );
});

test("client runtime seats ongoing non-local agents at workstations", () => {
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.match(
    seatingSource,
    /return agent\.isOngoing === true \|\| agent\.isCurrent === true;/
  );
});

test("multiplayer merge cools stale remote ongoing agents before seating", () => {
  const multiplayerSource = readClientSource("multiplayer-source.ts");

  assert.match(
    multiplayerSource,
    /function isStaleSharedOngoingAgent\(agent\) \{[\s\S]*agent\.isOngoing !== true[\s\S]*return !isFreshSharedTimestamp\(agent\.updatedAt\);/
  );
  assert.match(
    multiplayerSource,
    /const staleOngoing = isStaleSharedOngoingAgent\(agent\);[\s\S]*isCurrent: staleOngoing \? false : agent\.isCurrent,[\s\S]*isOngoing: staleOngoing \? false : agent\.isOngoing,[\s\S]*state: staleOngoing \? "idle" : agent\.state,[\s\S]*activityEvent: !staleOngoing && agent\.activityEvent[\s\S]*needsUser: null,/
  );
  assert.match(
    multiplayerSource,
    /function isActiveSharedAgent\(agent\) \{[\s\S]*if \(isStaleSharedOngoingAgent\(agent\)\) \{[\s\S]*return false;[\s\S]*if \(agent\.isCurrent === true \|\| agent\.needsUser\)/
  );
});

test("client runtime active counters group subagents under their lead session", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");

  assert.ok(layoutSource.includes("const countedFamilies = new Map();"));
  assert.ok(layoutSource.includes("const live = !cloud && isLiveSceneAgent(agent);"));
  assert.ok(layoutSource.includes("while ("));
  assert.ok(layoutSource.includes("familyAgent.parentThreadId"));
  assert.ok(layoutSource.includes("const familyKey = familyAgent.id || agent.id;"));
  assert.ok(layoutSource.includes("for (const family of countedFamilies.values())"));
  assert.match(
    layoutSource,
    /if \(family\.active\) counters\.active \+= 1;\n\s+if \(family\.blocked\) counters\.blocked \+= 1;\n\s+if \(family\.waiting\) counters\.waiting \+= 1;/
  );
});

test("client runtime does not keep stale active local subagents busy forever", () => {
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.match(seatingSource, /const ACTIVE_SUBAGENT_WORKSTATION_WINDOW_MS = 20 \* 60 \* 1000;/);
  assert.match(
    seatingSource,
    /function isStaleRuntimeActiveSubagent\(agent\) \{[\s\S]*agent\.source !== "local"[\s\S]*!agent\.parentThreadId[\s\S]*agent\.statusText !== "active"[\s\S]*agent\.needsUser !== null[\s\S]*Date\.now\(\) - updatedAt > ACTIVE_SUBAGENT_WORKSTATION_WINDOW_MS;/
  );
  assert.match(
    seatingSource,
    /function isRuntimeActiveLocalAgent\(agent\) \{[\s\S]*agent\.statusText === "active"\n\s+&& !isTerminalRuntimeLocalAgent\(agent\)\n\s+&& !isStaleRuntimeActiveSubagent\(agent\);/
  );
});

test("client runtime gives finished subagents a longer workstation cooldown than leads", () => {
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.match(seatingSource, /const TOP_LEVEL_DONE_WORKSTATION_GRACE_MS = 3000;/);
  assert.match(seatingSource, /const SUBAGENT_DONE_WORKSTATION_GRACE_MS = 7000;/);
  assert.match(
    seatingSource,
    /return agent && agent\.parentThreadId\s+\? SUBAGENT_DONE_WORKSTATION_GRACE_MS\s+\: TOP_LEVEL_DONE_WORKSTATION_GRACE_MS;/
  );
});

test("client runtime renders each subagent depth at 75 percent of its parent depth", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneSource = readSceneRuntime();

  assert.ok(layoutSource.includes("const rawDepth = Number(agent && agent.depth);"));
  assert.ok(layoutSource.includes("const nestedDepth = Number.isFinite(rawDepth)"));
  assert.ok(layoutSource.includes("return normalizedBaseScale * Math.pow(0.75, nestedDepth);"));
  assert.ok(renderSource.includes("const avatarSize = avatarVisualSizeForAgent(agent, compact ? 1.06 : 1.28);"));
  assert.ok(renderSource.includes("const avatarSize = agent ? avatarVisualSizeForAgent(agent, compact ? 1.06 : 1.28) : null;"));
  assert.ok(sceneSource.includes("const avatarSize = avatarVisualSizeForAgent(agent, compact ? 1 : 1.08);"));
  assert.doesNotMatch(sceneSource, /avatarForAgent\(agent\)\.[wh] \* \(compact \? 1 : 1\.08\)/);
});

test("scene effects audit includes nested subagents for recursive visibility checks", () => {
  const html = renderSceneEffectsAuditHtml();

  assert.ok(html.includes('"id":"audit-nested-lead"'));
  assert.ok(html.includes('"id":"audit-nested-child-b"'));
  assert.ok(html.includes('"parentThreadId":"audit-nested-child-b"'));
  assert.ok(html.includes('"id":"audit-nested-great-grandchild"'));
  assert.ok(html.includes('"depth":3'));
});

test("client runtime only keeps ordinary local desks for current workload", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.match(seatingSource, /if \(agent\.isCurrent !== true\) {\n\s+return false;/);
  assert.doesNotMatch(layoutSource, /if \(agent\.isCurrent !== true\) {\n\s+return false;/);
  assert.doesNotMatch(seatingSource, /const recentlyLive = Number\.isFinite\(updatedAt\)/);
});

test("runtime source keeps desk seats stable when a second workstation appears in a pod", () => {
  const sceneSource = readSceneRuntime();

  assert.ok(sceneSource.includes("const tile = sceneTileSize(compact);"));
  assert.ok(sceneSource.includes("const leftCellX = 0;"));
  assert.ok(sceneSource.includes("const rightCellX = Math.max(0, entry.slot.width - cellWidth);"));
  assert.ok(sceneSource.includes("const seatMirrored = hasBothSides"));
  assert.ok(sceneSource.includes("const cellX = seatMirrored ? rightCellX : leftCellX;"));
  assert.ok(sceneSource.includes("mirrored: seatMirrored,"));
});

test("runtime source keeps running and validating workers seated at their workstation", () => {
  const renderSource = readRuntimeSource("render-source.ts");

  assert.ok(renderSource.includes('if (state === "running" || state === "validating") {'));
  assert.ok(renderSource.includes('if (state === "blocked") {'));
  assert.ok(renderSource.includes('state === "delegating" || state === "waiting"'));
  assert.ok(renderSource.includes("tileHeight: 2"));
});

test("runtime source adds above-head state markers for needs-user, thinking, planning, and blocked-error states", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes('function stateMarkerIconUrlForAgent(agent) {'));
  assert.ok(renderSource.includes('function shouldShowThinkingMarker(agent) {'));
  assert.ok(renderSource.includes('agent.activityEvent && agent.activityEvent.type === "agentMessage"'));
  assert.ok(renderSource.includes('agent.latestMessage.trim().length > 0'));
  assert.ok(renderSource.includes('return "/assets/pixel-office/sprites/icons/state/hand.png";'));
  assert.ok(renderSource.includes('return "/assets/pixel-office/sprites/icons/state/exclamation.png";'));
  assert.ok(renderSource.includes('return "/assets/pixel-office/sprites/icons/state/clipboard.png";'));
  assert.ok(renderSource.includes('return "/assets/pixel-office/sprites/icons/state/light.png";'));
  assert.ok(navigationSource.includes("const STATE_MARKER_SIZE = 11;"));
  assert.ok(navigationSource.includes("const STATE_MARKER_BUBBLE_Y_OFFSET = 20;"));
  assert.ok(sceneSource.includes("Math.max(8, Math.round(entry.statusMarker.width || 11))"));
  assert.ok(navigationSource.includes("const statusMarkerUrl = agent.statusMarkerIconUrl || stateMarkerIconUrlForAgent(agent);"));
  assert.ok(sceneSource.includes("statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),"));
  assert.ok(sceneSource.includes("statusMarkerIconUrl: stateMarkerIconUrlForAgent(entry.agent),"));
});

test("runtime source adds transient turn-phase badges for started, completed, interrupted, and failed turns", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes("const TURN_SIGNAL_MAX_AGE_MS = 6000;"));
  assert.ok(renderSource.includes("function recentTurnSignalForAgent(snapshot, agent) {"));
  assert.ok(renderSource.includes('return "START";'));
  assert.ok(renderSource.includes('return "DONE";'));
  assert.ok(renderSource.includes('return "STOP";'));
  assert.ok(renderSource.includes('return "FAIL";'));
  assert.ok(sceneSource.includes("turnSignal: recentTurnSignalForAgent(snapshot, agent),"));
  assert.ok(sceneSource.includes("turnSignal: recentTurnSignalForAgent(snapshot, entry.agent),"));
  assert.ok(navigationSource.includes("const TURN_SIGNAL_PADDING_X = 4;"));
  assert.ok(navigationSource.includes("function turnSignalPalette(signal) {"));
  assert.ok(navigationSource.includes("function syncTurnSignalNode(motionState, turnSignal, liftPx = 0) {"));
  assert.ok(navigationSource.includes('kind: "turn-signal",'));
  assert.ok(sceneSource.includes('if (entry.kind === "turn-signal") {'));
});

test("runtime source keeps typed plan, command, file, and tool events out of mock activity cues", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes("const ACTIVITY_CUE_MAX_AGE_MS = 4800;"));
  assert.ok(renderSource.includes("function activityCueForEvent(event) {"));
  assert.doesNotMatch(renderSource, /return \{ mode: "plan", label: "PLAN" \};/);
  assert.doesNotMatch(renderSource, /return \{ mode: "command", label: "RUN" \};/);
  assert.doesNotMatch(renderSource, /return \{ mode: "file", label: "EDIT" \};/);
  assert.doesNotMatch(renderSource, /return \{ mode: "tool", label: "TOOL" \};/);
  assert.ok(renderSource.includes("function recentActivityCueForAgent(snapshot, agent) {"));
  assert.ok(sceneSource.includes("activityCue: recentActivityCueForAgent(snapshot, agent),"));
  assert.ok(sceneSource.includes("activityCue: recentActivityCueForAgent(snapshot, entry.agent),"));
  assert.ok(navigationSource.includes("function activityCuePalette(cue) {"));
  assert.ok(navigationSource.includes("function buildActivityCueAdornment(mode, palette) {"));
  assert.ok(navigationSource.includes('return cue.mode === "plan"'));
  assert.ok(navigationSource.includes("function syncActivityCueNode(motionState, activityCue, driftX = 0, driftY = 0) {"));
  assert.ok(navigationSource.includes('kind: "activity-cue",'));
  assert.ok(sceneSource.includes('if (entry.kind === "activity-cue") {'));
});

test("runtime source renders a scene-native office wall dashboard from snapshot activity", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const stylesSource = readClientSource("styles.css");
  const servedStyles = readClientSource("styles.css");

  assert.ok(renderSource.includes("function activityWallSnapshot(snapshot)"));
  assert.ok(renderSource.includes("entry.branches.join(\", \")"));
  assert.ok(renderSource.includes("entry.users.join(\", \")"));
  assert.ok(sceneSource.includes("function officeWallDecayedHeat(snapshot, entry)"));
  assert.ok(sceneSource.includes("const OFFICE_WALL_HEAT_HALF_LIFE_MS = 3 * 60 * 1000;"));
  assert.ok(sceneSource.includes("function buildOfficeWallDashboardData(snapshot"));
  assert.ok(sceneSource.includes("const activity = activityWallSnapshot(snapshot);"));
  assert.ok(sceneSource.includes('const columns = ["script", "doc", "media"];'));
  assert.ok(sceneSource.includes('kind: "file",'));
  assert.ok(sceneSource.includes("tone: column,"));
  assert.ok(sceneSource.includes("displayPath: activityWallPath(snapshot, entry.path),"));
  assert.ok(sceneSource.includes("branch: entry.branch || null,"));
  assert.ok(sceneSource.includes("branches: Array.isArray(entry.branches) ? entry.branches : [],"));
  assert.ok(sceneSource.includes("users: Array.isArray(entry.users) ? entry.users : [],"));
  assert.ok(sceneSource.includes("heat: officeWallDecayedHeat(snapshot, entry),"));
  assert.ok(sceneSource.includes("generatedAtMs: officeWallGeneratedAtMs(snapshot),"));
  assert.ok(sceneSource.includes('title: "Hot",'));
  assert.ok(sceneSource.includes("hotGrid: data.hotGrid.map((row) => ({"));
  assert.ok(sceneSource.includes("function buildOfficeWallDashboardModel(snapshot, room"));
  assert.ok(sceneSource.includes("wallDashboards: [],"));
  assert.ok(sceneSource.includes("model.wallDashboards.push(wallDashboard);"));
  assert.ok(sceneSource.includes("function officeWallDashboardSceneToken(snapshot)"));
  assert.ok(navigationSource.includes("function addWallDashboardNode(dashboard)"));
  assert.ok(navigationSource.includes("(model.wallDashboards || []).forEach((dashboard) =>"));
  assert.ok(navigationSource.includes("function renderWallDashboardHotHover(row)"));
  assert.ok(renderSource.includes('class="agent-hover-worktree"'));
  assert.ok(navigationSource.includes('data-wall-hot-meta'));
  assert.ok(navigationSource.includes("function collectReusableOfficeOverlayNodes(layer, selector, datasetKey)"));
  assert.ok(navigationSource.includes("function ensureOfficeMapHoverLayer()"));
  assert.ok(navigationSource.includes("function setOfficeMapHoverHtml(node, html, kind)"));
  assert.ok(navigationSource.includes("function setOfficeOverlayHtml(node, html)"));
  assert.ok(navigationSource.includes("function syncAgentOverlayNode(node, anchor, scale)"));
  assert.ok(navigationSource.includes("function syncWorkstationOverlayNode(node, anchor, scale)"));
  assert.ok(navigationSource.includes("function syncFurnitureOverlayNode(node, item, model, scale)"));
  assert.ok(navigationSource.includes("function syncOfficeWallDashboardHeat()"));
  assert.ok(navigationSource.includes("function syncWallDashboardHotNode(node, dashboard, row, itemIndex, scale, layout)"));
  assert.ok(navigationSource.includes('const reusableAgentNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-agent-hit", "agentKey");'));
  assert.ok(navigationSource.includes('const reusableWorkstationNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-anchor", "workstationKey");'));
  assert.ok(navigationSource.includes('const reusableFurnitureNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-furniture-hit", "furnitureId");'));
  assert.ok(navigationSource.includes('const reusableHotNodes = collectReusableOfficeOverlayNodes(layer, ".office-map-wall-hot-hit", "wallHotKey");'));
  assert.ok(navigationSource.includes("let node = reusableAgentNodes.get(anchor.key);"));
  assert.ok(navigationSource.includes("setOfficeOverlayHtml(node, triggerHtml);"));
  assert.ok(navigationSource.includes('setOfficeMapHoverHtml(node, anchor.hoverHtml || "", "agent");'));
  assert.ok(navigationSource.includes('setOfficeMapHoverHtml(node, renderWallDashboardHotHover(row), "hot");'));
  assert.ok(stylesSource.includes(".office-map-hover-layer {"));
  assert.ok(stylesSource.includes("position: fixed;"));
  assert.ok(servedStyles.includes(".office-map-hover-layer {"));
  assert.ok(navigationSource.includes("const gridInset = 3;"));
  assert.ok(navigationSource.includes("const columnGap = 3;"));
  assert.ok(navigationSource.includes("const contentWidth = Math.max(24, width - gridInset * 2);"));
  assert.ok(navigationSource.includes("const rowStep = 8;"));
  assert.ok(navigationSource.includes("row.displayPath || row.path"));
  assert.ok(navigationSource.includes('node.className = "office-map-wall-hot-hit";'));
  assert.ok(navigationSource.includes("node.dataset.wallHotKey = wallDashboardHotNodeKey(dashboard, row, itemIndex);"));
  assert.doesNotMatch(navigationSource, /function syncOfficeAnchors[\s\S]*?layer\.innerHTML = "";/);
  assert.ok(navigationSource.includes('node.dataset.wallHotGeneratedAt = String(Number(row.generatedAtMs || dashboard.generatedAtMs) || 0);'));
  assert.ok(navigationSource.includes('node.dataset.wallHotUsers = Array.isArray(row.users) ? row.users.join(",") : "";'));
  assert.ok(navigationSource.includes('data-wall-hot-heat-fill'));
  assert.ok(navigationSource.includes('if (tone === "script") {'));
  assert.ok(navigationSource.includes('if (tone === "doc") {'));
  assert.ok(navigationSource.includes('if (tone === "media") {'));
  assert.ok(navigationSource.includes("function wallDashboardHeatPalette(row, fallback)"));
  assert.ok(navigationSource.includes("Number.isFinite(row.heat)"));
  assert.ok(navigationSource.includes("dashboardTooltip.zIndex = 21000;"));
  assert.ok(navigationSource.includes("renderer.root.addChild(dashboardTooltip);"));
  assert.ok(navigationSource.includes('rowContainer.eventMode = "none";'));
  assert.ok(navigationSource.includes("const heatTrack = new PIXI.Graphics()"));
  assert.ok(navigationSource.includes("const heatFill = new PIXI.Graphics()"));
  assert.ok(navigationSource.includes("renderer.root.toLocal(event.global)"));
  assert.ok(navigationSource.includes("const textInset = 2;"));
  assert.ok(navigationSource.includes("rowText.x = cellX + textInset;"));
  assert.ok(navigationSource.includes("rowText.width > maskedTextWidth"));
  assert.ok(uiSource.includes("window.setInterval(() => {"));
  assert.ok(uiSource.includes("syncOfficeWallDashboardHeat();"));
  assert.ok(uiSource.includes("}, 1000);"));
  assert.ok(stylesSource.includes(".office-map-wall-hot-hit .office-wall-hot-hover"));
  assert.ok(stylesSource.includes("left: 0;"));
  assert.ok(stylesSource.includes("bottom: calc(100% + 26px);"));
  assert.ok(stylesSource.includes("width: min(460px, calc(100vw - 24px));"));
  assert.ok(stylesSource.includes("font-size: calc(20px * var(--ui-text-scale));"));
  assert.ok(stylesSource.includes("box-shadow: 2px 2px 0 rgba(0,0,0,0.28);"));
  assert.ok(stylesSource.includes("transform: translate(0, 4px);"));
  assert.ok(stylesSource.includes(".office-wall-hot-heat-track"));
  assert.ok(servedStyles.includes(".office-map-wall-hot-hit .office-wall-hot-hover"));
  assert.ok(servedStyles.includes("left: 0;"));
  assert.ok(servedStyles.includes("bottom: calc(100% + 26px);"));
  assert.ok(servedStyles.includes("width: min(460px, calc(100vw - 24px));"));
  assert.ok(servedStyles.includes("transform: translate(0, 4px);"));
  assert.ok(navigationSource.includes('typeof officeWallDashboardSceneToken === "function" ? officeWallDashboardSceneToken(snapshot) : ""'));
});

test("runtime source rerenders dragged furniture immediately without per-move storage writes", () => {
  const settingsSource = readRuntimeSource("settings-source.ts");
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.ok(settingsSource.includes("function furnitureLayoutOverrideToken(projectRoot)"));
  assert.ok(settingsSource.includes("if (options.persist !== false)"));
  assert.ok(navigationSource.includes("furnitureLayoutOverrideToken(snapshot.projectRoot),"));
  assert.ok(navigationSource.includes("function furnitureDragRendererForTarget(target, host)"));
  assert.ok(navigationSource.includes("const snapshot = latestOfficeMapProjects.find((project) => project && project.projectRoot === projectRoot);"));
  assert.ok(navigationSource.includes("setFurnitureColumnOverride(furnitureDragState.projectRoot, furnitureDragState.item.roomId, furnitureDragState.item.id, nextColumn, { persist: false });"));
  assert.ok(navigationSource.includes("if (furnitureDragState.dirty)"));
  assert.ok(navigationSource.includes("saveFurnitureLayoutOverrides();"));
  assert.ok(uiSource.includes("const renderer = furnitureDragRendererForTarget(target, host);"));
  assert.ok(uiSource.includes("dirty: false,"));
});

test("runtime source maps approval waits, input waits, and resolved requests into transient lifecycle cues", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes('return { mode: "approval", label: "WAIT" };'));
  assert.ok(renderSource.includes('return { mode: "input", label: "ASK" };'));
  assert.ok(renderSource.includes('return { mode: "resolved", label: "OK" };'));
  assert.ok(navigationSource.includes('if (cue.mode === "approval" || cue.mode === "input") {'));
  assert.ok(navigationSource.includes('if (cue.mode === "resolved") {'));
  assert.ok(sceneSource.includes('entry.mode === "approval" ? Math.round(Math.sin((now + entry.phase) / 150) * 1.4)'));
  assert.ok(sceneSource.includes('entry.mode === "input" ? -Math.round(progress * 3 + Math.sin((now + entry.phase) / 130) * 1.4)'));
  assert.ok(sceneSource.includes('entry.mode === "resolved" ? -Math.round(progress * 7 + Math.sin((now + entry.phase) / 150) * 1.2)'));
});

test("request lifecycle cues include mode-specific icon adornments and icon-side animation", () => {
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(navigationSource.includes("const ACTIVITY_CUE_ICON_WIDTH = 8;"));
  assert.ok(navigationSource.includes("const ACTIVITY_CUE_ICON_GAP = 3;"));
  assert.ok(navigationSource.includes("function activityCueFrameRadius(mode) {"));
  assert.ok(navigationSource.includes('} else if (mode === "approval") {'));
  assert.ok(navigationSource.includes('} else if (mode === "input") {'));
  assert.ok(navigationSource.includes('} else if (mode === "resolved") {'));
  assert.ok(navigationSource.includes("activityCueContainer.addChild(adornment.iconContainer);"));
  assert.ok(navigationSource.includes("iconContainer,"));
  assert.ok(sceneSource.includes('if (cueIcon && entry.mode === "approval") {'));
  assert.ok(sceneSource.includes('} else if (cueIcon && entry.mode === "input") {'));
  assert.ok(sceneSource.includes('} else if (cueIcon && entry.mode === "resolved") {'));
});

test("recent workstation request activity also creates non-text desk effects beyond the floating cue chip", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes("function requestCueProfileForAgent(agent, cue, event = null) {"));
  assert.ok(renderSource.includes("requestProfile: requestCueProfileForAgent(agent, cue, event),"));
  assert.ok(renderSource.includes("decisionCount,"));
  assert.ok(renderSource.includes("approvalType"));
  assert.ok(renderSource.includes("questionCount: Math.max(1, Math.min(4, questions.length || 1))"));
  assert.ok(renderSource.includes("requiredCount: Math.max(0, Math.min(4, requiredCount))"));
  assert.ok(renderSource.includes("function buildWorkstationCueEffect(cue, absoluteCellX, absoluteCellY, workstationX, workstationY, workstationWidth, workstationHeight, workstationSortRow, workstationSortFootY, options = {}) {"));
  assert.ok(renderSource.includes('kind: "cue-effect",'));
  assert.ok(renderSource.includes("requestProfile: cue.requestProfile || null,"));
  assert.ok(renderSource.includes("const workstationCueEffect = buildWorkstationCueEffect("));
  assert.ok(renderSource.includes("shell.push(workstationCueEffect);"));
  assert.ok(navigationSource.includes("function buildWorkstationCueEffectNode(effect) {"));
  assert.ok(navigationSource.includes("const requestProfile = effect && effect.requestProfile && typeof effect.requestProfile === \"object\""));
  assert.ok(navigationSource.includes("const decisionCount = Math.max(2, Math.min(4, Number(requestProfile && requestProfile.decisionCount) || 3));"));
  assert.ok(navigationSource.includes("const questionCount = Math.max(1, Math.min(4, Number(requestProfile && requestProfile.questionCount) || 3));"));
  assert.ok(navigationSource.includes("detailNodes,"));
  assert.ok(navigationSource.includes('if (item.kind === "cue-effect") {'));
  assert.ok(navigationSource.includes('kind: "workstation-cue-effect",'));
  assert.ok(sceneSource.includes('if (entry.kind === "workstation-cue-effect") {'));
  assert.ok(sceneSource.includes("const approvalProfile = entry.requestProfile && typeof entry.requestProfile === \"object\""));
  assert.ok(sceneSource.includes("const inputProfile = entry.requestProfile && typeof entry.requestProfile === \"object\""));
  assert.ok(sceneSource.includes("index < requiredCount"));
  assert.ok(sceneSource.includes('entry.mode === "resolved") {'));
});

test("runtime source lets scene-agent clicks open a stable thread history card", () => {
  const settingsSource = readRuntimeSource("settings-source.ts");
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const stylesSource = readClientSource("styles.css");

  assert.ok(settingsSource.includes("openAgentThread: null,"));
  assert.ok(settingsSource.includes("closingAgentThread: null,"));
  assert.ok(settingsSource.includes("replyThreadWorkIntents: {},"));
  assert.ok(settingsSource.includes("expandedThreadEntries: {},"));
  assert.ok(renderSource.includes("function recentThreadHistoryEntries(snapshot, agent) {"));
  assert.ok(renderSource.includes("function renderAgentThreadCard(snapshot, agent, options = {}) {"));
  assert.ok(renderSource.includes("function renderThreadHistoryEntry(snapshot, agent, entry) {"));
  assert.ok(renderSource.includes('["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall"].includes(agent.activityEvent.type)'));
  assert.ok(renderSource.includes('const isHermes = agent.source === "hermes" || agent.provenance === "hermes";'));
  assert.ok(renderSource.includes("if (title === latest || (!isHermes && title === detail)) {"));
  assert.ok(readClientSource("runtime/event-presentation.ts").includes("function threadEntryLooksLong(body: unknown)"));
  assert.ok(renderSource.includes('data-action="toggle-thread-entry"'));
  assert.ok(renderSource.includes('data-thread-entry-key='));
  assert.ok(renderSource.includes('key: ["latest", agent.threadId].join("::"),'));
  assert.ok(renderSource.includes('const cardClass = options.closing ? "office-map-thread-card is-closing" : "office-map-thread-card";'));
  assert.ok(renderSource.includes("Thread history"));
  assert.ok(!renderSource.includes("office-map-thread-composer"));
  assert.ok(!renderSource.includes("renderThreadResumeComposerForThread"));
  assert.ok(sceneSource.includes("threadPanel: null"));
  assert.ok(sceneSource.includes("function registerThreadPanel(agent) {"));
  assert.ok(sceneSource.includes("function openThreadStageOffset(agent) {"));
  assert.ok(sceneSource.includes("renderAgentThreadCard(snapshot, agent, { closing: panelState === \"closing\" })"));
  assert.ok(sceneSource.includes("const projectRoot = threadViewProjectRoot(snapshot, agent);"));
  assert.ok(sceneSource.includes("replyProjectRoot: threadViewProjectRoot(snapshot, agent) || \"\","));
  assert.ok(sceneSource.includes("replyProjectRoot: threadViewProjectRoot(snapshot, entry.agent) || \"\","));
  assert.ok(sceneSource.includes("threadOpen: Boolean(sceneThreadPanelState(agent))"));
  assert.ok(sceneSource.includes("hoverHtml: openThreadSuppressesHover ? \"\" : renderAgentHover(snapshot, agent)"));
  assert.ok(sceneSource.includes('data-office-map-thread-layer'));
  assert.ok(navigationSource.includes('class="office-map-agent-trigger" data-action="open-agent-thread"'));
  assert.ok(navigationSource.includes('classNames.push("is-thread-open");'));
  assert.ok(navigationSource.includes("renderer.threadLayer"));
  assert.ok(navigationSource.includes('className = "office-map-thread-panel-slot"'));
  assert.ok(navigationSource.includes("function syncThreadPanel(renderer, model) {"));
  assert.ok(navigationSource.includes("function syncThreadHistory(history, nextHistory) {"));
  assert.ok(navigationSource.includes("function threadHistoryAtBottom(history) {"));
  assert.ok(navigationSource.includes("fresh.classList.add(\"is-new\");"));
  assert.ok(navigationSource.includes("function officeSceneRenderToken(snapshot, options = {}) {"));
  assert.ok(navigationSource.includes("if (renderer.sceneRenderToken !== renderToken) {"));
  assert.ok(navigationSource.includes("syncOfficeAnchors(renderer, model, renderer.scale || 1);"));
  assert.ok(uiSource.includes("function openAgentThread(projectRoot, threadId) {"));
  assert.ok(uiSource.includes("state.openAgentThread.projectRoot === projectRoot"));
  assert.ok(uiSource.includes("render();\n          return;\n        }\n        state.openAgentThread = {"));
  assert.ok(uiSource.includes("state.openAgentThread = {\n          projectRoot,\n          threadId\n        };\n        render();"));
  assert.ok(uiSource.includes("function threadViewProjectRoot(snapshot, agent) {"));
  assert.ok(uiSource.includes("function findThreadViewEntry(projectRoot, threadId) {"));
  assert.ok(uiSource.includes('agent.sourceKind !== "appServer"'));
  assert.ok(uiSource.includes('if (agent.source === "hermes" || agent.provenance === "hermes") {'));
  assert.ok(uiSource.includes("return agent.sourceProjectRoot || snapshot.projectRoot;"));
  assert.ok(uiSource.includes("&& !findThreadViewEntry(state.openAgentThread.projectRoot, state.openAgentThread.threadId)"));
  assert.ok(uiSource.includes("function markReplyThreadWorkIntent(threadId"));
  assert.ok(uiSource.includes("function toggleThreadEntryExpanded(stateKey) {"));
  assert.ok(!uiSource.includes("renderThreadResumeComposerForThread"));
  assert.ok(!uiSource.includes('data-action="open-thread-resume"'));
  assert.ok(!uiSource.includes('data-action="copy-resume-command"'));
  assert.ok(!uiSource.includes("/api/thread/open-resume"));
  assert.ok(uiSource.includes("const THREAD_REPLY_TIMEOUT_MS = 90000;"));
  assert.ok(uiSource.includes("}, THREAD_REPLY_TIMEOUT_MS);"));
  assert.ok(uiSource.includes("if (action === \"open-agent-thread\" && target.dataset.projectRoot && target.dataset.threadId) {"));
  assert.ok(uiSource.includes("if (action === \"close-agent-thread\") {"));
  assert.ok(uiSource.includes("if (action === \"toggle-thread-entry\" && target.dataset.threadEntryStateKey) {"));
  assert.ok(uiSource.includes("event.key === \"Enter\""));
  assert.ok(uiSource.includes("&& !event.shiftKey"));
  assert.ok(uiSource.includes("void submitReplyComposer(event.target.dataset.replyProjectRoot, event.target.dataset.replyThreadId);"));
  assert.ok(uiSource.includes("if (event.key === \"Escape\" && state.openAgentThread) {"));
  assert.ok(stylesSource.includes(".office-map-thread-card {"));
  assert.ok(stylesSource.includes(".office-map-thread-layer {"));
  assert.ok(stylesSource.includes(".office-map-host.has-thread-panel .office-map-agent-hit:hover .agent-hover"));
  assert.ok(stylesSource.includes("@keyframes officeThreadPanelIn"));
  assert.ok(stylesSource.includes("@keyframes officeThreadPanelOut"));
  assert.ok(stylesSource.includes("@keyframes officeThreadMessageIn"));
  assert.ok(stylesSource.includes(".office-map-thread-body.is-collapsed {"));
  assert.ok(stylesSource.includes("-webkit-line-clamp: 8;"));
  assert.ok(stylesSource.includes(".office-map-thread-more {"));
  assert.ok(stylesSource.includes(".office-map-thread-icon {"));
  assert.ok(stylesSource.includes(".office-map-thread-window-bar {"));
  assert.ok(stylesSource.includes(".office-map-agent-trigger {"));
  assert.ok(stylesSource.includes(".office-map-thread-history {"));
});

test("client runtime does not rebuild the Pixi room scene for resize-only updates", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();

  assert.ok(navigationSource.includes("function syncOfficeRendererViewport(renderer, model) {"));
  assert.ok(navigationSource.includes("setPixelStyleIfChanged(renderer.host, \"height\", scaledHeight + \"px\");"));
  assert.ok(navigationSource.includes("if (renderer.renderWidth !== scaledWidth || renderer.renderHeight !== scaledHeight) {"));
  assert.ok(navigationSource.includes("renderer.app.renderer.resize(scaledWidth, scaledHeight);"));
  assert.ok(navigationSource.includes("const fitWidth = Math.max(1, Number(model.fitWidth) || model.width);"));
  assert.ok(navigationSource.includes("const scaledHeight = Math.max(1, Math.round(model.height * scale));"));
  assert.ok(navigationSource.includes("const maxScrollLeft = Math.max(0, scaledWidth - Math.max(1, renderer.host.clientWidth || availableWidth));"));
  assert.ok(navigationSource.includes("function commitOfficeRendererRoot(renderer, previousRoot, nextRoot) {"));
  assert.ok(navigationSource.includes("const previousRoot = renderer.root;"));
  assert.ok(navigationSource.includes("const nextRoot = new window.PIXI.Container();"));
  assert.ok(navigationSource.includes("commitOfficeRendererRoot(renderer, previousRoot, nextRoot);"));
  assert.doesNotMatch(navigationSource, /renderer\.root\.removeChildren\(\);/);
  assert.ok(navigationSource.includes("return false;"));
  assert.ok(navigationSource.includes("if (syncOfficeRendererScene(renderer, model)) {"));
  assert.ok(sceneSource.includes("if (!existing.root && existing.ready) {"));
  assert.ok(sceneSource.includes("await existing.ready;"));
  assert.ok(sceneSource.includes("renderer.resizeSyncQueued = true;"));
  assert.ok(sceneSource.includes("window.requestAnimationFrame(() => {"));
  assert.ok(sceneSource.includes("syncOfficeRendererViewport(renderer, renderer.model);"));
  assert.ok(sceneSource.includes("syncOfficeAnchors(renderer, renderer.model, renderer.scale || 1);"));
  assert.doesNotMatch(
    sceneSource,
    /resizeObserver = new ResizeObserver\(\(\) => \{[\s\S]*?syncOfficeRendererScene\(renderer, renderer\.model\);[\s\S]*?\}\);/
  );
});

test("client runtime tweens workstation furniture but routes grounded same-seat moves through navigation", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();

  assert.ok(navigationSource.includes("const WORKSTATION_LAYOUT_TWEEN_MS = 520;"));
  assert.ok(navigationSource.includes("const MAX_SEATED_NAVIGATION_DISTANCE_PX = 8;"));
  assert.ok(navigationSource.includes("const previousWorkstationLayoutStates = new Map(renderer.workstationLayoutStates || []);"));
  assert.ok(navigationSource.includes("function animateWorkstationLayoutNodes(kind, item, nodes) {"));
  assert.ok(navigationSource.includes('renderer.animatedSprites.push({\n            kind: "layout-shift",'));
  assert.ok(navigationSource.includes('animateWorkstationLayoutNodes("desk", desk, deskNodes);'));
  assert.ok(navigationSource.includes('animateWorkstationLayoutNodes("office", office, officeNodes);'));
  assert.ok(navigationSource.includes("function startSeatedNavigation(motionState, agent, room, nav, targetTile) {"));
  assert.ok(navigationSource.includes("{ x: motionState.currentX, y: motionState.currentY }"));
  assert.ok(navigationSource.includes("return Number.isFinite(distance) && distance <= MAX_SEATED_NAVIGATION_DISTANCE_PX;"));
  assert.ok(navigationSource.includes("if (!Number.isFinite(shiftDistance) || shiftDistance > MAX_SEATED_NAVIGATION_DISTANCE_PX) {"));
  assert.ok(navigationSource.includes("const seatedLayoutNavigating = startSeatedNavigation(previousState, agent, room, nav, targetTile);"));
  assert.ok(navigationSource.includes("if (autonomousResting || seatedLayoutNavigating) {"));
  assert.ok(sceneSource.includes('entry.kind !== "layout-shift"'));
  assert.ok(sceneSource.includes('if (entry.kind === "layout-shift") {'));
  assert.doesNotMatch(sceneSource, /entry\.seatShift/);
  assert.doesNotMatch(navigationSource, /motionState\.seatShift/);
  assert.ok(sceneSource.includes("workstationLayoutStates: new Map(),"));
});

test("client runtime keeps workspace floor order stable across activity refreshes", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(settingsSource.includes("const configuredProjectOrder = new Map(configuredProjects.map((project, index) => [project.root, index]));"));
  assert.ok(settingsSource.includes("const dynamicProjectOrder = new Map();"));
  assert.ok(layoutSource.includes("function projectDisplayOrderValue(project) {"));
  assert.ok(layoutSource.includes("function isClaudeCoworkProject(project) {"));
  assert.ok(layoutSource.includes('String(agent && agent.sourceKind || "").startsWith("claude:cowork")'));
  assert.ok(layoutSource.includes("if (configuredProjectOrder.has(root)) {"));
  assert.ok(layoutSource.includes("dynamicProjectOrder.set(root, nextDynamicProjectOrder);"));
  assert.match(
    layoutSource,
    /function visibleProjects\(fleet\) \{\n\s+const projects = \[\.\.\.\(Array\.isArray\(fleet && fleet\.projects\) \? fleet\.projects : \[\]\)\];\n\s+projects\.forEach\(\(project\) => projectDisplayOrderValue\(project\)\);\n\s+return projects\.sort\(\(left, right\) => \{/
  );
  assert.ok(layoutSource.includes("const sourceTierDelta = (isClaudeCoworkProject(left) ? 1 : 0) - (isClaudeCoworkProject(right) ? 1 : 0);"));
  assert.ok(layoutSource.includes("const orderDelta = projectDisplayOrderValue(left) - projectDisplayOrderValue(right);"));
});

test("client runtime clamps avatar walking delta after scene rebuilds", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();

  assert.ok(sceneSource.includes("const OFFICE_MOTION_DEFAULT_DELTA_MS = 16;"));
  assert.ok(sceneSource.includes("const OFFICE_MOTION_MAX_DELTA_MS = 50;"));
  assert.ok(sceneSource.includes("const OFFICE_MOTION_REBUILD_DELTA_CLAMP_MS = 120;"));
  assert.ok(sceneSource.includes("const OFFICE_MOTION_SAMPLE_LIMIT = 90;"));
  assert.ok(sceneSource.includes("function officeMotionFrameDeltaMs(renderer, now) {"));
  assert.ok(sceneSource.includes("function recordOfficeMotionSample(renderer, entry, mode, beforeX, beforeY, afterX, afterY, deltaMs, expectedSpeed) {"));
  assert.ok(sceneSource.includes("Math.min(rawDeltaMs, OFFICE_MOTION_MAX_DELTA_MS)"));
  assert.ok(sceneSource.includes("return Math.min(clampedDeltaMs, OFFICE_MOTION_DEFAULT_DELTA_MS);"));
  assert.ok(sceneSource.includes("const deltaMs = officeMotionFrameDeltaMs(renderer, now);"));
  assert.ok(sceneSource.includes("const motionBeforeX = Number(entry.currentX);"));
  assert.ok(sceneSource.includes('window.__agentsOfficeMotionSamples = samples;'));
  assert.ok(sceneSource.includes('console.warn("office avatar motion spike", sample);'));
  assert.ok(sceneSource.includes("motionDeltaClampUntil: 0,"));
  assert.ok(sceneSource.includes("motionDebugSamples: [],"));
  assert.ok(navigationSource.includes("renderer.motionDeltaClampUntil = performance.now() + OFFICE_MOTION_REBUILD_DELTA_CLAMP_MS;"));
  assert.match(
    navigationSource,
    /const seatedLayoutNavigating = startSeatedNavigation\(previousState, agent, room, nav, targetTile\);[\s\S]*?renderer\.motionStates\.set\(agentKey, previousState\);[\s\S]*?syncMotionStateVisualPosition\(previousState\);\n\s+return avatarVisual\.nodes;/
  );
  assert.match(
    navigationSource,
    /renderer\.motionStates\.set\(motionState\.key, motionState\);[\s\S]*?renderer\.animatedSprites\.push\(motionState\);[\s\S]*?syncMotionStateVisualPosition\(motionState\);\n\s+return avatarVisual\.nodes;/
  );
  assert.doesNotMatch(sceneSource, /const deltaMs = renderer\.app\?\.ticker\?\.deltaMS \|\| 16;/);
});

test("runtime source adds stronger state-specific animation for waiting, blocked, and validating work", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes('color: state === "validating" ? 0x69c7ff : 0x4bd69f,'));
  assert.ok(renderSource.includes('pulse: state === "validating",'));
  assert.ok(navigationSource.includes("function stateEffectModeForAgent(agent) {"));
  assert.ok(navigationSource.includes('return "waiting";'));
  assert.ok(navigationSource.includes('return "blocked";'));
  assert.ok(navigationSource.includes("function syncStateEffectNode(entry, now) {"));
  assert.ok(navigationSource.includes('kind: "workstation-glow",'));
  assert.ok(navigationSource.includes('kind: "state-effect",'));
  assert.ok(sceneSource.includes('if (entry.kind === "workstation-glow") {'));
  assert.ok(sceneSource.includes('if (entry.kind === "state-effect") {'));
});

test("runtime source gives seated active states distinct motion profiles instead of one generic bob", () => {
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(navigationSource.includes('stateValue === "planning" ? "planning"'));
  assert.ok(navigationSource.includes('stateValue === "scanning" ? "scanning"'));
  assert.ok(navigationSource.includes('stateValue === "editing" ? "editing"'));
  assert.ok(navigationSource.includes('stateValue === "running" ? "running"'));
  assert.ok(navigationSource.includes('stateValue === "validating" ? "validating"'));
  assert.ok(navigationSource.includes('stateValue === "delegating" ? "delegating"'));
  assert.ok(navigationSource.includes("baseX: pixelSnap(avatarVisual.avatar && avatarVisual.avatar.x),"));
  assert.ok(navigationSource.includes("mode,"));
  assert.ok(sceneSource.includes('bobMode === "planning" ? Math.round(waveSlow * 1)'));
  assert.ok(sceneSource.includes('bobMode === "scanning" ? Math.round(waveMid * 1.4)'));
  assert.ok(sceneSource.includes('bobMode === "editing" ? Math.round(waveFast * 1.6)'));
  assert.ok(sceneSource.includes('bobMode === "running" ? Math.round((waveFast + waveStep * 0.45) * 1.7)'));
  assert.ok(sceneSource.includes('bobMode === "validating" ? Math.round(waveMid * 0.8)'));
  assert.ok(sceneSource.includes('bobMode === "delegating" ? Math.round((waveSlow + waveMid * 0.45) * 1.3)'));
});

test("runtime source adds completion summaries and clear actions for multi-question Needs You inputs", () => {
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.ok(navigationSource.includes("function needsUserInputCompletion(need) {"));
  assert.ok(navigationSource.includes('return header || "Question " + (questionIndex + 1);'));
  assert.ok(navigationSource.includes('return "Still needed: " + completion.missingRequired[0];'));
  assert.ok(navigationSource.includes('data-action="clear-needs-user-answer"'));
  assert.ok(navigationSource.includes('escapeHtml(needsUserInputSummary(need))'));
  assert.ok(navigationSource.includes('escapeHtml(needsUserInputSubmitLabel(need, isPending))'));
  assert.ok(uiSource.includes('if (action === "clear-needs-user-answer" && target.dataset.needsUserRequestId && target.dataset.needsUserQuestionId) {'));
  assert.ok(uiSource.includes("const completion = needsUserInputCompletion(entry.need);"));
});

test("runtime source lets queue items open inline reply composers for general local Codex input prompts", () => {
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.ok(navigationSource.includes("const canReplyToInput = Boolean("));
  assert.ok(navigationSource.includes('data-action="open-reply-composer"'));
  assert.ok(navigationSource.includes('renderReplyComposerForThread(replyProjectRoot, agent.threadId, "Reply to this input...")'));
  assert.ok(uiSource.includes("function replyComposerMatchesThread(projectRoot, threadId) {"));
  assert.ok(uiSource.includes("function renderReplyComposerForThread(projectRoot, threadId, placeholder = \"Send a follow-up to this session...\") {"));
});

test("runtime source preserves workstation entering-reveal flags for the Pixi flicker animation", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime().replace(/\r\n/g, "\n");

  assert.ok(sceneSource.includes("enteringReveal: options.enteringReveal === true,"));
  assert.ok(sceneSource.includes("enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, agent, entry.slot.id),"));
  assert.ok(sceneSource.includes("enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, entry.agent, entry.slot.id),"));
  assert.ok(sceneSource.includes("function shouldRevealWorkstation(projectRoot, agent, slotId) {"));
  assert.ok(sceneSource.includes("const previousSceneState = renderedAgentSceneState.get(key) || null;"));
  assert.ok(sceneSource.includes("return previousSlotId !== slotId;"));
  assert.ok(
    navigationSource.includes('if (!screenshotMode && definition.enteringReveal === true) {\n            sprite.visible = false;\n          }')
  );
  assert.ok(
    /renderer\.animatedSprites\.push\(\{\s+kind: "blink",\s+nodes: enteringRevealNodes,/m.test(navigationSource)
  );
  assert.ok(navigationSource.includes("const WORKSTATION_REVEAL_BLINK_DURATION_MS = 280;"));
  assert.equal(
    (navigationSource.match(/durationMs: WORKSTATION_REVEAL_BLINK_DURATION_MS/g) || []).length,
    2
  );
});

test("blocked failure hover summaries prefer the current error detail over stale latest messages", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const stylesSource = readClientSource("styles.css");

  assert.ok(renderSource.includes("if (isFailureBlockedAgent(agent) && detail) {"));
  assert.ok(renderSource.includes('return { text: detail, source: "agent", emphasis: "error" };'));
  assert.ok(renderSource.includes('"agent-hover-summary agent-hover-summary-error"'));
  assert.ok(stylesSource.includes(".agent-hover-summary-error {"));
});

test("multiplayer runtime persists explicit per-project sharing and hides inactive room projects", () => {
  const bootstrapSource = readRuntimeSource("bootstrap-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");
  const uiSource = readRuntimeSource("ui-source.ts");
  const multiplayerSource = readClientSource("multiplayer-source.ts");

  assert.ok(bootstrapSource.includes('multiplayerProjectShareStorageKey = \\"codex-agents-office:multiplayer-project-shares\\";'));
  assert.ok(bootstrapSource.includes('appearance: {\\n          hatId: null\\n        },'));
  assert.ok(bootstrapSource.includes('deviceId: \\"\\"'));
  assert.ok(settingsSource.includes("multiplayerProjectShares: loadMultiplayerProjectShares(),"));
  assert.ok(settingsSource.includes("function effectiveHatIdForAgent(agent) {"));
  assert.ok(settingsSource.includes("multiplayerDraft: { ...defaultIntegrationSettings().multiplayer },"));
  assert.ok(multiplayerSource.includes("const MULTIPLAYER_ACTIVE_AGENT_STATES = new Set(["));
  assert.ok(multiplayerSource.includes("function normalizeMultiplayerSettings(settings, options = {}) {"));
  assert.ok(multiplayerSource.includes("const deviceId = sanitizeMultiplayerField(settings && settings.deviceId);"));
  assert.ok(multiplayerSource.includes("const fallbackEnabled = options && typeof options.fallbackEnabled === \"boolean\""));
  assert.ok(multiplayerSource.includes("function currentMultiplayerDeviceId() {"));
  assert.ok(multiplayerSource.includes("function syncStoredMultiplayerSettings(settings) {"));
  assert.ok(multiplayerSource.includes("function loadMultiplayerProjectShares() {"));
  assert.ok(multiplayerSource.includes("if (!normalizedRoot || shared !== true) {"));
  assert.ok(multiplayerSource.includes("return state.multiplayerProjectShares?.[normalizedRoot] === true;"));
  assert.ok(multiplayerSource.includes("function setProjectRootsSharedWithRoom(projectRoots, shared) {"));
  assert.ok(multiplayerSource.includes("nextShares[projectRoot] = true;"));
  assert.ok(multiplayerSource.includes("function isSnapshotSharedWithRoom(snapshot) {"));
  assert.ok(multiplayerSource.includes("function sharedRepoIdentityForSnapshot(snapshot) {"));
  assert.ok(multiplayerSource.includes("function sharedRepoUrlForSnapshot(snapshot) {"));
  assert.ok(multiplayerSource.includes("function sharedRootCommitForSnapshot(snapshot) {"));
  assert.ok(multiplayerSource.includes('return repoUrl || (rootCommit ? "git-root-commit:" + rootCommit : "");'));
  assert.ok(multiplayerSource.includes('rootCommit: sanitizeSharedText(snapshot.projectIdentity && snapshot.projectIdentity.rootCommit, 128) || null'));
  assert.match(
    multiplayerSource,
    /function sharedRepoUrlForSnapshot\(snapshot\) \{[\s\S]*?const explicitRepoUrl = normalizeSharedRepoIdentity[\s\S]*?return explicitRepoUrl;[\s\S]*?agent && agent\.git && agent\.git\.originUrl/
  );
  assert.ok(multiplayerSource.includes('keys.push("git-repo:git-root-commit:" + rootCommit);'));
  assert.ok(multiplayerSource.includes("const repoUrl = sharedRepoUrlForSnapshot(remoteSnapshot) || null;"));
  assert.ok(multiplayerSource.includes("function indexSharedSnapshotsByWorkspaceKey(snapshots) {"));
  assert.ok(multiplayerSource.includes("function indexSharedSnapshotByWorkspaceKey(snapshotsByKey, snapshot) {"));
  assert.ok(multiplayerSource.includes("if (!snapshotsByKey.has(key)) {"));
  assert.ok(multiplayerSource.includes("function matchingLocalSharedSnapshot(localProjectsByKey, remoteSnapshot) {"));
  assert.ok(multiplayerSource.includes("const remoteRepoIdentity = sharedRepoIdentityForSnapshot(remoteSnapshot);"));
  assert.ok(multiplayerSource.includes('? ["git-repo:" + remoteRepoIdentity]'));
  assert.ok(multiplayerSource.includes('const remoteRoot = normalizeSharedPathCandidate(remoteSnapshot && remoteSnapshot.projectRoot);'));
  assert.ok(multiplayerSource.includes('normalizeSharedPathCandidate(snapshot && snapshot.projectRoot) === remoteRoot'));
  assert.ok(!multiplayerSource.includes('.filter((key) => key.startsWith("workspace:"));'));
  assert.ok(multiplayerSource.includes("function snapshotActiveSharedAgents(snapshot) {"));
  assert.ok(multiplayerSource.includes("function createSharedRemoteOnlySnapshot(remoteSnapshot) {"));
  assert.ok(multiplayerSource.includes("sharedRemoteOnly: true,"));
  assert.ok(multiplayerSource.includes('rooms: [{ id: "root", name: projectLabel, path: ".", x: 0, y: 0, width: 24, height: 16, children: [] }]'));
  assert.ok(multiplayerSource.includes("needsUser: null,"));
  assert.ok(multiplayerSource.includes("age >= -MULTIPLAYER_CLOCK_SKEW_MS && age <= RESTING_DORMANT_MS"));
  assert.ok(multiplayerSource.includes("function normalizeRemoteSharedSnapshot(snapshot) {"));
  assert.ok(multiplayerSource.includes("appearance: { id: appearanceId },"));
  assert.ok(multiplayerSource.includes("latestMessage: sanitizeSharedText(agent.latestMessage, 4000) || null,"));
  assert.ok(multiplayerSource.includes("provenance,"));
  assert.ok(multiplayerSource.includes("if (!id || !Number.isFinite(Date.parse(createdAt))) {"));
  assert.ok(multiplayerSource.includes("command: sanitizeSharedText(event.command, 4000) || null,"));
  assert.ok(multiplayerSource.includes("fileType,"));
  assert.ok(multiplayerSource.includes("lastChangedAt: Number.isFinite(Date.parse(change.lastChangedAt || \"\"))"));
  assert.ok(multiplayerSource.includes("mergedFleet.projects.push(localSnapshot);"));
  assert.ok(multiplayerSource.includes("indexSharedSnapshotByWorkspaceKey(localProjectsByKey, localSnapshot);"));
  assert.ok(!multiplayerSource.includes("if (!localSnapshot || !isSnapshotSharedWithRoom(localSnapshot)) {"));
  assert.ok(multiplayerSource.includes("let localSnapshot = matchingLocalSharedSnapshot(localProjectsByKey, remoteSnapshot);"));
  assert.ok(multiplayerSource.includes("function multiplayerLiveStatusDetail(room, host, peerCount) {"));
  assert.ok(multiplayerSource.includes('" - no shared active matching projects"'));
  assert.ok(multiplayerSource.includes("const remoteAgents = snapshotActiveSharedAgents(remoteSnapshot);"));
  assert.ok(multiplayerSource.includes(".filter((snapshot) => isSnapshotSharedWithRoom(snapshot) && snapshotHasActiveSharedAgents(snapshot))"));
  assert.ok(multiplayerSource.includes("cloned.agents = snapshotActiveSharedAgents(cloned).map((agent) => ({"));
  assert.ok(!multiplayerSource.includes("MULTIPLAYER_REMOTE_PROJECT_COOLDOWN_MS"));
  assert.ok(!multiplayerSource.includes("function cooledRemoteProjectSnapshot(entry) {"));
  assert.ok(multiplayerSource.includes("function mergeSharedHotChange(localSnapshot, remoteSnapshot, change, peer)"));
  assert.ok(multiplayerSource.includes("function mergeSharedActivity(localSnapshot, remoteSnapshot, peer)"));
  assert.ok(multiplayerSource.includes("const users = uniqueSharedList([...(change && Array.isArray(change.users) ? change.users : []), peer.peerLabel]);"));
  assert.ok(multiplayerSource.includes("hotChanges: []"));
  assert.ok(multiplayerSource.includes("const localHatId = currentSelectedHatId();"));
  assert.ok(multiplayerSource.includes("hatId: localHatId"));
  assert.ok(multiplayerSource.includes("deviceId: currentMultiplayerDeviceId(),"));
  assert.ok(multiplayerSource.includes("payload.deviceId === currentMultiplayerDeviceId()"));
  assert.ok(multiplayerSource.includes("const firstPayloadFromPeer = !multiplayerPeers.has(payload.peerId);"));
  assert.match(
    multiplayerSource,
    /applyFleet\(state\.localFleet\);\n\s+if \(firstPayloadFromPeer\) \{\n\s+scheduleMultiplayerBroadcast\(\);/
  );
  assert.ok(multiplayerSource.includes("accountAgents: Array.isArray(mergedFleet.accountAgents) ? mergedFleet.accountAgents : []"));
  assert.match(
    multiplayerSource,
    /const payloadFleet = hasSharedData\n\s+\? \{\n\s+generatedAt:[\s\S]*?projects: Array\.isArray\(fleet\.projects\) \? fleet\.projects : \[\]\n\s+\}/
  );
  assert.match(
    multiplayerSource,
    /return \{\n\s+type: "fleet-sync",[\s\S]*?projects: sharedProjects\n\s+\};/
  );
  assert.ok(uiSource.includes('applyIntegrationSettingsResponse(await postJson("/api/settings/integrations", {'));
  assert.ok(uiSource.includes('multiplayerHostInput.addEventListener("input", () => {'));
  assert.ok(uiSource.includes('multiplayerSaveButton.addEventListener("click", () => {'));
  assert.ok(multiplayerSource.includes("const previousConfigured = Boolean("));
  assert.ok(multiplayerSource.includes("const fallbackEnabled = previousConfigured"));

  const partyServerSource = readFileSync(join(__dirname, "../../party/src/server.ts"), "utf8");
  assert.ok(partyServerSource.includes("deviceId?: string;"));
  assert.ok(partyServerSource.includes("deviceId: normalizedText(candidate.deviceId, 128) ?? undefined"));
});

test("shared peers with the same repository URL merge despite different labels and root commits", () => {
  const multiplayerRuntime = readTemplateExportValue("multiplayer-source.ts");
  const multiplayerFunctions = extractRuntimeFunctions(multiplayerRuntime, [
    "normalizeWorkspaceName",
    "normalizeSharedRepoIdentity",
    "sharedRepoUrlForSnapshot",
    "sharedRootCommitForSnapshot",
    "sharedRepoIdentityForSnapshot",
    "snapshotWorkspaceName",
    "snapshotWorkspaceKeys",
    "indexSharedSnapshotByWorkspaceKey",
    "indexSharedSnapshotsByWorkspaceKey",
    "matchingLocalSharedSnapshot",
    "normalizeSharedPathCandidate"
  ]);
  const state = { localFleet: { projects: [] } };
  const multiplayer = Function("state", `${multiplayerFunctions}\nreturn { sharedRepoIdentityForSnapshot, indexSharedSnapshotsByWorkspaceKey, matchingLocalSharedSnapshot };`)(state);
  const local = {
    projectRoot: "/local/AgentsOfficeTower",
    projectLabel: "Agents Office Tower",
    projectIdentity: {
      repoUrl: "https://github.com/kundara/agentsofficetower.git",
      rootCommit: "a".repeat(40)
    },
    agents: []
  };
  const peer = {
    projectRoot: "/peer/CodexAgentsOffice",
    projectLabel: "Codex Agents Office",
    projectIdentity: {
      repoUrl: "git@github.com:kundara/agentsofficetower.git",
      rootCommit: "b".repeat(40)
    },
    agents: []
  };
  state.localFleet.projects = [local];

  assert.equal(multiplayer.sharedRepoIdentityForSnapshot(local), "https://github.com/kundara/agentsofficetower");
  assert.equal(multiplayer.sharedRepoIdentityForSnapshot(peer), "https://github.com/kundara/agentsofficetower");
  assert.equal(
    multiplayer.matchingLocalSharedSnapshot(multiplayer.indexSharedSnapshotsByWorkspaceKey([local]), peer),
    local
  );
  const legacyRootCommit = "c".repeat(40);
  const legacy = {
    projectRoot: "/legacy/CodexAgentsOffice",
    projectLabel: "Codex Agents Office",
    projectIdentity: {
      repoUrl: `git-root-commit:${legacyRootCommit}`,
      rootCommit: legacyRootCommit
    },
    agents: []
  };
  assert.equal(multiplayer.sharedRepoIdentityForSnapshot(legacy), `git-root-commit:${legacyRootCommit}`);

  const layoutRuntime = readTemplateExportValue("runtime", "layout-source.ts");
  const layoutFunctions = extractRuntimeFunctions(layoutRuntime, [
    "normalizeRepoIdentity",
    "repoIdentityForSnapshot",
    "snapshotGroupKey"
  ]);
  const layout = Function(`${layoutFunctions}\nreturn { snapshotGroupKey };`)();
  assert.equal(layout.snapshotGroupKey(local), "git-repo:https://github.com/kundara/agentsofficetower");
  assert.equal(layout.snapshotGroupKey(peer), layout.snapshotGroupKey(local));
  assert.equal(layout.snapshotGroupKey(legacy), `git-repo:git-root-commit:${legacyRootCommit}`);
});

test("workspace floors show multiplayer participants and expose a shared toggle", () => {
  const settingsSource = readRuntimeSource("settings-source.ts");
  const sceneSource = readSceneRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const styles = readClientSource("styles.css");

  assert.ok(settingsSource.includes("function sharedParticipantLabelsForSnapshot(snapshot) {"));
  assert.ok(sceneSource.includes('class="tower-floor-participants"'));
  assert.ok(sceneSource.includes('data-action="toggle-project-share"'));
  assert.ok(sceneSource.includes('"Shared On" : "Shared"'));
  assert.ok(uiSource.includes('if (action === "toggle-project-share") {'));
  assert.ok(uiSource.includes('target.textContent = !enabled ? "Shared On" : "Shared";'));
  assert.ok(styles.includes(".tower-floor-participants {"));
  assert.ok(styles.includes(".tower-floor-share.active {"));
});

test("remote-only shared floors stay read-only and hide local customization", () => {
  const customizationSource = readRuntimeSource("scene-customization-source.ts");
  assert.ok(customizationSource.includes('snapshot.sceneKind === "street-cafe" || !snapshotHasLocalProject(snapshot)'));
});

test("runtime source exposes hat preview controls and hat-attached avatar rendering", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const styles = readClientSource("styles.css");

  assert.ok(layoutSource.includes('const hatPrevButton = document.getElementById("hat-prev-button");'));
  assert.ok(layoutSource.includes("function syncAppearanceSettingsUi() {"));
  assert.ok(uiSource.includes("function applyOptimisticHatSelection(hatId) {"));
  assert.ok(uiSource.includes("function cycleHatSelection(direction) {"));
  assert.ok(layoutSource.includes("hatPrevButton.disabled = entries.length <= 1;"));
  assert.ok(uiSource.includes("state.appearanceSettingsPending = true;"));
  assert.ok(navigationSource.includes("function hatRenderMetrics(agent, avatarMetrics) {"));
  assert.ok(navigationSource.includes("function hatRenderX(baseX, centeredOffsetX, manualOffsetX, flipX) {"));
  assert.ok(navigationSource.includes("function buildBobAnimationEntry(agent, avatarVisual, motionState) {"));
  assert.ok(navigationSource.includes("hatSprite"));
  assert.ok(sceneSource.includes("(entry.flipX ? -hatManualOffsetX : hatManualOffsetX)"));
  assert.ok(sceneSource.includes("entry.hatSprite.y = entry.hatBaseY + bobOffset;"));
  assert.ok(sceneSource.includes("hatId: effectiveHatIdForAgent(agent),"));
  assert.ok(sceneSource.includes("const hat = hatDefinitionById(agent && agent.hatId);"));
  assert.ok(styles.includes(".hat-cycle {"));
  assert.ok(styles.includes(".hat-preview-frame {"));
});

test("navigation source depth-sorts agents and desk shell sprites by feet position instead of fixed layers", () => {
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();
  const renderSource = readRuntimeSource("render-source.ts");

  assert.ok(navigationSource.includes("function sceneFootDepth(y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {"));
  assert.ok(navigationSource.includes("const depthBase = Number.isFinite(depthBaseY) ? Number(depthBaseY) : 0;"));
  assert.ok(navigationSource.includes("const relativeFootY = footY - depthBase;"));
  assert.ok(navigationSource.includes("const tileRow = Number.isFinite(depthRow) ? Number(depthRow) : Math.floor(relativeFootY / unit);"));
  assert.ok(navigationSource.includes("const intraTileY = relativeFootY - tileRow * unit;"));
  assert.ok(navigationSource.includes("return (100000 + Math.round(depthBase)) * 1000000 + (1000 + tileRow) * 1000 + Math.round(intraTileY * 10) + (Number.isFinite(bias) ? Number(bias) : 0);"));
  assert.ok(navigationSource.includes("function avatarRenderMetrics(agent) {"));
  assert.ok(navigationSource.includes("renderHeight = Number.isFinite(motionState.renderHeight) ? Number(motionState.renderHeight) : Number(motionState.height);"));
  assert.ok(navigationSource.includes("renderTopY = Number.isFinite(motionState.currentY)"));
  assert.ok(navigationSource.includes("function applyFootDepth(node, y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {"));
  assert.ok(sceneSource.includes("depthBaseY: room.floorTop,"));
  assert.ok(navigationSource.includes("const officeDepthBase = Number.isFinite(office.depthBaseY) ? Number(office.depthBaseY) : 0;"));
  assert.ok(navigationSource.includes("if (Number.isFinite(definition.depthFootY)) {"));
  assert.ok(navigationSource.includes("Number(definition.depthFootY) - snappedHeight,"));
  assert.ok(navigationSource.includes("const fixedZ = Number.isFinite(agent.z) ? Number(agent.z) : null;"));
  assert.ok(navigationSource.includes("if (fixedZ !== null) {"));
  assert.ok(navigationSource.includes("Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0"));
  assert.ok(navigationSource.includes("function syncMotionStateDepth(motionState) {"));
  assert.ok(navigationSource.includes("const settledAtTarget = motionState.exiting !== true"));
  assert.ok(navigationSource.includes("const effectiveDepthFootY = settledAtTarget && Number.isFinite(motionState.settledDepthFootY)"));
  assert.ok(navigationSource.includes("previousState.settledDepthFootY = Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null;"));
  assert.ok(navigationSource.includes("settledDepthFootY: Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null,"));
  assert.ok(navigationSource.includes("const depthBias = effectiveDepthBias;"));
  assert.ok(sceneSource.includes("renderer.syncMotionStateDepth(entry);"));
  assert.ok(sceneSource.includes("const renderOffsetX = Number.isFinite(entry.renderOffsetX) ? Number(entry.renderOffsetX) : 0;"));
  assert.ok(sceneSource.includes("entry.sprite.x = pixelSnap(entry.currentX + renderOffsetX);"));
  assert.ok(sceneSource.includes("entry.sprite.y = pixelSnap(entry.currentY + renderOffsetY);"));
  assert.ok(renderSource.includes("const deskDepthFootY = absoluteCellY + deskY + deskHeight;"));
  assert.ok(renderSource.includes("const chairDepthFootY = absoluteCellY + chairY + chairHeight;"));
  assert.ok(renderSource.includes("const workstationDepthFootY = absoluteCellY + workstationY + workstationHeight;"));
  assert.ok(renderSource.includes("const workstationOcclusionInset = compact ? 3 : 4;"));
  assert.ok(renderSource.includes("const workstationFrontDepthFootY = Math.max(deskDepthFootY, workstationDepthFootY) + workstationOcclusionInset;"));
  assert.ok(renderSource.includes("const workstationBoundsHeight = sceneTile * 2;"));
  assert.ok(renderSource.includes("const workstationSortFootY = stationBoundsY + workstationBoundsHeight - 1;"));
  assert.ok(renderSource.includes("const workstationSortRow = Math.floor((workstationSortFootY - depthBaseY) / sceneTile);"));
  assert.ok(sceneSource.includes("depthBaseY: Number.isFinite(options.depthBaseY) ? Math.round(options.depthBaseY) : null,"));
  assert.ok(sceneSource.includes("depthRow: Number.isFinite(options.depthRow) ? Math.round(options.depthRow) : null,"));
  assert.ok(sceneSource.includes("enteringReveal: options.enteringReveal === true,"));
  assert.ok(renderSource.includes("const DESK_SHELL_DEPTH_BIAS = 120;"));
  assert.ok(renderSource.includes("const CHAIR_DEPTH_BIAS = 180;"));
  assert.ok(renderSource.includes("const SEATED_AVATAR_DEPTH_BIAS = 760;"));
  assert.ok(renderSource.includes("const WORKSTATION_FRONT_DEPTH_BIAS = 620;"));
  assert.ok(renderSource.includes("depthFootY: chairDepthFootY,"));
  assert.ok(renderSource.includes("depthFootY: workstationSortFootY,"));
  assert.ok(renderSource.includes("depthRow: workstationSortRow,"));
  assert.ok(renderSource.includes("const mountedWorkstationOccupant = Boolean(agent) && Boolean(options.slotId) && state !== \"blocked\";"));
  assert.ok(renderSource.includes("depthFootY: mountedWorkstationOccupant ? workstationSortFootY : null"));
  assert.ok(renderSource.includes("depthRow: mountedWorkstationOccupant ? workstationSortRow : null"));
  assert.ok(renderSource.includes("depthBias: mountedWorkstationOccupant ? SEATED_AVATAR_DEPTH_BIAS : null"));
  assert.ok(renderSource.includes("if (state === \"idle\" || state === \"done\") {"));
  assert.ok(renderSource.includes("x: seatedX,"));
  assert.ok(renderSource.includes("flip: workstationFlip"));
  assert.doesNotMatch(renderSource, /return \{ x: sideX, y: baseY, flip: workstationFlip \};/);
  assert.ok(sceneSource.includes("depthFootY: Number.isFinite(options.depthFootY) ? Math.round(options.depthFootY) : null,"));
  assert.ok(sceneSource.includes("depthBaseY: Number.isFinite(options.depthBaseY) ? Math.round(options.depthBaseY) : null,"));
  assert.ok(sceneSource.includes("depthRow: Number.isFinite(options.depthRow) ? Math.round(options.depthRow) : null,"));
  assert.ok(sceneSource.includes("depthBias: Number.isFinite(options.depthBias) ? Number(options.depthBias) : null,"));
  assert.ok(renderSource.includes("const seatedState = state === \"editing\""));
});

test("debug tiles expose visible workstation and avatar pivot markers", () => {
  const navigationSource = readNavigationRuntime();
  const renderSource = readRuntimeSource("render-source.ts");

  assert.ok(navigationSource.includes("function addDebugPivot(x, y, color) {"));
  assert.ok(navigationSource.includes(".circle(pivotX, pivotY, 4)"));
  assert.ok(navigationSource.includes(".circle(pivotX, pivotY, 2)"));
  assert.ok(renderSource.includes("pivotX: absoluteCellX + Math.round(avatarPose.x + avatarWidth / 2),"));
  assert.ok(renderSource.includes("pivotY: workstationSortFootY,"));
  assert.ok(renderSource.includes("pivotWidth: Math.round(workstationWidth)"));
});

test("workspace focus reuses compact scene geometry and grid-snapped desk starts", () => {
  const uiSource = readRuntimeSource("ui-source.ts");
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneGridSource = readClientSource("scene-grid-source.ts");

  assert.ok(uiSource.includes("compact: true,"));
  assert.ok(
    sceneGridSource.includes('const deskStartColumn = Math.max('),
    "desk columns should start from a snapped tile column"
  );
  assert.ok(
    sceneGridSource.includes('const deskStartX = deskStartColumn * config.tileSize;'),
    "desk pod origins should convert the snapped column back into tile pixels"
  );
  assert.ok(
    renderSource.includes("tileHeight: 2"),
    "workstation footprint should extend one tile lower while staying top-aligned"
  );
});

test("workspace desk columns keep a one-tile gap between workstation pods", () => {
  const sceneConfigSource = readFileSync(
    join(__dirname, "../src/scene-config.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const sceneGridSource = readClientSource("scene-grid-source.ts");

  assert.match(sceneConfigSource, /deskColumnGapTiles: 1,/);
  assert.ok(sceneGridSource.includes("const columnX = deskStartX + columnIndex * (config.podWidth + config.deskColumnGap);"));
});

test("grouped desk layout preserves family slots and resolves nested agents to the top-level lead", () => {
  const sceneGridSource = readClientSource("scene-grid-source.ts");
  const sceneSource = readSceneRuntime();

  assert.ok(sceneGridSource.includes("function deskFamilyLeadId(snapshot, agent) {"));
  assert.ok(sceneGridSource.includes("!visited.has(familyAgent.parentThreadId)"));
  assert.ok(sceneGridSource.includes("return familyAgent.parentThreadId || familyAgent.id || agent.parentThreadId || agent.id;"));
  assert.ok(sceneGridSource.includes("function assignGroupedDeskAgents(snapshot, groups, slots, podCapacity) {"));
  assert.ok(sceneGridSource.includes("const previousSlot = slotById.get(previousSceneSlotId(snapshot, agent));"));
  assert.ok(sceneGridSource.includes("const leftMirrored = previousSceneMirrored(snapshot, left);"));
  assert.ok(sceneGridSource.includes("previousIndex + 1"));
  assert.ok(sceneSource.includes("const deskAssignments = assignGroupedDeskAgents("));
});

test("workspace focus lets the expanded floor fill the full panel rect", () => {
  const stylesSource = readFileSync(
    join(__dirname, "../src/client/styles.css"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  assert.match(
    stylesSource,
    /body\.workspace-focus \.workspace-tower,\n\s+body\.workspace-focus \.workspace-tower-single \{\n\s+width: 100%;\n\s+max-width: none;\n\s+min-height: 100%;\n\s+margin: 0;/
  );
  assert.match(
    stylesSource,
    /body\.workspace-focus \.tower-floor-body \{\n\s+min-height: 0;\n\s+height: 100%;\n\s+padding: 0;\n\s+overflow: hidden;/
  );
  assert.match(
    stylesSource,
    /body\.workspace-focus \.office-map-host \{\n\s+min-height: 0;\n\s+height: 100%;\n\s+overflow-x: auto;\n\s+overflow-y: hidden;/
  );
});

test("workspace office maps keep wide workstation layouts horizontally scrollable", () => {
  const servedStyles = readClientSource("styles.css").replace(/\r\n/g, "\n");
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.match(
    servedStyles,
    /\.office-map-host \{\n\s+position: relative;\n\s+width: 100%;\n\s+min-height: 0;\n\s+overflow-x: auto;\n\s+overflow-y: hidden;/
  );
  assert.ok(servedStyles.includes("overflow-clip-margin: 360px;"));
  assert.match(
    servedStyles,
    /\.tower-floor-body \.scene-fit\.compact \{\n\s+min-height: 0;\n\s*\}/
  );
  assert.ok(
    navigationSource.includes("const scaledWidth = Math.max(1, Math.round(model.width * scale));"),
    "wide Pixi scenes should render to their scaled content width instead of clipping to the host"
  );
  assert.ok(
    navigationSource.includes("const scale = Math.min(Math.max(availableWidth / fitWidth, 0.5), 3.5);"),
    "wide desk expansion should add horizontal scroll length without squeezing the room scale"
  );
  assert.ok(
    navigationSource.includes("const roomVisualWidth = Math.max(room.width, Number(room.visualWidth) || room.width);"),
    "room wall and floor art should stretch to the synthetic visual width"
  );
  assert.ok(
    readSceneRuntime().includes("fitWidth: baseMaxX * tile,"),
    "the renderer should remember the unexpanded room width for scale fitting"
  );
  assert.ok(
    readSceneRuntime().includes("function expandRoomVisualWidth(roomModel, nextVisualWidth) {"),
    "wide desk columns should expand the rendered room and scene model"
  );
  assert.ok(uiSource.includes("function handleOfficeMapHorizontalWheel(event) {"));
  const horizontalWheelSource = readClientSource("runtime/horizontal-wheel.ts");
  assert.ok(horizontalWheelSource.includes("export function officeMapHorizontalMaxScrollLeft"));
  assert.ok(horizontalWheelSource.includes('const canvas = host.querySelector("[data-office-map-canvas]");'));
  assert.ok(uiSource.includes("const maxScrollLeft = officeMapHorizontalMaxScrollLeft(host);"));
  assert.ok(uiSource.includes("host.scrollLeft = nextScrollLeft;"));
  assert.ok(uiSource.includes('document.body.addEventListener("wheel", handleOfficeMapHorizontalWheel, { passive: false });'));
});

test("runtime source strips markdown formatting markers from display text", () => {
  const layoutSource = readRuntimeSource("display-text-source.ts");

  assert.ok(layoutSource.includes("function stripDisplayMarkdown(value) {"));
  assert.ok(layoutSource.includes('.replace(/\\\\[([^\\\\]]+)\\\\]\\\\(([^)]+)\\\\)/g, "$1")'));
  assert.ok(layoutSource.includes('.split(String.fromCharCode(96)).join("")'));
  assert.ok(layoutSource.includes("function replaceGoalCommandLabel(value) {"));
  assert.ok(layoutSource.includes('replace(/(^|[\\\\s(\\\\x5B\\\\x7B<"\'])\\\\/goal(?=$|[\\\\s)\\\\]\\\\x7D,.!?:;"\'>])/g, "$1🎯")'));
  assert.ok(layoutSource.includes("let displayText = replaceGoalCommandLabel(stripDisplayMarkdown(normalized));"));
  assert.ok(layoutSource.includes('const windowsRoot = ('));
  assert.ok(layoutSource.includes('root.length >= 3 && root[1] === ":"'));
  assert.ok(layoutSource.includes('const comparableLocation = windowsRoot ? normalizedLocation.toLowerCase() : normalizedLocation;'));
  assert.ok(layoutSource.includes('root.split("\\\\\\\\").join("/")'));
  assert.ok(layoutSource.includes('const searchableText = windowsRoot ? text.toLowerCase() : text;'));
  assert.ok(layoutSource.includes('const next = displayText.indexOf("/mnt/", index);'));
  assert.ok(layoutSource.includes("output += displayText.slice(index, next) + (cleaned || wslToWindowsPath(candidate));"));
});

test("runtime source sanitizes path-heavy labels and latest messages with the project root", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const renderSource = readRuntimeSource("render-source.ts");
  const uiSource = readRuntimeSource("ui-source.ts");
  const stylesSource = readClientSource("styles.css");
  const servedStyles = readClientSource("styles.css");

  assert.ok(layoutSource.includes("function compactPathyLabel(snapshot, label) {"));
  assert.ok(layoutSource.includes("return normalizeDisplayText(snapshot && snapshot.projectRoot, preferred) || preferred || \"Agent\";"));
  assert.ok(renderSource.includes("function latestAgentMessage(projectRoot, agent) {"));
  assert.ok(renderSource.includes("const message = latestAgentMessage(snapshot.projectRoot, agent);"));
  assert.ok(renderSource.includes("const hoverTitle = displayAgentLabel(snapshot, agent);"));
  assert.ok(renderSource.includes("agent.goal.objective"));
  assert.ok(renderSource.includes("const goalSource = agent && agent.goal && agent.goal.confidence === \"typed\" ? \"typed\" : \"inferred\";"));
  assert.ok(uiSource.includes("latestAgentMessage(snapshot.projectRoot, agent)"));
  assert.match(stylesSource, /\.agent-hover-summary \{\n\s+display: -webkit-box;\n[\s\S]*?-webkit-line-clamp: 10;\n[\s\S]*?-webkit-box-orient: vertical;\n[\s\S]*?overflow: hidden;/);
  assert.match(servedStyles, /\.agent-hover-summary \{\n\s+display: -webkit-box;\n[\s\S]*?-webkit-line-clamp: 10;\n[\s\S]*?-webkit-box-orient: vertical;\n[\s\S]*?overflow: hidden;/);
});

test("agent hover names use source brand color classes", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const stylesSource = readClientSource("styles.css");
  const servedStyles = readClientSource("styles.css");

  assert.ok(renderSource.includes("function agentBrandClass(agent) {"));
  assert.ok(renderSource.includes('return "agent-hover-brand agent-hover-brand-codex";'));
  assert.ok(renderSource.includes('return "agent-hover-brand agent-hover-brand-claude";'));
  assert.ok(renderSource.includes('return "agent-hover-brand agent-hover-brand-hermes";'));
  assert.ok(renderSource.includes('return "agent-hover-brand agent-hover-brand-cursor";'));
  assert.ok(renderSource.includes('return "agent-hover-brand agent-hover-brand-openclaw";'));
  assert.ok(renderSource.includes("<strong\\${titleClassAttr}>"));
  for (const className of [
    "agent-hover-brand-codex",
    "agent-hover-brand-claude",
    "agent-hover-brand-hermes",
    "agent-hover-brand-cursor",
    "agent-hover-brand-openclaw"
  ]) {
    assert.ok(stylesSource.includes(`.agent-hover-title strong.${className}`));
    assert.ok(servedStyles.includes(`.agent-hover-title strong.${className}`));
  }
});

test("runtime source only keeps finished subagents in recent sessions during the child grace window", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(layoutSource.includes("const SUBAGENT_RECENT_SESSION_GRACE_MS = 12000;"));
  assert.ok(layoutSource.includes("function keepFinishedSubagentSession(agent) {"));
  assert.ok(layoutSource.includes("return keepFinishedSubagentSession(agent);"));
  assert.ok(settingsSource.includes("const SUBAGENT_DEPARTING_AGENT_TTL_MS = 3200;"));
  assert.ok(settingsSource.includes("function departingAgentTtlMs(agent) {"));
});

test("runtime source section files now start on function boundaries instead of continuing previous functions", () => {
  const sceneSource = readSceneRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const generatorSource = readFileSync(join(__dirname, "../scripts/generate-runtime-module.mjs"), "utf8");
  const orderedSections = [
    ["cafe-scene-source.ts", "CLIENT_RUNTIME_CAFE_SCENE_SOURCE"],
    ["scene-source.ts", "CLIENT_RUNTIME_SCENE_SOURCE"],
    ["scene-renderer-source.ts", "CLIENT_RUNTIME_SCENE_RENDERER_SOURCE"],
    ...navigationRuntimeFiles.map((fileName, index) => [fileName, [
      "CLIENT_RUNTIME_NAVIGATION_PATHING_SOURCE",
      "CLIENT_RUNTIME_NAVIGATION_OVERLAYS_SOURCE",
      "CLIENT_RUNTIME_FLOATING_ORCHESTRATOR_SOURCE",
      "CLIENT_RUNTIME_NAVIGATION_SOURCE",
      "CLIENT_RUNTIME_OFFICE_SCENE_LIFECYCLE_SOURCE",
      "CLIENT_RUNTIME_FURNITURE_INTERACTION_SOURCE",
      "CLIENT_RUNTIME_ATTENTION_PANEL_SOURCE"
    ][index]])
  ];

  assert.match(readRuntimeSource("scene-source.ts"), /^export const CLIENT_RUNTIME_SCENE_SOURCE = `\s*function buildLeadClusters/);
  assert.match(uiSource, /^export const CLIENT_RUNTIME_UI_SOURCE = `\s*function sessionCardState/);
  let previousGeneratorOffset = -1;
  for (const [fileName, exportName] of orderedSections) {
    assert.match(readRuntimeSource(fileName), new RegExp("^export const " + exportName + " = `"));
    const generatorOffset = generatorSource.indexOf(`"src/client/runtime/${fileName}"`);
    assert.ok(generatorOffset > previousGeneratorOffset, `${fileName} should keep its runtime generator order`);
    previousGeneratorOffset = generatorOffset;
  }
});

test("runtime source merges worktrees by repo and renders worktree badges in hover and split floor headers", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneSource = readSceneRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(layoutSource.includes("function mergeWorktreeProjects(projects) {"));
  assert.ok(layoutSource.includes("function inferredCodexWorktreeMetadata(projectRoot) {"));
  assert.ok(layoutSource.includes("function snapshotMatchesProjectRoot(snapshot, projectRoot) {"));
  assert.ok(layoutSource.includes("function repoIdentityForSnapshot(snapshot) {"));
  assert.ok(layoutSource.includes('return "git-repo:" + repoIdentity;'));
  assert.match(
    layoutSource,
    /function repoIdentityForSnapshot\(snapshot\) \{[\s\S]*?const explicitRepoUrl = normalizeRepoIdentity[\s\S]*?return explicitRepoUrl;[\s\S]*?agent && agent\.git && agent\.git\.originUrl[\s\S]*?const rootCommit = String/
  );
  assert.ok(layoutSource.includes('return "git-common:" + commonGitDir;'));
  assert.ok(layoutSource.includes("mergedProjectRoots: bucket.snapshots.map((snapshot) => snapshot.projectRoot),"));
  assert.ok(layoutSource.includes("sourceProjectRoot,"));
  assert.ok(renderSource.includes('const worktreeHtml = worktreeName'));
  assert.ok(renderSource.includes('class="agent-hover-worktree"'));
  assert.ok(renderSource.includes('agent && agent.network'));
  assert.ok(renderSource.includes('class="agent-hover-peer"'));
  assert.ok(renderSource.includes('agent.network.peerRoom ?'));
  assert.ok(!renderSource.includes('" @ " + agent.network.peerHost'));
  assert.ok(sceneSource.includes('tower-floor-title-project'));
  assert.ok(sceneSource.includes('tower-floor-title-worktree'));
  assert.ok(uiSource.includes('const selectableProjects = state.globalSceneSettings?.splitWorktrees ? rawProjects : floorProjects;'));
  assert.ok(uiSource.includes('...selectableProjects.map((project) => {'));
  assert.ok(settingsSource.includes("splitWorktrees: Boolean(parsed && parsed.splitWorktrees)"));
});

test("rec-room roster keeps space for recently visible resting leads that went active", () => {
  const layoutSource = readFileSync(
    join(__dirname, "../src/client/runtime/layout-source.ts"),
    "utf8"
  );
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.match(
    layoutSource,
    /const effectiveLimit = Math\.max\(0, limit - reservedRecentLeadSlots\(snapshot\)\);/
  );
  assert.match(
    layoutSource,
    /slice\(0, effectiveLimit\);/
  );
  assert.match(
    specSource,
    /The rec area should keep at most the 4 most recent lead sessions visible;/,
  );
  assert.match(
    specSource,
    /If one of those visible resting leads becomes active again, older hidden leads should not pop back into the rec area just to fill that seat for a moment\./,
  );
});

test("runtime source limits visible rec-room resters to recent top-level leads", () => {
  const sceneSource = readSceneRuntime().replace(/\r\n/g, "\n");

  assert.ok(sceneSource.includes('const allRestingAgents = restingAgentsFor(snapshot, compact);'));
  assert.match(sceneSource, /\.filter\(\(agent\) =>\n\s*!agent\.parentThreadId/);
  assert.ok(sceneSource.includes(".slice(0, 4);"));
  assert.ok(sceneSource.includes('const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents, 4);'));
});

test("runtime source can borrow recent rec-room leads for an empty selected workspace", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.ok(layoutSource.includes("function recentFallbackAgentsForEmptyProject(snapshot, allProjects, limit = SCENE_RECENT_LEAD_LIMIT) {"));
  assert.ok(layoutSource.includes('detail: projectPrefix + " · " + summary,'));
  assert.ok(layoutSource.includes('const fallbackAgents = recentFallbackAgentsForEmptyProject(snapshot, allProjects, recentLeadLimit);'));
  assert.ok(uiSource.includes('? viewSnapshot(selectedSnapshot, SCENE_RECENT_LEAD_LIMIT, selectableProjects)'));
  assert.ok(uiSource.includes('? viewSessionSnapshot(selectedSnapshot, SESSION_RECENT_LEAD_LIMIT, selectableProjects)'));
});

test("runtime source falls back to default rec layout when saved sofa columns overlap", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(renderSource.includes("const defaultLayout = recRoomSofaLayout(compact, roomPixelWidth, baseY);"));
  assert.ok(renderSource.includes("{ ...defaultLayout.sofas[0], x: sofaColumns.left * tile, y: baseY }"));
  assert.ok(renderSource.includes("Math.abs(requestedLayout.sofas[1].x - requestedLayout.sofas[0].x) >= tile * 3"));
  assert.ok(renderSource.includes(": defaultLayout;"));
  assert.ok(renderSource.includes("const sofaWidth = Number(sofa?.sprite?.w) || layout.sofaWidth;"));
  assert.ok(renderSource.includes("const seatOffsetRatio = seatWithinSofa === 0 ? 0.18 : 0.62;"));
  assert.ok(settingsSource.includes("function stableSceneSlotAssignments(projectRoot, category, agents, maxSlots = null) {"));
  assert.ok(settingsSource.includes("|| (slotLimit !== null && slotIndex >= slotLimit)"));
  assert.ok(settingsSource.includes("if (slotLimit !== null && nextSlotIndex >= slotLimit) {"));
});

test("runtime source resolves facility providers and service tiles from startup scene definitions", () => {
  const renderSource = readRuntimeSource("render-source.ts");
  const sceneSource = readSceneRuntime();

  assert.ok(renderSource.includes("function sceneHeldItemDefinition(itemId) {"));
  assert.ok(renderSource.includes("function normalizeFurnitureFacilityProvider(item, roomWidthTiles) {"));
  assert.ok(renderSource.includes("function buildFacilityProviderModel(room, item) {"));
  assert.ok(renderSource.includes("const resolved = normalizeFurnitureItem({ ...item, column }, tileSize, room.width);"));
  assert.ok(sceneSource.includes("roomDoors: [],"));
  assert.ok(sceneSource.includes("facilities: [],"));
  assert.ok(sceneSource.includes("model.roomDoors.push({"));
  assert.ok(sceneSource.includes("model.facilities.push("));
});

test("runtime source animates sliding room doors and autonomous resting-item trips", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();

  assert.ok(sceneSource.includes('if (entry.autonomy && !entry.exiting && typeof renderer.updateAutonomousRestingMotion === "function") {'));
  assert.ok(sceneSource.includes('if (entry.kind === "thrown-item") {'));
  assert.ok(sceneSource.includes("renderer.roomDoorStates.forEach((doorState) => {"));
  assert.ok(sceneSource.includes("doorState.leftSprite.x = pixelSnap(doorState.baseLeftX - slide);"));
  assert.ok(navigationSource.includes("function updateAutonomousRestingMotion(motionState, now) {"));
  assert.ok(navigationSource.includes("spawnThrownHeldItem(previousState);"));
  assert.ok(navigationSource.includes("renderer.roomDoorStates.set(room.id, {"));
  assert.ok(navigationSource.includes("routeMotionStateTo("));
  assert.ok(navigationSource.includes("doorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;"));
});

test("runtime source starts new subagent arrivals from their parent", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(sceneSource.includes("parentThreadId: agent.parentThreadId || null"));
  assert.ok(sceneSource.includes("parentKey: parentAgentKey(snapshot.projectRoot, agent)"));
  assert.ok(sceneSource.includes("parentKey: parentAgentKey(snapshot.projectRoot, entry.agent)"));
  assert.ok(settingsSource.includes('parentId.startsWith(\\`\\${sourceRoot}::\\`)'));
  assert.ok(navigationSource.includes("function parentSpawnPointForAgent(agent, parentState)"));
  assert.ok(navigationSource.includes("const enteringFromParent = !previousState && !previousRoomState && enteringAgentKeys.has(agent.key || agent.id) && Boolean(parentSpawnPoint);"));
  assert.ok(navigationSource.includes("const enteringFromDoor = enteringFromParent"));
  assert.ok(navigationSource.includes("nearestWalkableTile(nav, roomDoorTile(room, model.tile))"));
});

test("runtime source avoids doorway arrival animations for first-load historical sessions", () => {
  const uiSource = readRuntimeSource("ui-source.ts");

  assert.ok(uiSource.includes("enteringAgentKeys = previousKeys.size === 0 || screenshotMode"));
  assert.ok(uiSource.includes("? new Set()"));
});

test("runtime source keeps current agents in the map scene even when they are between desk and rec placement states", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const seatingSource = readRuntimeSource("seating-source.ts");

  assert.ok(seatingSource.includes("function isLiveSceneAgent(agent) {"));
  assert.ok(layoutSource.includes("return agent.isCurrent === true || agent.isOngoing === true || isRuntimeActiveLocalAgent(agent);"));
  assert.ok(layoutSource.includes("const liveAgents = snapshot.agents.filter(isLiveSceneAgent);"));
  assert.ok(layoutSource.includes("const seenAgentIds = new Set();"));
  assert.ok(seatingSource.includes('agent.source === "hermes" && agent.sourceKind === "hermes:roaming"'));
  assert.ok(seatingSource.includes('agent.source === "openclaw" && agent.sourceKind === "openclaw:roaming"'));
  assert.ok(seatingSource.includes("return shouldSeatAtWorkstation(agent) || agent.isCurrent === true || isRuntimeActiveLocalAgent(agent);"));
});

test("runtime source renders projectless Hermes agents in a left-of-tower floating layer", () => {
  const sceneSource = readSceneRuntime();
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const styleSource = readClientSource("styles.css");
  const servedStyles = readClientSource("styles.css");

  assert.ok(sceneSource.includes("function isFloatingOrchestratorAgent(agent) {"));
  assert.ok(sceneSource.includes('agent.source === "openclaw" && agent.sourceKind === "openclaw:roaming"'));
  assert.equal(sceneSource.includes("floatingHermesSlotAt"), false);
  assert.equal(sceneSource.includes("stableSceneSlotAssignments(snapshot.projectRoot, \"floating-hermes\""), false);
  assert.ok(navigationSource.includes("function syncFloatingHermesAgents(projects, options = {})"));
  assert.ok(navigationSource.includes('agent.source === "openclaw" && agent.sourceKind === "openclaw:roaming"'));
  assert.ok(navigationSource.includes("const HERMES_FLOATING_FINISHED_COOLDOWN_MS = 3000;"));
  assert.ok(navigationSource.includes("function shouldRenderScreenFloatingHermesAgent(agent)"));
  assert.ok(navigationSource.includes("if (isFinishedScreenFloatingHermesAgent(agent))"));
  assert.ok(navigationSource.includes('rememberHermesAssignedRect(rects, "openclaw:" + threadId, rect);'));
  assert.ok(navigationSource.includes("function hermesFloatingSlotLayout(entries)"));
  assert.ok(navigationSource.includes("function hermesFloatingVelocityTilt(fromX, fromY, toX, toY)"));
  assert.ok(navigationSource.includes("function syncHermesFloatingMotionStyle(node, key)"));
  assert.ok(navigationSource.includes("function spawnHermesAssignedTransferGhosts(previousRects, projects, activeFloatingKeys = new Set(), options = {})"));
  assert.ok(navigationSource.includes("options.viewportOnly === true"));
  assert.ok(navigationSource.includes("const assignedRects = new Map(lastHermesAssignedScreenRects);"));
  assert.ok(navigationSource.includes("rememberHermesAssignedRect(assignedRects, key, rect);"));
  assert.ok(navigationSource.includes("lastHermesAssignedScreenRects = snapshotHermesAssignedScreenRects();"));
  assert.ok(navigationSource.includes("spawnHermesAssignedTransferGhosts(assignedRects, latestOfficeMapProjects, activeFloatingHermesKeys, options || {});"));
  assert.ok(navigationSource.includes("syncOfficeMapScenes(latestOfficeMapProjects, latestFloatingHermesProjects, { viewportOnly: true });"));
  assert.ok(navigationSource.includes("syncFloatingHermesAgents(latestFloatingHermesProjects.length > 0 ? latestFloatingHermesProjects : latestOfficeMapProjects"));
  assert.ok(uiSource.includes("void syncOfficeMapScenes(displayedProjects, rawProjects);"));
  assert.ok(sceneSource.includes("&& !isFloatingOrchestratorAgent(agent)"));
  assert.ok(styleSource.includes(".hermes-float-layer"));
  assert.ok(styleSource.includes(".hermes-float-agent.is-transfer"));
  assert.ok(styleSource.includes("@keyframes hermes-float-hover"));
  assert.ok(servedStyles.includes(".hermes-float-layer"));
  assert.ok(servedStyles.includes(".hermes-float-agent.is-transfer"));
  assert.ok(servedStyles.includes("@keyframes hermes-float-hover"));
  assert.ok(servedStyles.includes("position: fixed;"));
});

test("toast renderer keeps the message, file-change, and command toast classes and chrome", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.ok(
    toastSource.includes('const className = \\`agent-toast \\${entry.kindClass}'),
    "toast className should start from the agent-toast base class"
  );
  assert.ok(
    toastSource.includes('entry.isFileChange ? " file-change" : ""'),
    "toast renderer should keep the file-change class toggle"
  );
  assert.ok(
    toastSource.includes('entry.isCommand ? " command-window" : ""'),
    "toast renderer should keep the command-window class toggle"
  );
  assert.ok(
    toastSource.includes('!entry.isCommand && Number(entry.priority) >= NOTIFICATION_PRIORITY_MESSAGE ? " message-toast" : ""'),
    "toast renderer should keep the message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('isTextMessageNotification(entry) ? " text-message-toast" : ""'),
    "toast renderer should keep the text-message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-window-label">cmd.exe</div>'),
    "command toasts should keep the cmd.exe window chrome"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-command-line">'),
    "command toasts should keep per-line command rendering"
  );
  assert.ok(
    toastSource.includes('class="agent-toast-label-icon-slot"'),
    "toast label icons should render inside a fixed slot"
  );
  assert.ok(
    toastSource.includes('</div>\\${line.toastItems.length > 1 ? "" : statsHtml}</div></div>'),
    "single-item file-change stats should stay in the toast head row"
  );
  assert.ok(
    !toastSource.includes('</div></div>\\${line.toastItems.length > 1 ? "" : statsHtml}</div>'),
    "single-item file-change stats should not render as a second row"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta add">+\\${line.linesAdded}</span>'),
    "file-change toasts should keep added-line deltas"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta remove">-\\${line.linesRemoved}</span>'),
    "file-change toasts should keep removed-line deltas"
  );
});

test("toast label icons fit a fixed slot instead of driving toast height", () => {
  const stylesSource = readClientSource("styles.css");
  const servedStyles = readClientSource("styles.css");

  assert.ok(stylesSource.includes(".agent-toast-label-icon-slot {"));
  assert.ok(stylesSource.includes("width: 18px;"));
  assert.ok(stylesSource.includes("height: 18px;"));
  assert.ok(stylesSource.includes("flex: 0 0 18px;"));
  assert.ok(stylesSource.includes("overflow: hidden;"));
  assert.ok(stylesSource.includes(".agent-toast-label-icon {"));
  assert.ok(stylesSource.includes("width: 100%;"));
  assert.ok(stylesSource.includes("height: 100%;"));
  assert.ok(stylesSource.includes("object-fit: contain;"));
  assert.ok(servedStyles.includes(".agent-toast-label-icon-slot {"));
  assert.ok(servedStyles.includes("flex: 0 0 18px;"));
  assert.ok(servedStyles.includes("object-fit: contain;"));
  assert.ok(stylesSource.includes(".agent-toast.file-change .agent-toast-title {"));
  assert.ok(stylesSource.includes("white-space: nowrap;"));
});

test("tool dashboard events prefer semantic thread-item icon overrides", () => {
  const renderSource = readRuntimeSource("render-source.ts").replace(/\r\n/g, "\n");
  const eventPresentationSource = readClientSource("runtime/event-presentation.ts").replace(/\r\n/g, "\n");
  const pixelOfficeSource = readFileSync(
    join(__dirname, "../src/pixel-office.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  assert.ok(
    toastSource.includes("const labelIconUrl = eventIconUrlForDashboardEvent(event);"),
    "toast events should use the dashboard-event icon resolver"
  );
  assert.ok(
    eventPresentationSource.includes('event.method === "item/tool/call"'),
    "dashboard-event icon resolver should special-case generic dynamic tool calls"
  );
  assert.ok(
    eventPresentationSource.includes("return itemIconUrl || methodIconUrl;"),
    "tool and subagent events should prefer semantic item icons over exact method icons"
  );
  assert.ok(
    pixelOfficeSource.includes('scriptEdit: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/scriptEdit.png`'),
    "script edit icon should be exposed through the thread-item icon map"
  );
  assert.ok(
    pixelOfficeSource.includes('dynamicToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/mcpToolCall.png`'),
    "dynamic tool calls should reuse the regular MCP gear icon"
  );
  assert.ok(
    eventPresentationSource.includes('eventIconUrlForThreadItemType("scriptEdit")'),
    "dashboard-event icon resolver should have a script file-change icon fallback"
  );
  assert.ok(
    renderSource.includes("labelIconUrl: scriptFileChangeIconUrl(event) || options.labelIconUrl || null"),
    "file-change toasts should prefer the script edit icon when the changed path is script-like"
  );
  assert.ok(
    renderSource.includes("iconUrl: eventIconUrlForDashboardEvent(event) || threadHistoryIconUrl({ tone: tone.tone })"),
    "thread history should share the dashboard-event icon resolver"
  );
});

test("toast runtime preserves read command summaries and text-message priority", () => {
  const renderSource = readRuntimeSource("render-source.ts").replace(/\r\n/g, "\n");
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  assert.match(
    renderSource,
    /if \(executable === "sed" \|\| executable === "cat" \|\| executable === "head" \|\| executable === "tail" \|\| executable === "less" \|\| executable === "more" \|\| executable === "bat"\) {\n\s+title = "Read " \+ firstPathLabel;/,
  );
  assert.match(
    renderSource,
    /else if \(executable === "rg" \|\| executable === "grep"\) {\n\s+title =\n\s+pathTokens\.length > 1 \? "Exploring " \+ pathTokens\.length \+ " files"\n\s+: firstPath \? "Search " \+ firstPathLabel\n\s+: "Search files";/,
  );
  assert.match(
    renderSource,
    /else if \(executable === "ls" \|\| executable === "find" \|\| executable === "tree"\) {\n\s+title =\n\s+pathTokens\.length > 1 \? "Exploring " \+ pathTokens\.length \+ " files"\n\s+: firstPath \? "Explore " \+ cleanReportedPath\(snapshot\.projectRoot, firstPath\)\n\s+: "Explore files";/,
  );
  assert.ok(
    renderSource.includes("if (latestMessageChanged && !typedMessageEvent) {\n          return {"),
    "latest message fallback should only run when no typed message event is available"
  );
  assert.ok(
    renderSource.includes('isTextMessage: true'),
    "latest message notifications should still be marked as text messages"
  );
  assert.ok(
    renderSource.includes('priority: NOTIFICATION_PRIORITY_MESSAGE'),
    "latest message notifications should still use message priority"
  );
  assert.ok(
    renderSource.includes("if (agentHasTypedEvent(snapshot, agent)) {\n          return null;\n        }"),
    "typed events should suppress the summary-diff notification path so event-native toasts surface first"
  );
  assert.ok(
    renderSource.includes("function shouldSuppressHistoricalHydrationNotification(snapshot, agent, previous) {"),
    "render runtime should define a historical hydration suppression helper"
  );
  assert.ok(
    toastSource.includes("if (shouldSuppressHistoricalHydrationNotification(snapshot, agent, previous)) {\n              continue;\n            }"),
    "agent-summary toasts should skip stale first-seen hydrate agents"
  );
  assert.ok(
    toastSource.includes("if (shouldSuppressHistoricalHydrationNotification(snapshot, agent, null)) {\n              continue;\n            }"),
    "typed event toasts should skip stale first-seen hydrate agents"
  );
});

test("toast runtime scopes typed child events to the matching thread agent", () => {
  const renderSource = readRuntimeSource("render-source.ts").replace(/\r\n/g, "\n");
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  assert.ok(
    renderSource.includes("if (event.threadId !== agent.threadId) {\n            return false;\n          }"),
    "summary-to-toast suppression should only consider typed events on the same agent thread"
  );
  assert.ok(
    toastSource.includes("const agent = snapshot.agents.find((candidate) => candidate.threadId && candidate.threadId === event.threadId);"),
    "typed event toasts should anchor to the agent with the matching child thread id"
  );
  assert.ok(
    toastSource.includes("const semanticSubjectKey = notificationSubjectKey(snapshot.projectRoot, agent, event.threadId);"),
    "typed event toasts should key notifications by the typed event thread id"
  );
  assert.ok(
    toastSource.includes("const semanticSubjectKey = notificationSubjectKey(snapshot.projectRoot, agent, agent.threadId);"),
    "summary toasts should key notifications by the summarized agent thread id"
  );
});

test("typed snapshot events still allow message toasts even when the agent is no longer current", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.match(
    toastSource,
    /if \(\n?\s*!agent\.isCurrent\n?\s*&& agent\.state !== "waiting"\n?\s*&& agent\.state !== "blocked"\n?\s*&& event\.kind !== "message"\n?\s*&& !\(event\.kind === "tool" && event\.itemType === "webSearch"\)\n?\s*\) \{/,
  );
});

test("message toasts only clear older toasts for the same agent", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  assert.ok(
    toastSource.includes("function pruneNotificationsForAgent(entry) {"),
    "toast runtime should define a same-agent prune helper for message toasts"
  );
  assert.match(
    toastSource,
    /return candidate\.projectRoot !== entry\.projectRoot \|\| candidate\.key !== entry\.key;/
  );
  assert.ok(
    toastSource.includes("if (priority >= NOTIFICATION_PRIORITY_MESSAGE) {\n          pruneNotificationsForAgent(entry);\n        }"),
    "message toasts should prune only same-agent toasts before enqueue"
  );
  assert.equal(
    toastSource.includes("if (priority >= NOTIFICATION_PRIORITY_MESSAGE) {\n          notifications = [];\n        }"),
    false,
    "message toasts should not clear the global notification list"
  );
});

test("shared peer prefixes are removed only from toast notification subject keys", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");

  assert.ok(
    layoutSource.includes("function normalizeSharedNotificationSubjectId(value) {"),
    "layout runtime should define a shared-prefix normalizer for notification subjects"
  );
  assert.match(
    layoutSource,
    /const match = subjectId\.match\(\/\^shared:\[\^:\]\+:\(\.\+\)\$\/\);\n\s+return match \? match\[1\] : subjectId;/
  );
  assert.ok(
    layoutSource.includes("return \\`\\${projectRoot}::thread::\\${normalizeSharedNotificationSubjectId(subjectThreadId)}\\`;"),
    "thread notification keys should dedupe shared peers by underlying thread id"
  );
  assert.ok(
    layoutSource.includes("return \\`\\${projectRoot}::agent::\\${normalizeSharedNotificationSubjectId(agent && agent.id ? agent.id : \"unknown\")}\\`;"),
    "agent fallback notification keys should use the same subject-only normalization"
  );
});

test("toast notifications use the merged worktree view so unsplit floors keep matching scene anchors", () => {
  const multiplayerSource = readClientSource("multiplayer-source.ts");

  assert.match(
    multiplayerSource,
    /function notificationFleetView\(fleet\) {\n\s+if \(!fleet\) {\n\s+return null;\n\s+}\n\s+return {\n\s+\.\.\.fleet,\n\s+projects: mergeWorktreeProjects\(Array\.isArray\(fleet\.projects\) \? fleet\.projects : \[\]\)\n\s+};\n\s+}/
  );
  assert.match(
    multiplayerSource,
    /const previousNotificationFleet = notificationFleetView\(previousFleet\);\n\s+const nextNotificationFleet = notificationFleetView\(fleet\);\n\s+queueSnapshotEvents\(previousNotificationFleet, nextNotificationFleet\);\n\s+queueAgentNotifications\(previousNotificationFleet, nextNotificationFleet\);/
  );
});

test("boss relationship arrows are hover-only curved overlays with arrowheads", () => {
  const layoutSource = readRuntimeSource("layout-source.ts");
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.ok(navigationSource.includes(".bezierCurveTo(control1X, control1Y, control2X, control2Y, line.x2, line.y2)"));
  assert.ok(navigationSource.includes("const arrowHead = new PIXI.Graphics()"));
  assert.ok(navigationSource.includes("state.hoveredRelationshipBossKey"));
  assert.ok(layoutSource.includes("function isRelationshipBossCandidate(snapshot, agent)"));
  assert.ok(layoutSource.includes("childAgentsFor(snapshot, agent.id).length > 0"));
  assert.ok(sceneSource.includes("if (!isRelationshipBossCandidate(snapshot, agent))"));
  assert.match(
    specSource,
    /Boss-to-subagent relationship arrows should only appear when the user is hovering or focusing that boss in the scene;/,
  );
  assert.match(
    specSource,
    /eligible for boss-to-subagent hover arrows, even if it has only one subagent/,
  );
});

test("spec defines parent-spawn subagent arrivals and door departures", () => {
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.match(
    specSource,
    /A newly visible top-level active agent should enter from the room door and walk to its assigned workstation\./,
  );
  assert.match(
    specSource,
    /A newly visible subagent should start from its parent agent's current scene position, then move to its assigned workstation\./,
  );
  assert.match(
    specSource,
    /If a resting lead becomes active again, it should leave its rec-area seat and walk to its newly assigned workstation instead of despawning and respawning\./,
  );
  assert.match(
    specSource,
    /When an agent truly leaves the visible scene, it should walk back out through the room door\./,
  );
});

test("runtime source only animates exit ghosts for explicit departures and dedupes them", () => {
  const navigationSource = readNavigationRuntime();
  const uiSource = readRuntimeSource("ui-source.ts");
  const layoutSource = readRuntimeSource("layout-source.ts");
  const settingsSource = readRuntimeSource("settings-source.ts");

  assert.ok(navigationSource.includes("const departingAgentKeys = new Set(departingAgents.map((agent) => agent.key));"));
  assert.ok(navigationSource.includes("!motionState || currentAgentKeys.has(key) || motionState.exiting || !departingAgentKeys.has(key)"));
  assert.ok(uiSource.includes("const existingGhost = departingAgents.find((ghost) => ghost.key === key) || null;"));
  assert.ok(uiSource.includes("existingGhost.expiresAt = now + departingAgentTtlMs(entry.agent);"));
  assert.ok(settingsSource.includes("const HISTORICAL_HYDRATION_SUPPRESS_MS = 30000;"));
  assert.ok(layoutSource.includes("function agentLooksHistoricallyHydrated(projectRoot, agent) {"));
  assert.ok(uiSource.includes("markProjectHydrated(snapshot.projectRoot, now);"));
  assert.ok(uiSource.includes("return !(entry && agentLooksHistoricallyHydrated(entry.projectRoot, entry.agent));"));
});

test("runtime source preserves exit ghosts across scene refreshes and reuses the same exit builder", () => {
  const navigationSource = readNavigationRuntime();
  const sceneSource = readSceneRuntime();

  assert.ok(navigationSource.includes("function buildExitGhostMotion(key, motionState, roomNavigation, reservations) {"));
  assert.ok(navigationSource.includes("if (!motionState || motionState.exiting !== true || currentAgentKeys.has(key) || renderer.motionStates.has(key)) {"));
  assert.ok(navigationSource.includes("const preservedExitMotion = buildExitGhostMotion(key, motionState, roomNavigation, reservedAgentTiles);"));
  assert.ok(navigationSource.includes("const ghostMotion = buildExitGhostMotion(key, motionState, roomNavigation, reservedAgentTiles);"));
  assert.ok(sceneSource.includes("entry.exitFadeAlpha = entry.sprite.alpha;"));
});

test("runtime source turns room changes into old-room exits plus new-room door entries and ignores tiny same-slot retargets", () => {
  const navigationSource = readNavigationRuntime();

  assert.ok(navigationSource.includes("function shouldReuseMotionTarget(previousState, agent, preserveAutonomyRoute = false) {"));
  assert.ok(navigationSource.includes("const distance = motionTargetDistance(previousState, agent);"));
  assert.ok(navigationSource.includes("if (sameSlotAssignment(previousState, agent)) {"));
  assert.ok(navigationSource.includes("const previousRoomState = previousMotionState && previousMotionState.roomId !== agent.roomId"));
  assert.ok(navigationSource.includes("const enteringFromDoor = enteringFromParent"));
  assert.ok(navigationSource.includes("const transitionGhostKey = agentKey + \"::transition-exit::\" + previousRoomState.roomId;"));
  assert.ok(navigationSource.includes("const transitionGhost = buildExitGhostMotion(transitionGhostKey, previousRoomState, roomNavigation, reservations);"));
});

test("tower all-view combines chat and cowork sessions into a dedicated street cafe ground floor", () => {
  const settingsSource = readRuntimeSource("settings-source.ts");
  const layoutSource = readRuntimeSource("layout-source.ts");
  const uiSource = readRuntimeSource("ui-source.ts");
  const sceneSource = readRuntimeSource("scene-source.ts");
  const navigationSource = readNavigationRuntime();
  const manifest = JSON.parse(readFileSync(join(__dirname, "../src/config/pixel-office-manifest.json"), "utf8"));

  assert.ok(settingsSource.includes('const STREET_CAFE_PROJECT_ROOT = "__agents-office-street-cafe__";'));
  assert.ok(settingsSource.includes('label: "Chat Café"'));
  assert.ok(settingsSource.includes('return \\`\\${agent.sourceProjectRoot || projectRoot}::\\${agent.sourceAgentId || agent.id}\\`;'));
  assert.ok(layoutSource.includes("function partitionStreetCafeProjects(projects, accountAgents = []) {"));
  assert.ok(layoutSource.includes("isCodexChatProjectRootForStreetCafe(snapshot && snapshot.projectRoot)"));
  assert.ok(layoutSource.includes('String(agent.sourceKind || "").startsWith("claude:cowork")'));
  assert.ok(layoutSource.includes('return agent.interactionMode === "work";'));
  assert.ok(layoutSource.includes("function cloneAccountAgentForStreetCafe(agent) {"));
  assert.ok(layoutSource.includes("accountObserved: true"));
  assert.ok(layoutSource.includes('return "conversation::" + conversationKey;'));
  assert.ok(layoutSource.includes("const accountStreetAgents = (Array.isArray(accountAgents) ? accountAgents : [])"));
  assert.ok(layoutSource.includes("const streetAgents = [...projectStreetAgents, ...accountStreetAgents];"));
  assert.ok(layoutSource.includes('sourceProjectRoot,'));
  assert.ok(layoutSource.includes("Claude remote Home work appears here when the desktop cache makes it available."));
  assert.ok(layoutSource.includes("Codex Quick Chat is separate from Codex tasks; choose Add to task"));
  assert.ok(layoutSource.includes("notes: streetAgents.length === 0"));
  assert.ok(layoutSource.includes('...(snapshot.mergedProjectRoots || [])'));
  assert.ok(layoutSource.includes('agents.map((agent) => agent.sourceProjectRoot).filter(Boolean)'));
  assert.ok(layoutSource.includes('roomId: "street-cafe"'));
  assert.ok(layoutSource.includes("function accountAgentSemanticToken(agent) {"));
  assert.ok(layoutSource.includes('agent.conversationKey || "",'));
  assert.ok(layoutSource.includes('agent.label || "",'));
  assert.ok(layoutSource.includes('agent.detail || "",'));
  assert.ok(layoutSource.includes('agent.updatedAt || "",'));
  assert.ok(layoutSource.includes(".map(accountAgentSemanticToken);"));
  assert.ok(uiSource.includes("[...street.workspaceProjects, street.cafeSnapshot]"));
  assert.ok(uiSource.includes("partitionStreetCafeProjects(floorProjects, fleet.accountAgents)"));
  assert.ok(uiSource.includes('return JSON.stringify(["conversation", agent.conversationKey]);'));
  assert.ok(uiSource.includes("agent.network || agent.accountObserved === true || !appearanceProjectRoot"));
  assert.ok(uiSource.includes('const sessions=(state.selected === "all" ? [...street.workspaceProjects, street.cafeSnapshot] : towerProjects)'));
  assert.ok(sceneSource.includes('snapshot.sceneKind === "street-cafe"'));
  assert.ok(sceneSource.includes("Codex Quick Chat appears after you choose Add to task."));
  assert.ok(sceneSource.includes("Quick Chat: Add to task"));
  assert.ok(sceneSource.includes("const floorMarker = streetCafe"));
  assert.ok(sceneSource.includes('? "G"'));
  assert.ok(sceneSource.includes('pixelOffice.cafe.table'));
  assert.ok(sceneSource.includes("if (occupants.length === 0) {"));
  assert.ok(navigationSource.includes('model.sceneKind === "street-cafe"'));
  assert.equal(manifest.cafe.table.url, "/assets/pixel-office/sprites/cafe/table.png");
  assert.equal(manifest.cafe.storefrontOrange.url, "/assets/pixel-office/sprites/cafe/storefront-orange.png");
});

test("workspace floors expose persisted bounded scene color customization", () => {
  const sceneSource = readSceneRuntime();
  const settingsSource = readRuntimeSource("settings-source.ts");
  const customizationSource = readRuntimeSource("scene-customization-source.ts");
  const lifecycleSource = readRuntimeSource("office-scene-lifecycle-source.ts");
  const navigationSource = readNavigationRuntime();
  const styles = readClientSource("styles.css");

  assert.ok(settingsSource.includes("projectScenePalettes: loadScenePaletteSettings()"));
  assert.ok(settingsSource.includes('const SCENE_PALETTE_STORAGE_KEY = "codex-agents-office:scene-palettes:v1"'));
  assert.match(customizationSource, /function saveScenePaletteSettings\(\) \{[\s\S]*try \{[\s\S]*localStorage\.setItem[\s\S]*catch \{\}/);
  assert.ok(customizationSource.includes('data-action="toggle-floor-customize"'));
  assert.ok(customizationSource.includes('aria-controls="\\${escapeHtml(domId + "-panel")}"'));
  assert.ok(customizationSource.includes("focusSceneCustomizer(projectRoot, open);"));
  assert.ok(customizationSource.includes("focusSceneCustomizer(projectRoot, false);"));
  assert.ok(customizationSource.includes('data-scene-color-role="\\${escapeHtml(role)}"'));
  assert.ok(customizationSource.includes('renderSceneColorField(paletteKey, palette, "floor", "Floor")'));
  assert.ok(customizationSource.includes('renderSceneColorField(paletteKey, palette, "wall", "Wall")'));
  assert.ok(customizationSource.includes('renderSceneColorField(paletteKey, palette, "board", "Board")'));
  assert.ok(customizationSource.includes('data-action="reset-floor-customize"'));
  assert.ok(customizationSource.includes('if (event.key === "Escape" && state.customizeFloorRoot)'));
  assert.ok(customizationSource.includes("lastSceneRenderToken = null;"));
  assert.ok(sceneSource.includes("const customization = renderFloorCustomization(snapshot);"));
  assert.ok(sceneSource.includes("palette: scenePaletteForSnapshot(snapshot).pixi"));
  assert.ok(lifecycleSource.includes("scenePaletteToken(snapshot)"));
  assert.ok(navigationSource.includes("scenePalette.floorSeam, alpha: streetCafe ? 0.42 : 0.32"));
  assert.ok(navigationSource.includes("scenePalette.floorSeam, alpha: streetCafe ? 0.24 : 0.18"));
  assert.ok(navigationSource.includes("scenePalette.floorSeam, alpha: streetCafe ? 0.18 : 0.12"));
  assert.ok(navigationSource.includes("scenePalette.wallBase"));
  assert.ok(navigationSource.includes("scenePalette.boardBase"));
  assert.ok(styles.includes(".tower-floor-customizer"));
  assert.ok(styles.includes(".scene-color-ramp"));
});
