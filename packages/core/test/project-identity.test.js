const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { resolveClaudeScratchpadOwner, resolveProjectIdentity } = require("../dist/project-identity.js");

test("deleted Claude scratch worktrees inherit their owning repository identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "tower-scratch-owner-"));
  const ownerRoot = join(root, "ExampleWorkspace");
  const claudeConfig = join(root, ".claude");
  const encodedOwner = "-Users-test-Projects-ExampleWorkspace";
  const sessionId = "0b7ec54b-c40b-43eb-861e-cfa0320d7490";
  const bareScratchRoot = `/private/tmp/claude-501/${encodedOwner}/${sessionId}/scratchpad`;
  const scratchRoot = `/private/tmp/claude-501/${encodedOwner}/${sessionId}/scratchpad/example-wt`;

  try {
    mkdirSync(ownerRoot, { recursive: true });
    execFileSync("git", ["init", ownerRoot], { stdio: "ignore" });
    execFileSync("git", ["-C", ownerRoot, "config", "user.email", "tower-test@example.invalid"]);
    execFileSync("git", ["-C", ownerRoot, "config", "user.name", "Tower Test"]);
    writeFileSync(join(ownerRoot, "README.md"), "test\n");
    execFileSync("git", ["-C", ownerRoot, "add", "README.md"]);
    execFileSync("git", ["-C", ownerRoot, "commit", "-m", "initial"], { stdio: "ignore" });
    execFileSync("git", ["-C", ownerRoot, "remote", "add", "origin", "https://example.invalid/acme/example-workspace.git"]);
    const transcriptDir = join(claudeConfig, "projects", encodedOwner);
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(join(transcriptDir, `${sessionId}.jsonl`), JSON.stringify({ sessionId, cwd: ownerRoot }) + "\n");

    assert.deepEqual(await resolveClaudeScratchpadOwner(scratchRoot, claudeConfig), {
      ownerRoot,
      worktreeName: "example-wt"
    });
    assert.deepEqual(await resolveClaudeScratchpadOwner(bareScratchRoot, claudeConfig), {
      ownerRoot,
      worktreeName: "scratchpad"
    });
    const previousClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeConfig;
    try {
      const identity = await resolveProjectIdentity(scratchRoot);
      assert.equal(identity.repoUrl, "https://example.invalid/acme/example-workspace");
      assert.equal(identity.repoName, "example-workspace");
      assert.match(identity.rootCommit, /^[a-f0-9]{40}$/);
      assert.equal(identity.gitRoot, realpathSync(ownerRoot));
      assert.equal(identity.worktreeName, "example-wt");
      const bareIdentity = await resolveProjectIdentity(bareScratchRoot);
      assert.equal(bareIdentity.repoUrl, "https://example.invalid/acme/example-workspace");
      assert.equal(bareIdentity.worktreeName, "scratchpad");
    } finally {
      if (previousClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfig;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary identityless temporary paths are not treated as Claude scratch worktrees", async () => {
  assert.equal(await resolveClaudeScratchpadOwner("/private/tmp/example-wt"), null);
});
