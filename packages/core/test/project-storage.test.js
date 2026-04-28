const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  ensureAgentAppearance,
  getLegacyRoomsFilePath,
  getLegacyRosterFilePath,
  getRoomsFilePath,
  getRosterFilePath,
  loadRoomConfig,
  scaffoldRoomsFile
} = require("../dist/index.js");
const { resetAppSettingsCacheForTest } = require("../dist/app-settings.js");

function withTempAppData() {
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  const configHome = mkdtempSync(join(tmpdir(), "codex-office-app-data-"));
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();

  return {
    configHome,
    restore() {
      if (previousXdgConfigHome !== undefined) {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
      if (previousCodexHome !== undefined) {
        process.env.CODEX_HOME = previousCodexHome;
      } else {
        delete process.env.CODEX_HOME;
      }
      resetAppSettingsCacheForTest();
      rmSync(configHome, { recursive: true, force: true });
    }
  };
}

test("room scaffolding writes to machine-local project storage instead of the project tree", async () => {
  const appData = withTempAppData();
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-office-room-project-"));
  const projectRoot = join(tempRoot, "workspace");

  try {
    mkdirSync(projectRoot, { recursive: true });
    const filePath = await scaffoldRoomsFile(projectRoot);

    assert.equal(filePath, getRoomsFilePath(projectRoot));
    assert.ok(filePath.startsWith(appData.configHome));
    assert.equal(existsSync(filePath), true);
    assert.equal(existsSync(getLegacyRoomsFilePath(projectRoot)), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    appData.restore();
  }
});

test("room loading still falls back to legacy project-local .codex-agents files", async () => {
  const appData = withTempAppData();
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-office-legacy-room-project-"));
  const projectRoot = join(tempRoot, "workspace");
  const legacyPath = getLegacyRoomsFilePath(projectRoot);

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, ".codex-agents"), { recursive: true });
    writeFileSync(
      legacyPath,
      [
        '<agentOffice version="1">',
        '  <room id="root" name="Workspace" path="." x="0" y="0" width="24" height="16" />',
        "</agentOffice>",
        ""
      ].join("\n")
    );

    const config = await loadRoomConfig(projectRoot);

    assert.equal(config.generated, false);
    assert.equal(config.filePath, legacyPath);
    assert.equal(config.rooms[0].name, "Workspace");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    appData.restore();
  }
});

test("agent roster persistence now lands in machine-local project storage", async () => {
  const appData = withTempAppData();
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-office-roster-project-"));
  const projectRoot = join(tempRoot, "workspace");

  try {
    mkdirSync(projectRoot, { recursive: true });
    await ensureAgentAppearance(projectRoot, "thread-123");

    assert.equal(existsSync(getRosterFilePath(projectRoot)), true);
    assert.ok(getRosterFilePath(projectRoot).startsWith(appData.configHome));
    assert.equal(existsSync(getLegacyRosterFilePath(projectRoot)), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    appData.restore();
  }
});
