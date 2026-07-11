const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function withTempHome(run) {
  const home = mkdtempSync(join(tmpdir(), "agents-tower-audit-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    return run(home);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previous;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

const { appendAuditRecord, readAuditJournal } = require("../dist/audit.js");

test("audit journal appends and reads records with actor, action, target, and outcome", () => {
  withTempHome(() => {
    appendAuditRecord({
      actor: "browser",
      action: "approval.respond",
      target: { projectRoot: "/tmp/p", requestId: "req-1" },
      detail: "accept",
      outcome: "ok"
    });
    appendAuditRecord({
      actor: "browser",
      action: "thread.reply",
      target: { projectRoot: "/tmp/p", threadId: "t-1" },
      detail: "reply of 42 characters",
      outcome: "error",
      error: "thread not owned"
    });
    const records = readAuditJournal(10);
    assert.equal(records.length, 2);
    assert.equal(records[0].action, "approval.respond");
    assert.equal(records[0].outcome, "ok");
    assert.equal(records[1].error, "thread not owned");
    assert.ok(records[0].at);
  });
});

test("audit journal respects the read limit and skips corrupt lines", () => {
  withTempHome((home) => {
    for (let index = 0; index < 5; index += 1) {
      appendAuditRecord({
        actor: "cli",
        action: "test.action",
        target: { projectRoot: `/tmp/p${index}` },
        detail: null,
        outcome: "ok"
      });
    }
    const { appendFileSync } = require("node:fs");
    appendFileSync(join(home, "codex-agents-office", "audit", "journal.jsonl"), "not-json\n");
    const records = readAuditJournal(3);
    assert.ok(records.length <= 3);
    assert.ok(records.every((record) => record.action === "test.action"));
  });
});
