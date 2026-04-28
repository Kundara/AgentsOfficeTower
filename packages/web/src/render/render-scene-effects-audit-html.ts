import { SERVER_BUILD_AT } from "../server/server-metadata";
import { renderHtml } from "./render-html";
import type { FleetResponse, ProjectDescriptor, ServerOptions } from "../server/server-types";

const AUDIT_PROJECT_ROOT = "/audit/scene-effects";

const AUDIT_PROJECT: ProjectDescriptor = {
  root: AUDIT_PROJECT_ROOT,
  label: "Scene Effects Audit"
};

function isoOffset(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function auditAppearance(id: string, label: string, body: string, accent: string, shadow: string) {
  return { id, label, body, accent, shadow };
}

function mockFleetResponse(): FleetResponse {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    projects: [
      {
        projectRoot: AUDIT_PROJECT_ROOT,
        projectLabel: "Scene Effects Audit",
        projectIdentity: null,
        generatedAt,
        rooms: {
          version: 1,
          generated: true,
          filePath: `${AUDIT_PROJECT_ROOT}/.codex-agents/rooms.xml`,
          rooms: [
            { id: "root", name: "Scene Effects Audit", path: ".", x: 0, y: 0, width: 24, height: 16, children: [] }
          ]
        },
        agents: [
          {
            id: "audit-approval-command",
            label: "Command Approval",
            source: "local",
            sourceKind: "vscode",
            parentThreadId: null,
            depth: 0,
            isCurrent: true,
            isOngoing: true,
            statusText: "active",
            role: "lead",
            nickname: null,
            isSubagent: false,
            state: "blocked",
            detail: "Waiting on command approval with full decision set.",
            cwd: `${AUDIT_PROJECT_ROOT}/src/app`,
            roomId: "root",
            appearance: auditAppearance("sun", "Sun", "#f5b74f", "#fff1c9", "#93661f"),
            updatedAt: isoOffset(3_000),
            stoppedAt: null,
            paths: [`${AUDIT_PROJECT_ROOT}/src/app/main.ts`],
            activityEvent: {
              type: "commandExecution",
              action: "ran",
              path: `${AUDIT_PROJECT_ROOT}/src/app/main.ts`,
              title: "Command approval requested",
              isImage: false
            },
            latestMessage: null,
            threadId: "audit-thread-approval-command",
            taskId: null,
            resumeCommand: "codex resume audit-thread-approval-command",
            url: null,
            git: null,
            provenance: "codex",
            confidence: "typed",
            needsUser: {
              kind: "approval",
              requestId: "audit-request-approval-command",
              reason: "Allow npm publish --dry-run",
              command: "npm publish --dry-run",
              cwd: `${AUDIT_PROJECT_ROOT}/src/app`,
              availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
            },
            liveSubscription: "subscribed",
            network: null,
            hatId: "chicken-hat"
          },
          {
            id: "audit-approval-file",
            label: "File Approval",
            source: "local",
            sourceKind: "vscode",
            parentThreadId: null,
            depth: 0,
            isCurrent: true,
            isOngoing: true,
            statusText: "active",
            role: "worker",
            nickname: null,
            isSubagent: false,
            state: "blocked",
            detail: "Waiting on a narrower file-change approval.",
            cwd: `${AUDIT_PROJECT_ROOT}/src/ui`,
            roomId: "root",
            appearance: auditAppearance("rose", "Rose", "#d86797", "#ffe1ef", "#86385a"),
            updatedAt: isoOffset(4_000),
            stoppedAt: null,
            paths: [`${AUDIT_PROJECT_ROOT}/src/ui/HeroPanel.tsx`],
            activityEvent: {
              type: "fileChange",
              action: "edited",
              path: `${AUDIT_PROJECT_ROOT}/src/ui/HeroPanel.tsx`,
              title: "File approval requested",
              isImage: false
            },
            latestMessage: null,
            threadId: "audit-thread-approval-file",
            taskId: null,
            resumeCommand: "codex resume audit-thread-approval-file",
            url: null,
            git: null,
            provenance: "codex",
            confidence: "typed",
            needsUser: {
              kind: "approval",
              requestId: "audit-request-approval-file",
              reason: "Approve edit to HeroPanel.tsx",
              availableDecisions: ["accept", "decline"]
            },
            liveSubscription: "subscribed",
            network: null,
            hatId: "chicken-hat"
          },
          {
            id: "audit-input",
            label: "Schema Input",
            source: "local",
            sourceKind: "vscode",
            parentThreadId: null,
            depth: 0,
            isCurrent: true,
            isOngoing: true,
            statusText: "active",
            role: "worker",
            nickname: null,
            isSubagent: false,
            state: "waiting",
            detail: "Waiting on a multi-question input schema.",
            cwd: `${AUDIT_PROJECT_ROOT}/docs`,
            roomId: "root",
            appearance: auditAppearance("ocean", "Ocean", "#4f9df5", "#d9edff", "#235896"),
            updatedAt: isoOffset(2_000),
            stoppedAt: null,
            paths: [`${AUDIT_PROJECT_ROOT}/docs/release-checklist.md`],
            activityEvent: {
              type: "dynamicToolCall",
              action: "updated",
              path: `${AUDIT_PROJECT_ROOT}/docs/release-checklist.md`,
              title: "Input requested",
              isImage: false
            },
            latestMessage: null,
            threadId: "audit-thread-input",
            taskId: null,
            resumeCommand: "codex resume audit-thread-input",
            url: null,
            git: null,
            provenance: "codex",
            confidence: "typed",
            needsUser: {
              kind: "input",
              requestId: "audit-request-input",
              reason: "Provide launch answers",
              questions: [
                {
                  header: "Mode",
                  id: "mode",
                  question: "Which launch mode should the preview use?",
                  options: [
                    { label: "Fast", description: "Optimize for quick smoke validation." },
                    { label: "Thorough", description: "Run the full launch checklist." }
                  ]
                },
                {
                  header: "Notes",
                  id: "notes",
                  question: "What note should be attached to the launch?",
                  required: false,
                  isOther: true,
                  options: [
                    { label: "Use default note", description: "Reuse the canned release note." }
                  ]
                },
                {
                  header: "Token",
                  id: "token",
                  question: "Enter the deploy token.",
                  isSecret: true
                }
              ]
            },
            liveSubscription: "subscribed",
            network: null,
            hatId: "chicken-hat"
          },
          {
            id: "audit-resolved",
            label: "Resolved Request",
            source: "local",
            sourceKind: "vscode",
            parentThreadId: null,
            depth: 0,
            isCurrent: true,
            isOngoing: false,
            statusText: "idle",
            role: "scribe",
            nickname: null,
            isSubagent: false,
            state: "done",
            detail: "Recently cleared a request and returned to desk cooldown.",
            cwd: `${AUDIT_PROJECT_ROOT}/docs`,
            roomId: "root",
            appearance: auditAppearance("mint", "Mint", "#4bd69f", "#dff8ec", "#1d7c5a"),
            updatedAt: isoOffset(1_500),
            stoppedAt: null,
            paths: [`${AUDIT_PROJECT_ROOT}/docs/release-notes.md`],
            activityEvent: {
              type: "agentMessage",
              action: "said",
              path: `${AUDIT_PROJECT_ROOT}/docs/release-notes.md`,
              title: "Request resolved",
              isImage: false
            },
            latestMessage: "Request answered and queue cleared.",
            threadId: "audit-thread-resolved",
            taskId: null,
            resumeCommand: "codex resume audit-thread-resolved",
            url: null,
            git: null,
            provenance: "codex",
            confidence: "typed",
            needsUser: null,
            liveSubscription: "subscribed",
            network: null,
            hatId: "chicken-hat"
          }
        ],
        cloudTasks: [],
        events: [
          {
            id: `${AUDIT_PROJECT_ROOT}::approval-command-message`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-approval-command",
            createdAt: isoOffset(7_000),
            method: "item/agentMessage/delta",
            itemId: "audit-item-approval-command-msg",
            kind: "message",
            phase: "updated",
            title: "Reply updated",
            detail: "Ready to dry-run publish once you approve the command.",
            path: `${AUDIT_PROJECT_ROOT}/src/app/main.ts`,
            action: "said"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::approval-command`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-approval-command",
            createdAt: isoOffset(3_000),
            method: "item/commandExecution/requestApproval",
            itemId: "audit-item-approval-command",
            requestId: "audit-request-approval-command",
            kind: "approval",
            phase: "waiting",
            title: "Command approval requested",
            detail: "Allow npm publish --dry-run",
            path: `${AUDIT_PROJECT_ROOT}/src/app/main.ts`,
            action: "ran"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::approval-file-message`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-approval-file",
            createdAt: isoOffset(8_000),
            method: "thread/read/agentMessage",
            itemId: "audit-item-approval-file-msg",
            kind: "message",
            phase: "completed",
            title: "Reply completed",
            detail: "I narrowed the patch to the hero panel only.",
            path: `${AUDIT_PROJECT_ROOT}/src/ui/HeroPanel.tsx`,
            action: "said"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::approval-file`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-approval-file",
            createdAt: isoOffset(4_000),
            method: "item/fileChange/requestApproval",
            itemId: "audit-item-approval-file",
            requestId: "audit-request-approval-file",
            kind: "approval",
            phase: "waiting",
            title: "File approval requested",
            detail: "Approve HeroPanel.tsx edit",
            path: `${AUDIT_PROJECT_ROOT}/src/ui/HeroPanel.tsx`,
            action: "edited"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::input-message`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-input",
            createdAt: isoOffset(6_000),
            method: "item/agentMessage/delta",
            itemId: "audit-item-input-msg",
            kind: "message",
            phase: "updated",
            title: "Reply updated",
            detail: "I need launch mode, a note, and the deploy token to proceed.",
            path: `${AUDIT_PROJECT_ROOT}/docs/release-checklist.md`,
            action: "said"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::input`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-input",
            createdAt: isoOffset(2_000),
            method: "item/tool/requestUserInput",
            itemId: "audit-item-input",
            requestId: "audit-request-input",
            kind: "input",
            phase: "waiting",
            title: "Input requested",
            detail: "Answer launch schema questions",
            path: `${AUDIT_PROJECT_ROOT}/docs/release-checklist.md`,
            action: "updated"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::resolved-message`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-resolved",
            createdAt: isoOffset(5_000),
            method: "thread/read/agentMessage",
            itemId: "audit-item-resolved-msg",
            kind: "message",
            phase: "completed",
            title: "Reply completed",
            detail: "All answers are in. I wrapped the release notes and cleared the queue item.",
            path: `${AUDIT_PROJECT_ROOT}/docs/release-notes.md`,
            action: "said"
          },
          {
            id: `${AUDIT_PROJECT_ROOT}::resolved`,
            source: "codex",
            confidence: "typed",
            threadId: "audit-thread-resolved",
            createdAt: isoOffset(1_500),
            method: "serverRequest/resolved",
            requestId: "audit-request-resolved",
            kind: "input",
            phase: "completed",
            title: "Input resolved",
            detail: "Queue item cleared",
            path: `${AUDIT_PROJECT_ROOT}/docs/release-notes.md`,
            action: "updated"
          }
        ],
        notes: ["Audit route uses mocked typed Codex request states for visual validation."]
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
      hatId: "chicken-hat"
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

export function renderSceneEffectsAuditHtml(): string {
  const options: ServerOptions = {
    host: "127.0.0.1",
    port: 4181,
    projects: [AUDIT_PROJECT],
    explicitProjects: true
  };
  const fleetJson = JSON.stringify(mockFleetResponse());
  const settingsJson = JSON.stringify(integrationSettingsResponse());
  const banner = `
    <section class="session-card" style="margin:12px 0;border-color:rgba(121,211,255,0.32);background:rgba(121,211,255,0.08);">
      <strong>Scene Effects Audit</strong>
      <div class="muted" style="margin-top:6px;">This route runs the normal client bundle against mocked typed Codex approval/input fleet data so workstation request signatures can be visually inspected.</div>
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
