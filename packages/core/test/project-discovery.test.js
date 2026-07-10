const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  canonicalizeProjectPath,
  codexProjectDiscoveryThreadLimit,
  discoverCodexConfiguredProjects,
  extractCodexConfiguredProjectRoots,
  humanizeProjectLabel,
  isCodexChatProjectRoot,
  mergeDiscoveredProjectLists,
  normalizeDiscoveredProjectUpdatedAt,
  projectLabelFromRoot,
  sameProjectPath
} = require("../dist/project-paths.js");

test("project discovery scans a wider thread window than the requested project count", () => {
  assert.equal(codexProjectDiscoveryThreadLimit(1), 100);
  assert.equal(codexProjectDiscoveryThreadLimit(10), 200);
  assert.equal(codexProjectDiscoveryThreadLimit(50), 400);
});

test("project discovery normalizes provider timestamps to epoch seconds", () => {
  assert.equal(normalizeDiscoveredProjectUpdatedAt(1_774_694_400), 1_774_694_400);
  assert.equal(normalizeDiscoveredProjectUpdatedAt(1_774_694_400_987), 1_774_694_400);
  assert.equal(normalizeDiscoveredProjectUpdatedAt(Number.NaN), 0);
});

test("project discovery freshness comes only from agent and log sources", () => {
  const merged = mergeDiscoveredProjectLists(
    [
      [{ root: "/work/forgotten", label: "Forgotten", updatedAt: 1_774_694_400, count: 0, sourceKind: "configured" }],
      [{ root: "/work/forgotten", label: "Forgotten", updatedAt: 1_700_000_000_000, count: 1, sourceKind: "claude" }],
      [{ root: "/work/current", label: "Current", updatedAt: 1_774_694_300_000, count: 1, sourceKind: "openclaw" }]
    ],
    10
  );

  assert.deepEqual(
    merged.map((project) => ({ root: project.root, updatedAt: project.updatedAt, count: project.count })),
    [
      { root: "/work/current", updatedAt: 1_774_694_300, count: 1 },
      { root: "/work/forgotten", updatedAt: 1_700_000_000, count: 1 }
    ]
  );
});

test("configured roots cannot crowd an active project out of the discovery limit", () => {
  const configured = Array.from({ length: 200 }, (_, index) => ({
    root: `/work/configured-${index}`,
    label: `Configured ${index}`,
    updatedAt: 1_800_000_000 + index,
    count: 0,
    sourceKind: "configured"
  }));
  const active = {
    root: "/work/active",
    label: "Active",
    updatedAt: 1_774_694_300,
    count: 1,
    sourceKind: "codex"
  };

  const merged = mergeDiscoveredProjectLists([configured, [active]], 200);

  assert.equal(merged.length, 200);
  assert.equal(merged[0].root, active.root);
  assert.ok(merged.some((project) => project.root === active.root));
});

test("humanizeProjectLabel adds spaces across camel and acronym boundaries", () => {
  assert.equal(humanizeProjectLabel("CodexAgentsOffice"), "Codex Agents Office");
  assert.equal(humanizeProjectLabel("ProjectAtlas"), "Project Atlas");
  assert.equal(humanizeProjectLabel("XMLParser"), "XML Parser");
});

test("projectLabelFromRoot humanizes the basename", () => {
  assert.equal(projectLabelFromRoot("/workspaces/CodexAgentsOffice"), "Codex Agents Office");
  assert.equal(projectLabelFromRoot("/workspaces/ProjectAtlas"), "Project Atlas");
});

test("Codex dated chat folders collapse to one Chat project", () => {
  assert.equal(
    canonicalizeProjectPath("C:\\Users\\kunda\\Documents\\Codex\\2026-06-29\\see"),
    "/mnt/c/Users/kunda/Documents/Codex"
  );
  assert.equal(
    canonicalizeProjectPath("/mnt/c/Users/kunda/Documents/Codex/2026-07-06/you-know-my-projects"),
    "/mnt/c/Users/kunda/Documents/Codex"
  );
  assert.equal(isCodexChatProjectRoot("/mnt/c/Users/kunda/Documents/Codex"), true);
  assert.equal(projectLabelFromRoot("/mnt/c/Users/kunda/Documents/Codex"), "Chat");
  assert.equal(
    sameProjectPath(
      "/mnt/c/Users/kunda/Documents/Codex/2026-06-29/see",
      "/mnt/c/Users/kunda/Documents/Codex/2026-07-06/you-know-my-projects"
    ),
    true
  );
});

