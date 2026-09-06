import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { getAppDataDirectory } from "./app-settings";
import { projectPathIdentityKey } from "./project-paths";
import type { CoordinationClaim, CoordinationClaimLifecycle, CoordinationClaimView } from "./types";

export const DEFAULT_CLAIM_TTL_MS = 20 * 60 * 1000;
const RESOLVED_CLAIM_RETENTION_MS = 10 * 60 * 1000;
const STALE_CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

function claimsDirectory(projectRoot: string): string {
  const hash = createHash("sha256").update(projectPathIdentityKey(projectRoot) ?? projectRoot).digest("hex").slice(0, 16);
  return join(getAppDataDirectory(), "coordination", hash);
}

function claimFilePath(projectRoot: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid coordination claim id.");
  return join(claimsDirectory(projectRoot), `${id}.json`);
}

function readClaimFile(path: string, projectRoot: string): CoordinationClaim | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CoordinationClaim;
    if (!parsed || typeof parsed.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(parsed.id)
      || path !== claimFilePath(projectRoot, parsed.id)
      || projectPathIdentityKey(parsed.projectRoot) !== projectPathIdentityKey(projectRoot)
      || typeof parsed.objective !== "string" || !parsed.objective.trim()
      || !Array.isArray(parsed.scope) || parsed.scope.some((scope) => typeof scope !== "string")
      || !["active", "released", "handoff"].includes(parsed.status)
      || [parsed.createdAt, parsed.heartbeatAt, parsed.expiresAt].some((value) => typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      || [parsed.branch, parsed.agentLabel, parsed.blockedOn].some((value) => value !== null && typeof value !== "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeClaimFile(claim: CoordinationClaim): void {
  const directory = claimsDirectory(claim.projectRoot);
  mkdirSync(directory, { recursive: true });
  const target = claimFilePath(claim.projectRoot, claim.id);
  const temporary = join(directory, `.${claim.id}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(claim, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function claimLifecycle(claim: CoordinationClaim, nowMs: number): CoordinationClaimLifecycle {
  if (claim.status === "released" || claim.status === "handoff") {
    return claim.status;
  }
  const expiresMs = Date.parse(claim.expiresAt);
  return Number.isFinite(expiresMs) && nowMs >= expiresMs ? "stale" : "active";
}

function shouldPruneClaim(claim: CoordinationClaim, lifecycle: CoordinationClaimLifecycle, nowMs: number): boolean {
  if (lifecycle === "released" || lifecycle === "handoff") {
    const heartbeatMs = Date.parse(claim.heartbeatAt);
    return !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > RESOLVED_CLAIM_RETENTION_MS;
  }
  if (lifecycle === "stale") {
    const expiresMs = Date.parse(claim.expiresAt);
    return !Number.isFinite(expiresMs) || nowMs - expiresMs > STALE_CLAIM_RETENTION_MS;
  }
  return false;
}

export function startCoordinationClaim(input: {
  projectRoot: string;
  objective: string;
  scope?: string[];
  branch?: string | null;
  agentLabel?: string | null;
  blockedOn?: string | null;
  ttlMs?: number;
  nowMs?: number;
}): CoordinationClaim {
  if (!input.objective.trim()) throw new Error("A coordination claim needs an objective.");
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = Number.isFinite(input.ttlMs) && (input.ttlMs as number) > 0 ? (input.ttlMs as number) : DEFAULT_CLAIM_TTL_MS;
  const now = new Date(nowMs).toISOString();
  const claim: CoordinationClaim = {
    id: randomUUID(),
    projectRoot: input.projectRoot,
    objective: input.objective,
    scope: input.scope?.filter(Boolean) ?? [],
    branch: input.branch ?? null,
    agentLabel: input.agentLabel ?? null,
    status: "active",
    blockedOn: input.blockedOn ?? null,
    createdAt: now,
    heartbeatAt: now,
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
  writeClaimFile(claim);
  return claim;
}

export function heartbeatCoordinationClaim(
  projectRoot: string,
  id: string,
  options: { ttlMs?: number; blockedOn?: string | null; nowMs?: number } = {}
): CoordinationClaim | null {
  const existing = readClaimFile(claimFilePath(projectRoot, id), projectRoot);
  if (!existing || existing.status !== "active") {
    return null;
  }
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) && (options.ttlMs as number) > 0 ? (options.ttlMs as number) : DEFAULT_CLAIM_TTL_MS;
  const updated: CoordinationClaim = {
    ...existing,
    blockedOn: options.blockedOn !== undefined ? options.blockedOn : existing.blockedOn,
    heartbeatAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
  writeClaimFile(updated);
  return updated;
}

export function releaseCoordinationClaim(
  projectRoot: string,
  id: string,
  options: { handoff?: boolean; nowMs?: number } = {}
): CoordinationClaim | null {
  const existing = readClaimFile(claimFilePath(projectRoot, id), projectRoot);
  if (!existing) {
    return null;
  }
  const nowMs = options.nowMs ?? Date.now();
  const updated: CoordinationClaim = {
    ...existing,
    status: options.handoff === true ? "handoff" : "released",
    heartbeatAt: new Date(nowMs).toISOString()
  };
  writeClaimFile(updated);
  return updated;
}

export function listCoordinationClaims(projectRoot: string, nowMs = Date.now()): CoordinationClaimView[] {
  const directory = claimsDirectory(projectRoot);
  if (!existsSync(directory)) {
    return [];
  }
  const views: CoordinationClaimView[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const path = join(directory, entry);
    const claim = readClaimFile(path, projectRoot);
    if (!claim) {
      continue;
    }
    const lifecycle = claimLifecycle(claim, nowMs);
    if (shouldPruneClaim(claim, lifecycle, nowMs)) {
      rmSync(path, { force: true });
      continue;
    }
    views.push({ ...claim, lifecycle });
  }
  return views.sort((left, right) => right.heartbeatAt.localeCompare(left.heartbeatAt));
}

export interface ClaimOverlapAdvice {
  verdict: "proceed" | "caution";
  reasons: string[];
  overlapping: CoordinationClaimView[];
}

// File scopes must retain task subdirectories that project grouping intentionally collapses.
function filesystemScopeKey(value: string): string {
  let path = value.trim().replace(/\\/g, "/").replace(/^\/\/\?\//, "");
  path = path.replace(/^([a-zA-Z]):\//, (_match, drive: string) => `/mnt/${drive.toLowerCase()}/`);
  const windowsBacked = /^\/mnt\/[a-z](?:\/|$)/i.test(path);
  path = posix.normalize(path);
  return windowsBacked ? path.toLowerCase() : path;
}

function normalizedScopePath(projectRoot: string, value: string): string | null {
  const scope = value.trim().replace(/\\/g, "/");
  if (!scope) return null;
  const absolute = scope.startsWith("/") || /^[a-zA-Z]:\//.test(scope);
  return filesystemScopeKey(absolute ? scope : filesystemScopeKey(projectRoot) + "/" + scope);
}

function scopesOverlap(projectRoot: string, left: string, claimRoot: string, right: string): boolean {
  const a = normalizedScopePath(projectRoot, left);
  const b = normalizedScopePath(claimRoot, right);
  if (!a || !b) return false;
  return a === b || a.startsWith(b.replace(/\/$/, "") + "/") || b.startsWith(a.replace(/\/$/, "") + "/");
}

export function adviseOnClaimOverlap(
  projectRoot: string,
  requestedScope: string[],
  nowMs = Date.now()
): ClaimOverlapAdvice {
  const claims = listCoordinationClaims(projectRoot, nowMs)
    .filter((claim) => claim.lifecycle === "active" || claim.lifecycle === "stale");
  const overlapping = claims.filter((claim) =>
    claim.scope.length > 0
    && requestedScope.some((requested) => claim.scope.some((declared) => scopesOverlap(projectRoot, requested, claim.projectRoot, declared)))
  );
  if (overlapping.length === 0) {
    return {
      verdict: "proceed",
      reasons: claims.length === 0
        ? ["No declared claims for this project."]
        : ["Declared scopes appear disjoint from the requested paths."],
      overlapping: []
    };
  }
  const reasons = overlapping.map((claim) =>
    claim.lifecycle === "stale"
      ? `Stale claim "${claim.objective}" overlaps and was not explicitly released — confirm before proceeding.`
      : `Active claim "${claim.objective}"${claim.agentLabel ? ` by ${claim.agentLabel}` : ""} overlaps the requested scope.`
  );
  return { verdict: "caution", reasons, overlapping };
}
