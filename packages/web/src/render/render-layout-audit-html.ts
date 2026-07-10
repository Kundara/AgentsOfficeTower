import { SERVER_BUILD_AT } from "../server/server-metadata";
import { renderHtml } from "./render-html";
import type { DashboardAgent } from "@codex-agents-office/core";
import type { FleetResponse, ProjectDescriptor, ServerOptions } from "../server/server-types";

interface LayoutScenario {
  slug: string;
  label: string;
  bossCount: number;
  childrenPerBoss: number;
  soloWorkerCount: number;
}

const LAYOUT_SCENARIOS: LayoutScenario[] = [
  { slug: "boss-vertical", label: "Layout A · 6 Bosses", bossCount: 6, childrenPerBoss: 2, soloWorkerCount: 0 },
  { slug: "mixed", label: "Layout B · 2 Bosses + Desks", bossCount: 2, childrenPerBoss: 2, soloWorkerCount: 5 },
  { slug: "desks-only", label: "Layout C · Desks Only", bossCount: 0, childrenPerBoss: 0, soloWorkerCount: 8 },
  { slug: "big-team", label: "Layout E · Big Team", bossCount: 1, childrenPerBoss: 14, soloWorkerCount: 2 },
  { slug: "quiet", label: "Layout D · Quiet Floor", bossCount: 0, childrenPerBoss: 0, soloWorkerCount: 0 }
];

function scenarioRoot(scenario: LayoutScenario): string {
  return `/audit/layout/${scenario.slug}`;
}

function isoOffset(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function auditAppearance(index: number) {
  const palette = [
    ["mint", "#4bd69f", "#dff8ec", "#1d7c5a"],
    ["sun", "#f5b74f", "#fff1c9", "#93661f"],
    ["ocean", "#4f9df5", "#d9edff", "#235896"],
    ["rose", "#d86797", "#ffe1ef", "#86385a"],
    ["iris", "#7b73f0", "#e6e1ff", "#4139a3"]
  ][index % 5];
  return {
    id: `${palette[0]}-${index}`,
    label: palette[0],
    body: palette[1],
    accent: palette[2],
    shadow: palette[3]
  };
}

function mockAgent(
  scenario: LayoutScenario,
  index: number,
  role: "lead" | "worker",
  parentId: string | null
): DashboardAgent {
  const projectRoot = scenarioRoot(scenario);
  const id = `layout-${scenario.slug}-${role}-${String(index + 1).padStart(2, "0")}`;
  const states = ["editing", "running", "validating", "thinking"] as const;
  return {
    id,
    label: role === "lead" ? `Boss ${index + 1}` : `Worker ${index + 1}`,
    source: "local",
    sourceKind: "vscode",
    parentThreadId: parentId,
    depth: parentId ? 1 : 0,
    isCurrent: true,
    isOngoing: true,
    statusText: "active",
    role,
    nickname: null,
    isSubagent: Boolean(parentId),
    state: states[index % states.length],
    detail: `Synthetic ${role} for layout auditing.`,
    cwd: `${projectRoot}/src/area-${index + 1}`,
    roomId: "root",
    appearance: auditAppearance(index + (role === "lead" ? 0 : 2)),
    updatedAt: isoOffset(index * 800),
    stoppedAt: null,
    paths: [`${projectRoot}/src/area-${index + 1}/task.ts`],
    activityEvent: null,
    latestMessage: `Synthetic ${role} ${index + 1} keeps this seat busy for the layout audit.`,
    threadId: `${id}-thread`,
    taskId: null,
    resumeCommand: `codex resume ${id}-thread`,
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null,
    hatId: index % 3 === 0 ? "builder-cap" : null
  };
}

function scenarioAgents(scenario: LayoutScenario): DashboardAgent[] {
  const agents: DashboardAgent[] = [];
  for (let bossIndex = 0; bossIndex < scenario.bossCount; bossIndex += 1) {
    const boss = mockAgent(scenario, bossIndex, "lead", null);
    agents.push(boss);
    for (let childIndex = 0; childIndex < scenario.childrenPerBoss; childIndex += 1) {
      agents.push(mockAgent(scenario, bossIndex * scenario.childrenPerBoss + childIndex + 40, "worker", boss.id));
    }
  }
  for (let workerIndex = 0; workerIndex < scenario.soloWorkerCount; workerIndex += 1) {
    agents.push(mockAgent(scenario, workerIndex + 80, "worker", null));
  }
  return agents;
}

function mockFleetResponse(): FleetResponse {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    accountAgents: [],
    projects: LAYOUT_SCENARIOS.map((scenario) => ({
      projectRoot: scenarioRoot(scenario),
      projectLabel: scenario.label,
      projectIdentity: null,
      generatedAt,
      rooms: {
        version: 1,
        generated: true,
        filePath: `${scenarioRoot(scenario)}/.codex-agents/rooms.xml`,
        rooms: [
          { id: "root", name: scenario.label, path: ".", x: 0, y: 0, width: 24, height: 16, children: [] }
        ]
      },
      agents: scenarioAgents(scenario),
      cloudTasks: [],
      notes: [],
      events: [],
      activity: {
        generatedAt,
        hotChanges: [],
        hotTools: [],
        runningCommands: []
      }
    }))
  };
}

