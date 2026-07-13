import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { normalizeRepositoryUrl } from "./cursor";
import { canonicalizeProjectPath, projectLabelFromRoot } from "./project-paths";
import type { ProjectIdentity } from "./types";

const execFileAsync = promisify(execFile);
const CLAUDE_SCRATCHPAD_PATH = /^\/private\/tmp\/claude-[^/]+\/([^/]+)\/([0-9a-f-]{36})\/scratchpad\/([^/]+)(?:\/|$)/i;
const CLAUDE_TRANSCRIPT_PREFIX_BYTES = 256 * 1024;

function repoNameFromUrl(repoUrl: string | null): string | null {
  if (!repoUrl) {
    return null;
  }
  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    const segments = repoUrl.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  }
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, ...args], { windowsHide: true });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function resolveGitPath(projectRoot: string, value: string | null): string | null {
  if (!value) {
    return null;
  }
  const absolute = value.startsWith("/") ? value : resolve(projectRoot, value);
  return canonicalizeProjectPath(absolute);
}

function branchDerivedWorktreeName(branch: string | null): string | null {
  const normalizedBranch = String(branch ?? "").trim();
  if (!normalizedBranch || normalizedBranch === "HEAD" || normalizedBranch === "main" || normalizedBranch === "master") {
    return null;
  }

  const parts = normalizedBranch.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  if (parts[0]?.toLowerCase() === "codex" && parts.length > 1) {
    return parts.slice(1).join("/");
  }

  return normalizedBranch;
}

function deriveWorktreeName(input: {
  projectRoot: string;
  gitRoot: string;
  commonGitDir: string | null;
  absoluteGitDir: string | null;
  branch: string | null;
}): string | null {
  const commonGitDir = canonicalizeProjectPath(input.commonGitDir);
  const absoluteGitDir = canonicalizeProjectPath(input.absoluteGitDir);
  if (!commonGitDir || !absoluteGitDir || commonGitDir === absoluteGitDir) {
    return null;
  }

  const branchName = branchDerivedWorktreeName(input.branch);
  if (branchName) {
    return branchName;
  }

  const repoBase = basename(input.gitRoot) || basename(input.projectRoot) || "repo";
  const projectLeaf = basename(input.projectRoot);
  if (projectLeaf && projectLeaf !== repoBase) {
    return projectLeaf;
  }

  const adminLeaf = basename(absoluteGitDir);
  if (adminLeaf && adminLeaf !== repoBase && adminLeaf !== ".git") {
    return adminLeaf;
  }

  const parentLeaf = basename(dirname(input.projectRoot));
  if (
    parentLeaf
    && parentLeaf !== repoBase
    && parentLeaf !== ".git"
    && parentLeaf !== ".codex"
    && parentLeaf !== "worktrees"
  ) {
    return parentLeaf;
  }

  return projectLeaf || adminLeaf || "worktree";
}

export async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity | null> {
  const directGitRoot = resolveGitPath(projectRoot, await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]));
  const scratchpad = directGitRoot ? null : await resolveClaudeScratchpadOwner(projectRoot);
  const identityRoot = scratchpad?.ownerRoot ?? projectRoot;
  const gitRoot = directGitRoot ?? resolveGitPath(identityRoot, await gitOutput(identityRoot, ["rev-parse", "--show-toplevel"]));
  if (!gitRoot) {
    return null;
  }

  const commonGitDir = resolveGitPath(identityRoot, await gitOutput(identityRoot, ["rev-parse", "--git-common-dir"]));
  const absoluteGitDir = resolveGitPath(identityRoot, await gitOutput(identityRoot, ["rev-parse", "--absolute-git-dir"]));
  const repoUrl = normalizeRepositoryUrl(await gitOutput(identityRoot, ["config", "--get", "remote.origin.url"]));
  const branch = await gitOutput(identityRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const rootCommit = await gitOutput(identityRoot, ["rev-list", "--max-parents=0", "HEAD"]);
  const repoName = repoNameFromUrl(repoUrl) ?? basename(gitRoot) ?? projectLabelFromRoot(projectRoot);
  const worktreeName = scratchpad?.worktreeName ?? deriveWorktreeName({
    projectRoot,
    gitRoot,
    commonGitDir,
    absoluteGitDir,
    branch
  });

  return {
    key: repoUrl ?? commonGitDir ?? gitRoot,
    source: repoUrl ? "git" : "unknown",
    rootCommit,
    gitRoot,
    commonGitDir,
    repoUrl,
    repoName,
    branch,
    worktreeName
  };
}

export interface ClaudeScratchpadOwner {
  ownerRoot: string;
  worktreeName: string;
}

export async function resolveClaudeScratchpadOwner(
  projectRoot: string,
  claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), ".claude")
): Promise<ClaudeScratchpadOwner | null> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  const match = canonicalRoot?.match(CLAUDE_SCRATCHPAD_PATH);
  if (!match) {
    return null;
  }

  const [, encodedOwner, sessionId, worktreeName] = match;
  const transcriptPath = resolve(claudeConfigDir, "projects", encodedOwner, `${sessionId}.jsonl`);
  let handle;
  try {
    handle = await open(transcriptPath, "r");
    const buffer = Buffer.alloc(CLAUDE_TRANSCRIPT_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line) as { cwd?: unknown; sessionId?: unknown };
        if (record.sessionId !== sessionId || typeof record.cwd !== "string") {
          continue;
        }
        const ownerRoot = canonicalizeProjectPath(record.cwd);
        if (ownerRoot && !CLAUDE_SCRATCHPAD_PATH.test(ownerRoot)) {
          return { ownerRoot, worktreeName };
        }
      } catch {
        // A partial final line is expected when the prefix ends mid-record.
      }
    }
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return null;
}