test("extractCodexConfiguredProjectRoots reads configured Codex project entries", () => {
  const config = `
model = "gpt-5.4"
[projects."/mnt/f/AI/CodexAgentsOffice"]
trust_level = "trusted"

[projects."C:\\\\Users\\\\kunda\\\\Back Button Sensation"]
trust_level = "trusted"
`;

  assert.deepEqual(
    extractCodexConfiguredProjectRoots(config),
    [
      "/mnt/f/AI/CodexAgentsOffice",
      "/mnt/c/Users/kunda/Back Button Sensation"
    ]
  );
});

test("canonicalizeProjectPath unwraps Codex desktop wrapper cwd values", () => {
  assert.equal(
    canonicalizeProjectPath("/mnt/c/Program Files/WindowsApps/OpenAI.Codex_26.409.1734.0_x64__2p2nqsd0c76g0/app/resources/\\\\?\\F:\\mnt\\f\\AI\\CodexAgentsOffice"),
    "/mnt/f/AI/CodexAgentsOffice"
  );
  assert.equal(
    canonicalizeProjectPath("/mnt/c/Program Files/WindowsApps/OpenAI.Codex_26.409.1734.0_x64__2p2nqsd0c76g0/app/resources/?/F:/mnt/f/AI/CodexAgentsOffice"),
    "/mnt/f/AI/CodexAgentsOffice"
  );
  assert.equal(
    canonicalizeProjectPath("\\\\?\\F:\\Unity\\ChickenCoop"),
    "/mnt/f/Unity/ChickenCoop"
  );
  assert.equal(
    canonicalizeProjectPath("\\mnt\\c\\Users\\User\\AgentsOfficeTower"),
    "/mnt/c/Users/User/AgentsOfficeTower"
  );
  assert.equal(
    canonicalizeProjectPath("/mnt/f/AI/CodexAgentsOffice/F:/Unity/ChickenCoop"),
    "/mnt/f/Unity/ChickenCoop"
  );
});

test("sameProjectPath treats Windows-backed WSL paths as case-insensitive", () => {
  assert.equal(
    sameProjectPath("/mnt/f/AI/CodexAgentsOffice", "/mnt/f/ai/codexagentsoffice"),
    true
  );
  assert.equal(
    sameProjectPath(
      "/mnt/c/Program Files/WindowsApps/OpenAI.Codex_26.409.1734.0_x64__2p2nqsd0c76g0/app/resources/\\\\?\\F:\\mnt\\f\\AI\\CodexAgentsOffice",
      "/mnt/f/AI/CodexAgentsOffice"
    ),
    true
  );
  assert.equal(
    sameProjectPath("/workspaces/CodexAgentsOffice", "/workspaces/codexagentsoffice"),
    false
  );
});

test("configured Codex discovery uses project-local freshness signals instead of only the config file mtime", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-office-project-discovery-"));
  const projectRoot = join(tempRoot, "FreshWorkspace");
  const gitDir = join(projectRoot, ".git");
  const gitLogDir = join(gitDir, "logs");
  const configPath = join(tempRoot, "config.toml");

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(gitLogDir, { recursive: true });
    writeFileSync(join(gitDir, "index"), "");
    writeFileSync(configPath, `[projects."${projectRoot.replace(/\\/g, "\\\\")}"]\ntrust_level = "trusted"\n`);

    const oldMs = Date.parse("2026-03-10T00:00:00.000Z");
    const freshMs = Date.parse("2026-03-27T12:34:56.000Z");
    utimesSync(configPath, oldMs / 1000, oldMs / 1000);
    utimesSync(join(gitDir, "index"), freshMs / 1000, freshMs / 1000);

    const discovered = await discoverCodexConfiguredProjects(10, configPath);

    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].root, canonicalizeProjectPath(projectRoot));
    assert.ok(discovered[0].updatedAt >= Math.floor(freshMs / 1000));
    assert.ok(discovered[0].updatedAt > Math.floor(oldMs / 1000));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
