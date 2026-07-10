#!/usr/bin/env node

const { existsSync, readFileSync, readdirSync, realpathSync, statSync } = require("node:fs");
const { join, relative, resolve, sep } = require("node:path");
const { parse } = require("smol-toml");

const EXPECTED_ROLES = {
  office_mapper: "medium",
  content_designer: "low",
  office_verifier: "high"
};
const EXPECTED_SKILLS = ["agents-tower", "agents-tower-coordination"];
const ROOT_KEYS = [
  "model",
  "review_model",
  "model_reasoning_effort",
  "plan_mode_reasoning_effort",
  "model_verbosity",
  "features",
  "agents"
];
const ROLE_KEYS = ["model", "model_reasoning_effort", "sandbox_mode", "developer_instructions"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPathWithin(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !relativePath.startsWith(sep);
}

function validateExactKeys(value, expected, label, fail) {
  if (!isObject(value)) {
    fail(`${label} must be a TOML table.`);
    return;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const unexpected = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  if (missing.length > 0) {
    fail(`${label} is missing: ${missing.join(", ")}.`);
  }
  if (unexpected.length > 0) {
    fail(`${label} has unsupported keys: ${unexpected.join(", ")}.`);
  }
}

function parseTomlFile(path, label, fail) {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is invalid TOML: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateRoleRegistration(role, registration, fail) {
  validateExactKeys(registration, ["description", "config_file", "nickname_candidates"], `Agent ${role} registration`, fail);
  if (!isObject(registration)) {
    return null;
  }
  if (typeof registration.description !== "string" || registration.description.trim().length === 0) {
    fail(`Agent ${role} needs a nonempty selection description.`);
  }
  if (typeof registration.config_file !== "string" || registration.config_file.trim().length === 0) {
    fail(`Agent ${role} needs a config_file.`);
  }
  const nicknames = registration.nickname_candidates;
  if (
    !Array.isArray(nicknames)
    || nicknames.length === 0
    || nicknames.some((nickname) => typeof nickname !== "string" || !/^[A-Za-z0-9 _-]+$/.test(nickname))
  ) {
    fail(`Agent ${role} nickname candidates must be nonempty names using letters, numbers, spaces, underscores, or hyphens.`);
  } else if (new Set(nicknames).size !== nicknames.length) {
    fail(`Agent ${role} nickname candidates must be unique.`);
  }
  return typeof registration.config_file === "string" ? registration.config_file : null;
}

function validateRoleFile(role, rolePath, expectedEffort, fail) {
  const config = parseTomlFile(rolePath, `Agent ${role} config`, fail);
  if (!config) {
    return;
  }
  validateExactKeys(config, ROLE_KEYS, `Agent ${role} config`, fail);
  if (config.model !== "gpt-5.6-sol") {
    fail(`Agent ${role} must use gpt-5.6-sol.`);
  }
  if (config.model_reasoning_effort !== expectedEffort) {
    fail(`Agent ${role} reasoning effort must be ${expectedEffort}.`);
  }
  if (config.sandbox_mode !== "read-only") {
    fail(`Agent ${role} must remain read-only.`);
  }
  if (typeof config.developer_instructions !== "string" || config.developer_instructions.trim().length === 0) {
    fail(`Agent ${role} needs nonempty developer instructions.`);
  }
}

function validateCodexConfig(repoRoot, fail) {
  const codexRoot = join(repoRoot, ".codex");
  const codexConfigPath = join(codexRoot, "config.toml");
  const roleConfigRoot = resolve(codexRoot, "agents");
  if (!existsSync(codexConfigPath)) {
    fail("Missing .codex/config.toml.");
    return;
  }
  const config = parseTomlFile(codexConfigPath, ".codex/config.toml", fail);
  if (!config) {
    return;
  }

  validateExactKeys(config, ROOT_KEYS, ".codex/config.toml", fail);
  if (config.model !== "gpt-5.6-sol") fail("Lead model must be gpt-5.6-sol.");
  if (config.review_model !== "gpt-5.6-sol") fail("Review model must be gpt-5.6-sol.");
  if (config.model_reasoning_effort !== "medium") fail("Lead reasoning baseline must remain medium.");
  if (config.plan_mode_reasoning_effort !== "high") fail("Plan mode must use high reasoning effort.");
  if (config.model_verbosity !== "medium") fail("Lead model verbosity must remain medium.");

  validateExactKeys(config.features, ["multi_agent_v2"], "features", fail);
  const multiAgent = isObject(config.features) ? config.features.multi_agent_v2 : null;
  validateExactKeys(multiAgent, ["enabled", "max_concurrent_threads_per_session"], "features.multi_agent_v2", fail);
  if (isObject(multiAgent)) {
    if (multiAgent.enabled !== true) fail("Multi-agent v2 support must be enabled.");
    if (multiAgent.max_concurrent_threads_per_session !== 4) fail("Agent concurrency must stay capped at four threads per session.");
  }

  const agents = config.agents;
  validateExactKeys(
    agents,
    ["max_depth", "job_max_runtime_seconds", "interrupt_message", ...Object.keys(EXPECTED_ROLES)],
    "agents",
    fail
  );
  if (!isObject(agents)) {
    return;
  }
  if (agents.max_depth !== 1) fail("Nested delegation must stay capped at one level.");
  if (agents.job_max_runtime_seconds !== 1800) fail("Batch workers need a bounded 1800-second runtime.");
  if (agents.interrupt_message !== true) fail("Interrupted workers must preserve a handoff message.");

  const registeredFiles = new Set();
  for (const [role, effort] of Object.entries(EXPECTED_ROLES)) {
    const configFile = validateRoleRegistration(role, agents[role], fail);
    if (!configFile) continue;
    const rolePath = resolve(codexRoot, configFile);
    if (!isPathWithin(roleConfigRoot, rolePath) || !rolePath.endsWith(".toml")) {
      fail(`Agent ${role} config must be a TOML file inside .codex/agents: ${configFile}`);
      continue;
    }
    if (registeredFiles.has(rolePath)) {
      fail(`Agent ${role} reuses an already registered config file: ${configFile}`);
      continue;
    }
    registeredFiles.add(rolePath);
    if (!existsSync(rolePath) || !statSync(rolePath).isFile()) {
      fail(`Agent ${role} config does not exist as a regular file: ${configFile}`);
      continue;
    }
    const realRoleRoot = realpathSync(roleConfigRoot);
    const realRolePath = realpathSync(rolePath);
    if (!isPathWithin(realRoleRoot, realRolePath)) {
      fail(`Agent ${role} config resolves outside .codex/agents: ${configFile}`);
      continue;
    }
    validateRoleFile(role, rolePath, effort, fail);
  }

  if (existsSync(roleConfigRoot)) {
    for (const entry of readdirSync(roleConfigRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".toml")) {
        const path = resolve(roleConfigRoot, entry.name);
        if (!registeredFiles.has(path)) {
          fail(`Unregistered role config: .codex/agents/${entry.name}`);
        }
      }
    }
  }
}

function validateSkill(repoRoot, skillName, fail) {
  const skillRoot = join(repoRoot, ".agents", "skills", skillName);
  const skillPath = join(skillRoot, "SKILL.md");
  const metadataPath = join(skillRoot, "agents", "openai.yaml");
  if (!existsSync(skillPath)) {
    fail(`Missing repo-discoverable skill: ${skillName}.`);
    return;
  }
  if (!existsSync(metadataPath)) {
    fail(`Missing agents/openai.yaml for ${skillName}.`);
    return;
  }

  const source = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(`${skillName} has invalid YAML frontmatter.`);
  } else {
    const keys = [...frontmatter[1].matchAll(/^([a-z_-]+):/gm)].map((match) => match[1]);
    if (keys.join(",") !== "name,description") {
      fail(`${skillName} frontmatter must contain only name and description.`);
    }
    if (!new RegExp(`^name: ${skillName}$`, "m").test(frontmatter[1])) {
      fail(`${skillName} frontmatter name does not match its directory.`);
    }
  }

  const metadata = readFileSync(metadataPath, "utf8");
  if (!new RegExp(`default_prompt: ".*\\$${skillName}.*"`).test(metadata)) {
    fail(`${skillName} default prompt must explicitly invoke $${skillName}.`);
  }
  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/g)) {
    if (!existsSync(join(skillRoot, match[1]))) {
      fail(`${skillName} links to a missing reference: ${match[1]}`);
    }
  }
}

function validateAgentWorkflow(repoRoot) {
  const failures = [];
  const fail = (message) => failures.push(message);
  validateCodexConfig(repoRoot, fail);
  EXPECTED_SKILLS.forEach((skill) => validateSkill(repoRoot, skill, fail));
  return failures;
}

if (require.main === module) {
  const failures = validateAgentWorkflow(join(__dirname, ".."));
  if (failures.length > 0) {
    console.error("Agent workflow validation failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Agent workflow config is consistent (${Object.keys(EXPECTED_ROLES).length} roles, ${EXPECTED_SKILLS.length} skills, GPT-5.6 Sol).`);
}

module.exports = { validateAgentWorkflow };
