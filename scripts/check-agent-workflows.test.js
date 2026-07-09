const test = require("node:test");
const assert = require("node:assert/strict");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { validateAgentWorkflow } = require("./check-agent-workflows.js");

const repoRoot = resolve(__dirname, "..");

function withFixture(mutator) {
  const root = mkdtempSync(join(tmpdir(), "agents-office-workflow-"));
  cpSync(join(repoRoot, ".codex"), join(root, ".codex"), { recursive: true });
  cpSync(join(repoRoot, ".agents"), join(root, ".agents"), { recursive: true });
  try {
    mutator?.(root);
    return validateAgentWorkflow(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rewrite(path, transform) {
  writeFileSync(path, transform(readFileSync(path, "utf8")));
}

test("the repository workflow configuration passes structural validation", () => {
  assert.deepEqual(validateAgentWorkflow(repoRoot), []);
});

test("malformed and duplicate TOML keys fail closed", () => {
  const failures = withFixture((root) => {
    const path = join(root, ".codex", "config.toml");
    rewrite(path, (source) => source.replace(
      'model = "gpt-5.6-sol"',
      'model = "gpt-5.6-sol"\nmodel = "gpt-5.6-sol"'
    ));
  });
  assert.ok(failures.some((failure) => failure.includes("invalid TOML")));
});

test("unregistered and multiply registered role files are rejected", () => {
  const orphanFailures = withFixture((root) => {
    writeFileSync(join(root, ".codex", "agents", "orphan.toml"), "model = \"gpt-5.6-sol\"\n");
  });
  assert.ok(orphanFailures.some((failure) => failure.includes("Unregistered role config")));

  const duplicateFailures = withFixture((root) => {
    const path = join(root, ".codex", "config.toml");
    rewrite(path, (source) => source.replace(
      'config_file = "agents/content-designer.toml"',
      'config_file = "agents/office-mapper.toml"'
    ));
  });
  assert.ok(duplicateFailures.some((failure) => failure.includes("reuses an already registered config file")));
});

test("role layers reject unexpected keys and permission or effort drift", () => {
  const failures = withFixture((root) => {
    const path = join(root, ".codex", "agents", "office-verifier.toml");
    rewrite(path, (source) => source
      .replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "low"')
      .replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"')
      .concat('\ndescription = "metadata in the wrong layer"\n'));
  });
  assert.ok(failures.some((failure) => failure.includes("unsupported keys: description")));
  assert.ok(failures.some((failure) => failure.includes("reasoning effort must be high")));
  assert.ok(failures.some((failure) => failure.includes("must remain read-only")));
});
