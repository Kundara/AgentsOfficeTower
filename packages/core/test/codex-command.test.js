const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCodexCommandCandidates,
  windowsPathToWslPath
} = require("../dist/codex-command.js");

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

test("macOS candidates include the app bundle after PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "darwin",
      macAppBundlePaths: ["/Applications/Codex.app/Contents/Resources/codex"]
    }),
    [
      { command: "codex", label: "Codex CLI on PATH" },
      {
        command: "/Applications/Codex.app/Contents/Resources/codex",
        label: "Codex app bundle"
      }
    ]
  );
});

test("Windows app bundle candidate is included after PATH", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "win32",
      windowsAppPath: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe"
    }),
    [
      { command: "codex.cmd", label: "Codex CLI on PATH" },
      {
        command: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe",
        label: "Codex Windows app bundle"
      }
    ]
  );
});

test("Windows candidates include a WSL Codex fallback before the app bundle", () => {
  assert.deepEqual(
    buildCodexCommandCandidates({
      platform: "win32",
      windowsWslCommand: ["--exec", "codex"],
      windowsAppPath: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe"
    }),
    [
      { command: "codex.cmd", label: "Codex CLI on PATH" },
      { command: "wsl.exe", label: "Codex CLI via WSL", argsPrefix: ["--exec", "codex"] },
      {
        command: "C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\windows-store\\1.2.3\\resources\\codex.exe",
        label: "Codex Windows app bundle"
      }
    ]
  );
});

test("Windows paths convert to WSL mount paths", () => {
  assert.equal(
    windowsPathToWslPath("C:\\Users\\test\\AppData\\Local\\CodexAgentsOffice\\cache\\codex.exe"),
    "/mnt/c/Users/test/AppData/Local/CodexAgentsOffice/cache/codex.exe"
  );
});