function integrationSettingsResponse() {
  return {
    cursor: {
      configured: false,
      source: "none",
      maskedKey: null,
      storedConfigured: false,
      storedMaskedKey: null
    },
    appearance: {
      hatId: null
    },
    multiplayer: {
      enabled: false,
      host: "",
      room: "",
      nickname: "",
      deviceId: "",
      configured: false
    }
  };
}

export function renderLayoutAuditHtml(): string {
  const auditProjects: ProjectDescriptor[] = LAYOUT_SCENARIOS.map((scenario) => ({
    root: scenarioRoot(scenario),
    label: scenario.label
  }));
  const options: ServerOptions = {
    host: "127.0.0.1",
    port: 4181,
    projects: auditProjects,
    explicitProjects: true
  };
  const fleetJson = JSON.stringify(mockFleetResponse());
  const settingsJson = JSON.stringify(integrationSettingsResponse());
  const banner = `
    <section class="session-card" style="margin:12px 0;border-color:rgba(143,198,217,0.4);background:rgba(143,198,217,0.08);">
      <strong>Workstation Layout Audit</strong>
      <div class="muted" style="margin-top:6px;">Synthetic floors for tuning layout dynamics: 6-boss vertical distribution, mixed boss/desk floors, desk-only floors, and a quiet floor with content-driven height.</div>
    </section>
  `;
  const mockScript = `
    <script>
      (() => {
        const mockFleet = ${fleetJson};
        const integrationSettings = ${settingsJson};
        const originalFetch = window.fetch ? window.fetch.bind(window) : null;
        window.fetch = (input, init = undefined) => {
          const url = typeof input === "string"
            ? input
            : (input && typeof input.url === "string" ? input.url : String(input));
          const path = new URL(url, window.location.href).pathname;
          if (path === "/api/fleet") {
            return Promise.resolve(new Response(JSON.stringify(mockFleet), { status: 200, headers: { "content-type": "application/json" } }));
          }
          if (path === "/api/settings/integrations") {
            return Promise.resolve(new Response(JSON.stringify(integrationSettings), { status: 200, headers: { "content-type": "application/json" } }));
          }
          if (originalFetch) {
            return originalFetch(input, init);
          }
          return Promise.reject(new Error("fetch unavailable"));
        };

        class MockEventSource {
          constructor(url) {
            this.url = url;
            this.readyState = 1;
            this.listeners = new Map();
            setTimeout(() => {
              this.emit("open", { type: "open" });
              this.emit("fleet", { type: "fleet", data: JSON.stringify(mockFleet) });
            }, 0);
          }

          addEventListener(type, listener) {
            const current = this.listeners.get(type) || [];
            current.push(listener);
            this.listeners.set(type, current);
          }

          removeEventListener(type, listener) {
            const current = this.listeners.get(type) || [];
            this.listeners.set(type, current.filter((entry) => entry !== listener));
          }

          emit(type, event) {
            const current = this.listeners.get(type) || [];
            current.forEach((listener) => {
              try {
                listener(event);
              } catch (error) {
                console.error(error);
              }
            });
            const handler = this["on" + type];
            if (typeof handler === "function") {
              handler(event);
            }
          }

          close() {
            this.readyState = 2;
          }
        }

        window.EventSource = MockEventSource;
      })();
    </script>
  `;
  const scriptTag = `<script src="/client/app.js?v=${encodeURIComponent(SERVER_BUILD_AT)}"></script>`;
  const baseHtml = renderHtml(options, auditProjects);
  return baseHtml
    .replace('<div class="panel-body">\n            <div id="center-content"></div>', `<div class="panel-body">\n            ${banner}\n            <div id="center-content"></div>`)
    .replace(scriptTag, `${mockScript}\n    ${scriptTag}`);
}
