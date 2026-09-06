#!/usr/bin/env node

const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const codexCommand = process.env.CODEX_CLI_PATH || "codex";

const knownNotificationMethods = [
  "error",
  "thread/started",
  "thread/status/changed",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/closed",
  "skills/changed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  // Environment attachment is transport state, not agent activity or completion.
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/settings/updated",
  "thread/tokenUsage/updated",
  "turn/started",
  "hook/started",
  "turn/completed",
  "hook/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/completed",
  "rawResponseItem/completed",
  // Internal upstream usage accounting; deliberately omitted from workload events.
  "rawResponse/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "serverRequest/resolved",
  "item/mcpToolCall/progress",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "app/list/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/progress",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "thread/compacted",
  "model/rerouted",
  "model/verification",
  "turn/moderationMetadata",
  "model/safetyBuffering/updated",
  "warning",
  "guardianWarning",
  "deprecationNotice",
  "configWarning",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
  "account/login/completed"
];

const knownServerRequestMethods = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
  "currentTime/read",
  "applyPatchApproval",
  "execCommandApproval"
];

function extractMethods(filePath) {
  const source = readFileSync(filePath, "utf8");
  return [...source.matchAll(/"method":\s*"([^"]+)"/g)].map((match) => match[1]);
}

function diffMethods(label, observed, known) {
  const knownSet = new Set(known);
  const observedSet = new Set(observed);
  return {
    unknown: observed.filter((method) => !knownSet.has(method)),
    missing: known.filter((method) => !observedSet.has(method))
  };
}

const outDir = mkdtempSync(join(tmpdir(), "codex-app-server-protocol-"));
try {
  const generated = spawnSync(
    codexCommand,
    ["app-server", "generate-ts", "--experimental", "--out", outDir],
    { encoding: "utf8" }
  );

  if (generated.error || generated.status !== 0) {
    const detail = generated.error
      ? generated.error.message
      : [generated.stderr, generated.stdout].filter(Boolean).join("\n").trim();
    console.error(`Unable to generate Codex app-server protocol with ${codexCommand}: ${detail}`);
    process.exit(1);
  }

  const notificationMethods = extractMethods(join(outDir, "ServerNotification.ts"));
  const requestMethods = extractMethods(join(outDir, "ServerRequest.ts"));
  const notificationDiff = diffMethods("notifications", notificationMethods, knownNotificationMethods);
  const requestDiff = diffMethods("server requests", requestMethods, knownServerRequestMethods);
  const failures = [];

  if (notificationDiff.unknown.length > 0) {
    failures.push(`Unknown app-server notifications: ${notificationDiff.unknown.join(", ")}`);
  }
  if (notificationDiff.missing.length > 0) {
    failures.push(`Previously known app-server notifications disappeared: ${notificationDiff.missing.join(", ")}`);
  }
  if (requestDiff.unknown.length > 0) {
    failures.push(`Unknown app-server server requests: ${requestDiff.unknown.join(", ")}`);
  }
  if (requestDiff.missing.length > 0) {
    failures.push(`Previously known app-server server requests disappeared: ${requestDiff.missing.join(", ")}`);
  }

  if (failures.length > 0) {
    console.error("Codex app-server protocol drift detected.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error("Review packages/core/src/live-monitor-lib/events.ts before updating this allowlist.");
    process.exit(1);
  }

  console.log(`Codex app-server protocol methods match the reviewed allowlist (${notificationMethods.length} notifications, ${requestMethods.length} server requests).`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
