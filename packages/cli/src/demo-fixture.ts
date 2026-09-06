import type { DashboardAgent, DashboardEvent, DashboardSnapshot, NeedsUserState } from "@agents-tower/core";

/** Pure timeline: no provider adapters, files, user requests, or wall-clock timers. */
export function buildDemoSnapshot(projectRoot: string, startedAtMs: number, nowMs: number): DashboardSnapshot {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const at = (ms: number) => new Date(startedAtMs + ms).toISOString();
  const approval: NeedsUserState = {
    kind: "approval", requestId: "demo-approval-A", command: "npm run test:demo",
    reason: "DEMO: allow the fixture validation command?", availableDecisions: ["accept", "decline"]
  };
  const input: NeedsUserState = {
    kind: "input", requestId: "demo-input-B", reason: "DEMO: choose a fixture color",
    questions: [{ id: "demo-color", header: "Color", question: "Which demo color?", required: true,
      options: [{ label: "Blue", description: "Demo option" }, { label: "Green", description: "Demo option" }] }]
  };
  const events: DashboardEvent[] = [];
  const event = (ms: number, need: NeedsUserState, resolved: boolean) => {
    if (elapsed < ms) return;
    events.push({
      id: `${need.requestId}-${resolved ? "resolved" : "waiting"}`, threadId: "demo-lead",
      source: "codex", confidence: "typed", createdAt: at(ms), requestId: need.requestId,
      kind: need.kind, phase: resolved ? "completed" : "waiting",
      method: resolved ? "serverRequest/resolved" : need.kind === "approval" ? "item/commandExecution/requestApproval" : "item/tool/requestUserInput",
      title: `DEMO ${need.kind} ${resolved ? "resolved" : "requested"}`, detail: need.reason ?? "", path: null,
      command: need.command, availableDecisions: need.availableDecisions
    });
  };
  event(5000, approval, false);
  event(12000, approval, true);
  event(16000, input, false);
  event(24000, input, true);
  const done = elapsed >= 32000;
  const needsUser = elapsed >= 5000 && elapsed < 12000 ? approval : elapsed >= 16000 && elapsed < 24000 ? input : null;
  const latestStage = [0, 5000, 12000, 16000, 24000, 32000].filter(ms => elapsed >= ms).at(-1) ?? 0;
  const lead: DashboardAgent = {
    id: "demo-lead", label: "DEMO Lead", source: "local", sourceKind: "demo-fixture",
    parentThreadId: null, depth: 0, isCurrent: !done || elapsed < 35000, isOngoing: !done,
    statusText: "Isolated scripted demo", role: "lead", nickname: null, isSubagent: false,
    state: done ? "done" : needsUser?.kind === "approval" ? "blocked" : needsUser ? "waiting" : "running",
    detail: done ? "DEMO completed; observe the cooldown into the rec area." : needsUser?.reason ?? "DEMO fixture validation in progress.",
    cwd: projectRoot, roomId: "demo-office", appearance: { id: "sun", label: "Demo Sun", body: "#f7b731", accent: "#ffdd59", shadow: "#634b25" },
    updatedAt: at(latestStage), stoppedAt: done ? at(32000) : null, paths: ["src/demo.ts"],
    activityEvent: null, latestMessage: done ? "DEMO final answer: validation finished." : null,
    threadId: "demo-lead", taskId: null, resumeCommand: null, url: null, git: null,
    provenance: "codex", confidence: "typed", needsUser, liveSubscription: "readOnly", network: null
  };
  const children: DashboardAgent[] = done ? [] : ["Mapper", "Verifier"].map((role, index) => ({
    ...lead, id: "demo-" + role.toLowerCase(), label: "DEMO " + role,
    parentThreadId: lead.threadId, depth: 1, isSubagent: true, role: role.toLowerCase(),
    threadId: "demo-" + role.toLowerCase(), needsUser: null,
    state: index === 0 ? "scanning" : "validating", detail: "DEMO delegated fixture " + role.toLowerCase() + " pass.",
    appearance: { ...lead.appearance, id: index === 0 ? "ocean" : "mint", body: index === 0 ? "#4a90e2" : "#59b68a" }
  }));
  return {
    projectRoot, projectLabel: "DEMO — isolated request lifecycle", projectIdentity: null,
    generatedAt: new Date(nowMs).toISOString(),
    rooms: { version: 1, generated: true, filePath: "", rooms: [{ id: "demo-office", name: "Demo Office", path: ".", x: 0, y: 0, width: 16, height: 16, children: [] }] },
    agents: [lead, ...children], cloudTasks: [], events,
    activity: { generatedAt: new Date(nowMs).toISOString(), hotChanges: done ? [] : [{
      path: "src/demo.ts", label: "demo.ts", fileType: "script", fileFamily: "code", fileFormat: "ts", formatColor: "#3178c6",
      changeKind: "modified", branch: "demo/fixture", branches: ["demo/fixture"], users: [], heat: 1, score: 2,
      changeCount: 2, lastChangedAt: at(latestStage), linesAdded: 4, linesRemoved: 1,
      agents: ["demo-mapper", "demo-verifier"], provenance: "codex", confidence: "typed"
    }], hotTools: [], runningCommands: [] },
    notes: ["DEMO ONLY. In-memory fixtures; no real provider connections, requests, sharing, or history writes."],
    providerHealth: [], claims: [{
      id: "demo-claim", projectRoot, objective: "DEMO validate shared fixture", scope: ["src/demo.ts"],
      branch: "demo/fixture", agentLabel: "DEMO Lead", status: done ? "released" : "active",
      lifecycle: done ? "released" : "active", blockedOn: needsUser?.reason ?? null,
      createdAt: at(0), heartbeatAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 60000).toISOString()
    }]
  };
}
