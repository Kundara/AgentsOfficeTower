const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCodexCommandCandidates,
  CODEX_BACKGROUND_EXEC_OPTIONS,
  execCodex,
  windowsPathToWslPath
} = require("../dist/codex-command.js");

test("background Codex executions pass hidden-window options to execFile", async () => {
  const calls = [];
  const result = await execCodex(["cloud", "list", "--json"], {
    candidates: [{ command: "codex-fixture", label: "fixture", argsPrefix: ["--prefix"] }],
    async executeFile(command, args, options) {
      calls.push({ command, args, options });
      return { stdout: '{"tasks":[]}', stderr: "" };
    }
  });

  assert.deepEqual(calls, [{
    command: "codex-fixture",
    args: ["--prefix", "cloud", "list", "--json"],
    options: { windowsHide: true }
  }]);
  assert.equal(result.stdout, '{"tasks":[]}');
  assert.equal(result.candidate.label, "fixture");
});

test("candidate list prefers explicit override before PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "linux",
      codexCliPath: "/custom/codex"
    }),
    [
      { command: "/custom/codex", label: "CODEX_CLI_PATH override" },
      { command: "codex", label: "Codex CLI on PATH" }
    ]
  );
});

test("macOS candidates prefer ChatGPT and Codex app bundles before PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "darwin",
      macAppBundlePaths: [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex"
      ]
    }),
    [
      {
        command: "/Applications/ChatGPT.app/Contents/Resources/codex",
        label: "Codex app bundle"
      },
      {
        command: "/Applications/Codex.app/Contents/Resources/codex",
        label: "Codex app bundle"
      },
      { command: "codex", label: "Codex CLI on PATH" }
    ]
  );
});

test("Windows app bundle candidate is preferred before PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "win32",
      windowsAppPath: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe"
    }),
    [
      {
        command: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe",
        label: "Codex Windows app bundle"
      },
      { command: "codex.cmd", label: "Codex CLI cmd shim on PATH" },
      { command: "codex.exe", label: "Codex CLI executable on PATH" }
    ]
  );
});

test("Windows candidates prefer the app bundle before WSL and PATH fallbacks", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "win32",
      windowsWslCommand: ["--exec", "codex"],
      windowsAppPath: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe"
    }),
    [
      {
        command: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe",
        label: "Codex Windows app bundle"
      },
      { command: "codex.cmd", label: "Codex CLI cmd shim on PATH" },
      { command: "codex.exe", label: "Codex CLI executable on PATH" },
      { command: "wsl.exe", label: "Codex CLI via WSL", argsPrefix: ["--exec", "codex"] },
      { command: "C:\\Windows\\System32\\wsl.exe", label: "Codex CLI via WSL", argsPrefix: ["--exec", "codex"] }
    ]
  );
});

test("Windows paths convert to WSL mount paths", () => {
  assert.equal(
    windowsPathToWslPath("C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\codex.exe"),
    "/mnt/c/Users/test/AppData/Local/CodexAgentsOffice/cache/codex.exe"
  );
});
