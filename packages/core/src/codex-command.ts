import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CodexCommandCandidate {
  command: string;
  label: string;
  argsPrefix?: string[];
}

export function buildCodexCommandCandidates(input: {
  platform: NodeJS.Platform;
  codexCliPath?: string | null;
  macAppBundlePaths?: string[];
  windowsWslCommand?: string[] | null;
  windowsAppPath?: string | null;
}): CodexCommandCandidate[] {
  const candidates: CodexCommandCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    command: string | null | undefined,
    label: string,
    argsPrefix?: string[] | null
  ): void => {
    if (typeof command !== "string") {
      return;
    }
    const normalized = command.trim();
    const normalizedArgsPrefix = (argsPrefix ?? []).filter((value) => typeof value === "string" && value.trim().length > 0);
    const candidateKey = [normalized, ...normalizedArgsPrefix].join("\u0000");
    if (!normalized || seen.has(candidateKey)) {
      return;
    }
    seen.add(candidateKey);
    candidates.push(
      normalizedArgsPrefix.length > 0
        ? { command: normalized, label, argsPrefix: normalizedArgsPrefix }
        : { command: normalized, label }
    );
  };

  pushCandidate(input.codexCliPath, "CODEX_CLI_PATH override");
  if (input.platform === "win32") {
    pushCandidate("codex.cmd", "Codex CLI cmd shim on PATH");
    pushCandidate("codex.exe", "Codex CLI executable on PATH");
  } else {
    pushCandidate("codex", "Codex CLI on PATH");
  }
  if (input.platform === "win32") {
    const windowsWslCommand = input.windowsWslCommand ?? null;
    pushCandidate(
      Array.isArray(windowsWslCommand) ? "wsl.exe" : null,
      "Codex CLI via WSL",
      windowsWslCommand
    );
    pushCandidate(
      Array.isArray(windowsWslCommand) ? "C:\\Windows\\System32\\wsl.exe" : null,
      "Codex CLI via WSL",
      windowsWslCommand
    );
  }

  if (input.platform === "darwin") {
    for (const bundlePath of input.macAppBundlePaths ?? []) {
      pushCandidate(bundlePath, "Codex app bundle");
    }
  }

  pushCandidate(input.windowsAppPath, "Codex Windows app bundle");

  return candidates;
}

export function isWslLikeEnvironment(): boolean {
  if (platform !== "linux") {
    return false;
  }

  const osRelease = release().toLowerCase();
  return Boolean(process.env.WSL_DISTRO_NAME)
    || osRelease.includes("microsoft")
    || osRelease.includes("wsl");
}

export function windowsPathToWslPath(windowsPath: string): string {
  const trimmed = windowsPath.trim();
  const driveMatch = /^([A-Za-z]):\\(.*)$/.exec(trimmed);
  if (!driveMatch) {
    return trimmed.replace(/\\/g, "/");
  }

  const [, drive, tail] = driveMatch;
  return `/mnt/${drive.toLowerCase()}/${tail.replace(/\\/g, "/")}`;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function listCodexCommandCandidates(): Promise<CodexCommandCandidate[]> {
  const macAppBundlePaths: string[] = [];
  let windowsWslCommand: string[] | null = null;
  let windowsAppPath: string | null = null;

  if (platform === "darwin") {
    const bundleCandidates = [
      "/Applications/Codex.app/Contents/Resources/codex",
      join(homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex")
    ];

    for (const bundlePath of bundleCandidates) {
      if (await isExecutable(bundlePath)) {
        macAppBundlePaths.push(bundlePath);
      }
    }
  }

  if (platform === "win32") {
    windowsWslCommand = await resolveWindowsWslCodexCommand().catch(() => null);
  }

  if (platform === "win32" || isWslLikeEnvironment()) {
    windowsAppPath = await resolveWindowsAppCodexPath().catch(() => null);
  }

  return buildCodexCommandCandidates({
    platform,
    codexCliPath: process.env.CODEX_CLI_PATH,
    macAppBundlePaths,
    windowsWslCommand,
    windowsAppPath
  });
}

async function resolveWindowsWslCodexCommand(): Promise<string[] | null> {
  const candidates = [
    "wsl.exe",
    "C:\\Windows\\System32\\wsl.exe"
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--exec", "sh", "-lc", "command -v codex >/dev/null 2>&1"]);
      return ["--exec", "codex"];
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function resolveWindowsAppCodexPath(): Promise<string | null> {
  const script = [
    "$pkg = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1",
    "if (-not $pkg) { return }",
    "$src = Join-Path $pkg.InstallLocation 'app\\resources'",
    "$cacheRoot = Join-Path $env:LOCALAPPDATA ('CodexAgentsOffice\\cache\\windows-store\\' + $pkg.Version)",
    "$dst = Join-Path $cacheRoot 'resources'",
    "$exe = Join-Path $dst 'codex.exe'",
    "if (-not (Test-Path $exe)) {",
    "  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null",
    "  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }",
    "  Copy-Item $src $dst -Recurse",
    "}",
    "[Console]::Out.WriteLine($exe)"
  ].join("; ");

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);
  const windowsPath = stdout.trim();
  if (!windowsPath) {
    return null;
  }

  return isWslLikeEnvironment() ? windowsPathToWslPath(windowsPath) : windowsPath;
}

function formatSpawnError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details = "code" in error && typeof (error as NodeJS.ErrnoException).code === "string"
    ? ` (${(error as NodeJS.ErrnoException).code})`
    : "";
  return `${error.message}${details}`;
}

function codexResolutionHint(): string {
  if (platform === "darwin") {
    return "Install Codex CLI, set CODEX_CLI_PATH, or install the Codex app in /Applications.";
  }
  if (platform === "win32") {
    return "Install Codex CLI, install the Codex Windows app, install Codex CLI inside WSL, or set CODEX_CLI_PATH to a runnable Codex executable.";
  }
  if (isWslLikeEnvironment()) {
    return "Install Codex CLI, install the Codex Windows app, or set CODEX_CLI_PATH to a runnable Codex executable.";
  }
  return "Install Codex CLI or set CODEX_CLI_PATH to a runnable Codex executable.";
}

function buildResolutionError(errors: string[]): Error {
  const detail = errors.length > 0 ? ` Tried: ${errors.join("; ")}` : "";
  return new Error(`Unable to start Codex command.${detail} ${codexResolutionHint()}`.trim());
}

async function spawnCandidate(
  candidate: CodexCommandCandidate,
  args: string[]
): Promise<ChildProcessWithoutNullStreams> {
  return await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
    const child = spawn(candidate.command, [...(candidate.argsPrefix ?? []), ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const onSpawn = (): void => {
      child.off("error", onError);
      resolve(child);
    };

    const onError = (error: Error): void => {
      child.off("spawn", onSpawn);
      reject(error);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

export async function spawnCodexProcess(
  args: string[]
): Promise<{ child: ChildProcessWithoutNullStreams; candidate: CodexCommandCandidate }> {
  const candidates = await listCodexCommandCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const child = await spawnCandidate(candidate, args);
      return { child, candidate };
    } catch (error) {
      errors.push(`${candidate.label}: ${formatSpawnError(error)}`);
    }
  }

  throw buildResolutionError(errors);
}

export async function execCodex(args: string[]): Promise<{ stdout: string; stderr: string; candidate: CodexCommandCandidate }> {
  const candidates = await listCodexCommandCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate.command, [...(candidate.argsPrefix ?? []), ...args]);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        candidate
      };
    } catch (error) {
      errors.push(`${candidate.label}: ${formatSpawnError(error)}`);
    }
  }

  throw buildResolutionError(errors);
}
