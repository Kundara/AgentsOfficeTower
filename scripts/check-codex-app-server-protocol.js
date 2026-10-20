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
  "thread/reverted",
  "thread/deleted",
  "thread/unarchived",
  "thread/closed",
  "skills/changed",
  "thread/name/updated",
  "thread/project/updated",
  // Client-only unread, attachment, prediction, and queued-draft state; never workload.
  "thread/readState/changed",
  "thread/attachment/updated",
  "thread/prediction/updated",
  "thread/queue/changed",
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
  "autoApprovalReview/strictReviewRequired",
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
  // Only delivered to clients that call mcpServer/event/stream/start; the observer never does.
  "mcpServer/event/stream/notification",
  "modelProvider/authRecoveryStarted",
  "modelProvider/authRecoveryCompleted",
  "account/updated",
  "account/rateLimits/updated",
  "account/gatewayOAuth/changed",
  "app/list/updated",
  "remoteControl/status/changed",
  "project/changed",
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
  "thread/realtime/item/started",
  "thread/realtime/item/transcript/delta",
  "thread/realtime/item/completed",
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

// Turn item variants drive desk state in snapshot-lib/thread-summary.ts and
// domain/codex-turn-semantics.ts; new variants must be classified there first.
const knownThreadItemTypes = [
  "userMessage",
  "hookPrompt",
  "agentMessage",
  "functionCallOutput",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageView",
  "sleep",
  "imageGeneration",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction"
];

// Only `final_answer` releases a desk; every other phase is non-final.
const knownMessagePhases = ["commentary", "partial_answer", "final_answer"];

function extractThreadItemTypes(filePath) {
  const source = readFileSync(filePath, "utf8");
  return [...new Set([...source.matchAll(/"type":\s*"([^"]+)"/g)].map((match) => match[1]))];
}

function extractStringUnion(filePath) {
  const source = readFileSync(filePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = source.slice(source.indexOf("=") + 1);
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

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
  const itemTypes = extractThreadItemTypes(join(outDir, "v2", "ThreadItem.ts"));
  const itemDiff = diffMethods("thread items", itemTypes, knownThreadItemTypes);
  const phases = extractStringUnion(join(outDir, "MessagePhase.ts"));
  const phaseDiff = diffMethods("message phases", phases, knownMessagePhases);
  const failures = [];

  if (itemDiff.unknown.length > 0) {
    failures.push(`Unknown thread item types: ${itemDiff.unknown.join(", ")}`);
  }
  if (itemDiff.missing.length > 0) {
    failures.push(`Previously known thread item types disappeared: ${itemDiff.missing.join(", ")}`);
  }
  if (phaseDiff.unknown.length > 0 || phaseDiff.missing.length > 0) {
    failures.push(`Message phase drift: +[${phaseDiff.unknown.join(", ")}] -[${phaseDiff.missing.join(", ")}]`);
  }

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
    console.error("Review packages/core/src/live-monitor-lib/events.ts and snapshot-lib/thread-summary.ts before updating this allowlist.");
    process.exit(1);
  }

  console.log(`Codex app-server protocol methods match the reviewed allowlist (${notificationMethods.length} notifications, ${requestMethods.length} server requests, ${itemTypes.length} thread items, ${phases.length} message phases).`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
