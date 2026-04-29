import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, normalize } from "node:path";
import { platform } from "node:process";

import { withAppServerClient } from "./app-server";
import type { CodexThread } from "./types";

export interface DiscoveredProject {
  root: string;
  label: string;
  updatedAt: number;
  count: number;
}

const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
const MIN_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT = 100;
const MAX_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT = 400;
const CODEX_PROJECT_DISCOVERY_THREAD_MULTIPLIER = 20;

async function projectDiscoveryUpdatedAt(root: string, fallbackUpdatedAt: number): Promise<number> {
  const filesystemRoot = filesystemPathForProjectRoot(root);
  const candidatePaths = [
    filesystemRoot,
    join(filesystemRoot, ".git"),
    join(filesystemRoot, ".git", "index"),
    join(filesystemRoot, ".git", "HEAD"),
    join(filesystemRoot, ".git", "logs", "HEAD"),
    join(filesystemRoot, ".codex-agents"),
    join(filesystemRoot, ".codex-agents", "rooms.xml")
  ];
  const candidateUpdatedAt = await Promise.all(candidatePaths.map(async (path) => {
    try {
      const entry = await stat(path);
      return Math.floor(entry.mtimeMs / 1000);
    } catch {
      return 0;
    }
  }));
  return Math.max(fallbackUpdatedAt, ...candidateUpdatedAt);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function normalizeProjectPath(value: string): string {
  return trimTrailingSlash(normalize(value).replace(/\\/g, "/"));
}

function isWindowsBackedWslPath(value: string): boolean {
  return /^\/mnt\/[a-z]\//i.test(value);
}

function filesystemPathForProjectRoot(root: string): string {
  const match = root.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (platform !== "win32" || !match) {
    return root;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

function unwrapCodexDesktopProjectPath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/");
  const embeddedWindowsDriveMatch = normalized.match(/(?:^|\/)([a-zA-Z]:\/.*)$/);
  if (embeddedWindowsDriveMatch) {
    return embeddedWindowsDriveMatch[1];
  }

  const embeddedWslMatches = normalized.match(/\/mnt\/[a-z]\/[^?]*/ig);
  if (embeddedWslMatches && embeddedWslMatches.length > 0) {
    return embeddedWslMatches[embeddedWslMatches.length - 1];
  }

  return raw;
}

export function canonicalizeProjectPath(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const raw = unwrapCodexDesktopProjectPath(input.trim());
  if (!raw) {
    return null;
  }

  const extendedWindowsRaw = raw.replace(/^[/\\]+\?[/\\]/, "");
  const nestedWindowsMountMatch = extendedWindowsRaw.match(/^[a-zA-Z]:[\\/]+mnt[\\/]+([a-zA-Z])[\\/](.*)$/);
  if (nestedWindowsMountMatch) {
    const drive = nestedWindowsMountMatch[1].toLowerCase();
    const rest = nestedWindowsMountMatch[2].replace(/\\/g, "/");
    return normalizeProjectPath(`/mnt/${drive}/${rest}`);
  }

  const rawWithoutExtendedPrefix = extendedWindowsRaw;

  const windowsBackedAbsoluteWslMatch = rawWithoutExtendedPrefix.match(/^[\\/]+mnt[\\/]+([a-zA-Z])[\\/](.*)$/);
  if (windowsBackedAbsoluteWslMatch) {
    const drive = windowsBackedAbsoluteWslMatch[1].toLowerCase();
    const rest = windowsBackedAbsoluteWslMatch[2].replace(/\\/g, "/");
    return normalizeProjectPath(`/mnt/${drive}/${rest}`);
  }

  const windowsDriveMatch = rawWithoutExtendedPrefix.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1].toLowerCase();
    const rest = windowsDriveMatch[2].replace(/\\/g, "/");
    return normalizeProjectPath(`/mnt/${drive}/${rest}`);
  }

  if (rawWithoutExtendedPrefix.startsWith("/")) {
    return normalizeProjectPath(rawWithoutExtendedPrefix.replace(/\\/g, "/"));
  }

  return trimTrailingSlash(rawWithoutExtendedPrefix.replace(/\\/g, "/"));
}

export function projectPathIdentityKey(input: string | null | undefined): string | null {
  const canonical = canonicalizeProjectPath(input);
  if (!canonical) {
    return null;
  }

  return isWindowsBackedWslPath(canonical)
    ? canonical.toLowerCase()
    : canonical;
}

export function projectLabelFromRoot(projectRoot: string): string {
  return humanizeProjectLabel(basename(projectRoot) || projectRoot);
}

