import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { getAppDataDirectory } from "./app-settings";
import { canonicalizeProjectPath, projectPathIdentityKey } from "./project-paths";

export const LEGACY_PROJECT_STORAGE_DIRECTORY = ".codex-agents";

function slugifyProjectLabel(projectRoot: string): string {
  const canonicalRoot = canonicalizeProjectPath(projectRoot) ?? projectRoot;
  const label = basename(canonicalRoot).trim().toLowerCase();
  const slug = label
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  return slug || "project";
}

function projectStorageKey(projectRoot: string): string {
  const canonicalRoot = canonicalizeProjectPath(projectRoot) ?? projectRoot;
  const identityKey = projectPathIdentityKey(canonicalRoot) ?? canonicalRoot;
  const hash = createHash("sha256").update(identityKey).digest("hex").slice(0, 12);
  return `${slugifyProjectLabel(canonicalRoot)}-${hash}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function getProjectStorageDir(projectRoot: string): string {
  return join(getAppDataDirectory(), "projects", projectStorageKey(projectRoot));
}

export function getLegacyProjectStorageDir(projectRoot: string): string {
  return join(projectRoot, LEGACY_PROJECT_STORAGE_DIRECTORY);
}

export function getProjectStoragePath(projectRoot: string, ...segments: string[]): string {
  return join(getProjectStorageDir(projectRoot), ...segments);
}

export function getLegacyProjectStoragePath(projectRoot: string, ...segments: string[]): string {
  return join(getLegacyProjectStorageDir(projectRoot), ...segments);
}

export async function resolveReadableProjectStoragePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const storedPath = getProjectStoragePath(projectRoot, ...segments);
  if (await pathExists(storedPath)) {
    return storedPath;
  }

  const legacyPath = getLegacyProjectStoragePath(projectRoot, ...segments);
  if (await pathExists(legacyPath)) {
    return legacyPath;
  }

  return storedPath;
}

export async function listExistingProjectStoragePaths(projectRoot: string, ...segments: string[]): Promise<string[]> {
  const candidates = [
    getProjectStoragePath(projectRoot, ...segments),
    getLegacyProjectStoragePath(projectRoot, ...segments)
  ];
  const existing: string[] = [];

  for (const candidate of candidates) {
    if (existing.includes(candidate)) {
      continue;
    }
    if (await pathExists(candidate)) {
      existing.push(candidate);
    }
  }

  return existing;
}
