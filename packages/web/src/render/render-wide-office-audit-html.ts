import { SERVER_BUILD_AT } from "../server/server-metadata";
import { renderHtml } from "./render-html";
import type { DashboardAgent } from "@codex-agents-office/core";
import type { FleetResponse, ProjectDescriptor, ServerOptions } from "../server/server-types";

const AUDIT_PROJECT_ROOT = "/audit/wide-office";
const AUDIT_AGENT_COUNT = 32;

const AUDIT_PROJECT: ProjectDescriptor = {
  root: AUDIT_PROJECT_ROOT,
  label: "Wide Office Scroll Audit"
};

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

function mockAgent(index: number): DashboardAgent {
  const id = `audit-wide-avatar-${String(index + 1).padStart(2, "0")}`;
  const states = ["editing", "running", "validating", "planning"] as const;
  return {
    id,
    label: `Wide Avatar ${index + 1}`,
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: true,
    isOngoing: true,
    statusText: "active",
    role: index % 4 === 0 ? "lead" : "worker",
    nickname: null,
    isSubagent: false,
    state: states[index % states.length],
    detail: "Synthetic wide-office scroll occupant.",
    cwd: `${AUDIT_PROJECT_ROOT}/src/desk-${index + 1}`,
    roomId: "root",
    appearance: auditAppearance(index),
    updatedAt: isoOffset(index * 750),
    stoppedAt: null,
    paths: [`${AUDIT_PROJECT_ROOT}/src/desk-${index + 1}/task.ts`],
    activityEvent: null,
    latestMessage: `Synthetic avatar ${index + 1} is keeping this desk occupied.`,
    threadId: `audit-wide-thread-${index + 1}`,
    taskId: null,
    resumeCommand: `codex resume audit-wide-thread-${index + 1}`,
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

function mockFleetResponse(): FleetResponse {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    accountAgents: [],
    projects: [
      {
        projectRoot: AUDIT_PROJECT_ROOT,
        projectLabel: "Wide Office Scroll Audit",
        projectIdentity: null,
        generatedAt,
        rooms: {
          version: 1,
          generated: true,
          filePath: `${AUDIT_PROJECT_ROOT}/.codex-agents/rooms.xml`,
          rooms: [
            { id: "root", name: "Wide Office Scroll Audit", path: ".", x: 0, y: 0, width: 18, height: 16, children: [] }
          ]
        },
        agents: Array.from({ length: AUDIT_AGENT_COUNT }, (_, index) => mockAgent(index)),
        cloudTasks: [],
        notes: [],
        events: [],
        activity: {
          generatedAt,
          hotChanges: [],
          hotTools: [],
          runningCommands: []
        }
      }
    ]
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

export function renderWideOfficeAuditHtml(): string {
  const options: ServerOptions = {
    host: "127.0.0.1",
    port: 4181,
    projects: [AUDIT_PROJECT],
    explicitProjects: true
  };
  const fleetJson = JSON.stringify(mockFleetResponse());
  const settingsJson = JSON.stringify(integrationSettingsResponse());
  const banner = `
    <section class="session-card" style="margin:12px 0;border-color:rgba(75,214,159,0.36);background:rgba(75,214,159,0.08);">
      <strong>Wide Office Scroll Audit</strong>
      <div class="muted" style="margin-top:6px;">This route runs the normal client bundle against ${AUDIT_AGENT_COUNT} synthetic active local avatars so wide workstation columns, stretched floor/wall art, and horizontal wheel scrolling can be inspected.</div>
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
  const baseHtml = renderHtml(options, [AUDIT_PROJECT]);
  return baseHtml
    .replace('<div class="panel-body">\n            <div id="center-content"></div>', `<div class="panel-body">\n            ${banner}\n            <div id="center-content"></div>`)
    .replace(scriptTag, `${mockScript}\n    ${scriptTag}`);
}
