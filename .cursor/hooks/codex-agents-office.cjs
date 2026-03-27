#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function projectRootFromScript() {
  if (typeof process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT === "string" && process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT.trim().length > 0) {
    return path.resolve(process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT);
  }
  return path.resolve(__dirname, "..", "..");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function decodeCandidateText(buffer, encoding) {
  try {
    return buffer.toString(encoding);
  } catch {
    return "";
  }
}

function sanitizeDecodedJsonText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .trim();
}

function parsePayloadBuffer(buffer) {
  const candidates = [
    sanitizeDecodedJsonText(decodeCandidateText(buffer, "utf8")),
    sanitizeDecodedJsonText(decodeCandidateText(buffer, "utf16le")),
    sanitizeDecodedJsonText(decodeCandidateText(buffer, "latin1"))
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next decoding
    }
  }

  return {};
}

async function main() {
  const raw = await readStdin().catch(() => Buffer.alloc(0));
  const payload = raw.length > 0 ? parsePayloadBuffer(raw) : {};

  const projectRoot = projectRootFromScript();
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id.trim() : "";
  if (conversationId.length > 0) {
    const hooksDir = path.join(projectRoot, ".codex-agents", "cursor-hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const record = {
      ...payload,
      hook_source: "cursor-hooks",
      timestamp: typeof payload.timestamp === "string" && payload.timestamp.trim().length > 0
        ? payload.timestamp
        : new Date().toISOString(),
      workspace_roots: Array.isArray(payload.workspace_roots) && payload.workspace_roots.length > 0
        ? payload.workspace_roots
        : [projectRoot]
    };
    await fs.appendFile(
      path.join(hooksDir, `${conversationId}.jsonl`),
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
  }

  process.stdout.write("{}\n");
}

main().catch(() => {
  process.stdout.write("{}\n");
});