export function humanizeProjectLabel(label: string): string {
  const normalized = String(label || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function decodeTomlBasicString(input: string): string {
  return input.replace(/\\(["\\btnfr])/g, (_match, escape) => {
    switch (escape) {
      case "b":
        return "\b";
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "f":
        return "\f";
      case "r":
        return "\r";
      default:
        return escape;
    }
  });
}

export function extractCodexConfiguredProjectRoots(configText: string): string[] {
  const roots: string[] = [];
  const seenRoots = new Set<string>();
  const matcher = /^\[projects\."((?:[^"\\]|\\.)+)"\]\s*$/gm;

  for (const match of configText.matchAll(matcher)) {
    const decodedRoot = decodeTomlBasicString(match[1] ?? "");
    const root = canonicalizeProjectPath(decodedRoot);
    const identityKey = projectPathIdentityKey(root);
    if (!root || !identityKey || seenRoots.has(identityKey)) {
      continue;
    }
    seenRoots.add(identityKey);
    roots.push(root);
  }

  return roots;
}

export function sameProjectPath(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftKey = projectPathIdentityKey(left);
  const rightKey = projectPathIdentityKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function filterThreadsForProject(projectRoot: string, threads: CodexThread[]): CodexThread[] {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return [];
  }

  return threads.filter((thread) => sameProjectPath(thread.cwd, canonicalRoot));
}

export function codexProjectDiscoveryThreadLimit(projectLimit: number): number {
  const normalizedLimit = Number.isFinite(projectLimit)
    ? Math.max(1, Math.floor(projectLimit))
    : 20;
  return Math.max(
    normalizedLimit,
    Math.min(
      MAX_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT,
      Math.max(MIN_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT, normalizedLimit * CODEX_PROJECT_DISCOVERY_THREAD_MULTIPLIER)
    )
  );
}

export async function discoverCodexConfiguredProjects(
  limit = 200,
  configPath = CODEX_CONFIG_PATH
): Promise<DiscoveredProject[]> {
  let configText = "";
  let configUpdatedAt = 0;

  try {
    const [rawConfig, stats] = await Promise.all([
      readFile(configPath, "utf8"),
      stat(configPath)
    ]);
    configText = rawConfig;
    configUpdatedAt = Math.floor(stats.mtimeMs / 1000);
  } catch {
    return [];
  }

  const configuredRoots = extractCodexConfiguredProjectRoots(configText);
  const existingProjects = (
    await Promise.all(configuredRoots.map(async (root) => {
      try {
        const entry = await stat(filesystemPathForProjectRoot(root));
        if (!entry.isDirectory()) {
          return null;
        }
        return {
          root,
          updatedAt: await projectDiscoveryUpdatedAt(root, configUpdatedAt)
        };
      } catch {
        return null;
      }
    }))
  ).filter((project): project is { root: string; updatedAt: number } => Boolean(project));

  return existingProjects
    .slice(0, Math.max(0, limit))
    .map(({ root, updatedAt }) => ({
      root,
      label: projectLabelFromRoot(root),
      updatedAt,
      count: 0
    }));
}

export async function discoverCodexProjects(limit = 20): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();
  const threadLimit = codexProjectDiscoveryThreadLimit(limit);

  await withAppServerClient(async (client) => {
    const threads = await client.listThreads({ limit: threadLimit });
    for (const thread of threads) {
      const root = canonicalizeProjectPath(thread.cwd);
      if (!root) {
        continue;
      }

      const identityKey = projectPathIdentityKey(root);
      if (!identityKey) {
        continue;
      }

      const existing = projects.get(identityKey);
      if (existing) {
        existing.updatedAt = Math.max(existing.updatedAt, thread.updatedAt);
        existing.count += 1;
        continue;
      }

      projects.set(identityKey, {
        root,
        label: projectLabelFromRoot(root),
        updatedAt: thread.updatedAt,
        count: 1
      });
    }
  });

  return [...projects.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function discoverProjects(limit = 20): Promise<DiscoveredProject[]> {
  const merged = new Map<string, DiscoveredProject>();
  const { PROJECT_ADAPTERS } = await import("./adapters");
  const discoveredProjectLists: DiscoveredProject[][] = await Promise.all([
    discoverCodexConfiguredProjects(limit).catch(() => []),
    discoverCodexProjects(limit).catch(() => []),
    ...PROJECT_ADAPTERS
      .filter((adapter) => typeof adapter.discoverProjects === "function")
      .map((adapter) => adapter.discoverProjects!(limit).catch(() => [] as DiscoveredProject[]))
  ]);

  for (const project of discoveredProjectLists.flat()) {
    const identityKey = projectPathIdentityKey(project.root);
    if (!identityKey) {
      continue;
    }

    const existing = merged.get(identityKey);
    if (existing) {
      if (project.count > 0 || existing.count === 0) {
        existing.updatedAt = Math.max(existing.updatedAt, project.updatedAt);
      }
      existing.count += project.count;
      continue;
    }

    merged.set(identityKey, { ...project });
  }

  return [...merged.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}
