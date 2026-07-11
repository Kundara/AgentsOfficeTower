import type { AdapterSnapshot, ProjectAdapter, ProjectSource } from "./types";

export const PROVIDER_CONTRACT_VERSION = 1;

const VALID_HEALTH_STATUSES = new Set(["ready", "unconfigured", "degraded", "error"]);
const VALID_CONFIDENCES = new Set(["typed", "inferred"]);

export interface ContractCheckOptions {
  projectRoot?: string;
  refreshTimeoutMs?: number;
}

function checkSnapshotShape(snapshot: AdapterSnapshot, adapterId: string, failures: string[]): void {
  if (!snapshot || typeof snapshot !== "object") {
    failures.push(`${adapterId}: getCachedSnapshot() must return an AdapterSnapshot object`);
    return;
  }
  if (snapshot.adapterId !== adapterId) {
    failures.push(`${adapterId}: snapshot.adapterId must equal the adapter id (got ${String(snapshot.adapterId)})`);
  }
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) {
    failures.push(`${adapterId}: snapshot.generatedAt must be a parseable ISO timestamp`);
  }
  for (const field of ["agents", "events", "notes"] as const) {
    if (!Array.isArray(snapshot[field])) {
      failures.push(`${adapterId}: snapshot.${field} must be an array`);
    }
  }
  if (!snapshot.health || !VALID_HEALTH_STATUSES.has(snapshot.health.status)) {
    failures.push(`${adapterId}: snapshot.health.status must be one of ${Array.from(VALID_HEALTH_STATUSES).join("/")}`);
  }
  if (snapshot.health && snapshot.health.status !== "ready" && !snapshot.health.detail) {
    failures.push(`${adapterId}: non-ready health must carry a human-readable detail`);
  }
  for (const agent of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
    if (!VALID_CONFIDENCES.has(agent.confidence)) {
      failures.push(`${adapterId}: agent ${agent.id} confidence must be typed or inferred`);
      break;
    }
  }
}

export function validateAdapterShape(adapter: ProjectAdapter): string[] {
  const failures: string[] = [];
  if (!adapter || typeof adapter !== "object") {
    return ["adapter must be an object"];
  }
  if (typeof adapter.id !== "string" || adapter.id.length === 0) {
    failures.push("adapter.id must be a non-empty string");
  }
  if (typeof adapter.source !== "string" || adapter.source.length === 0) {
    failures.push(`${adapter.id ?? "adapter"}: source must be a non-empty string`);
  }
  if (!adapter.capabilities || typeof adapter.capabilities !== "object") {
    failures.push(`${adapter.id}: capabilities must be an object (empty object is fine)`);
  }
  if (typeof adapter.createSource !== "function") {
    failures.push(`${adapter.id}: createSource(context) must be a function`);
  }
  if (adapter.capabilities?.discoverProjects === true && typeof adapter.discoverProjects !== "function") {
    failures.push(`${adapter.id}: capabilities.discoverProjects requires a discoverProjects() implementation`);
  }
  return failures;
}

export async function runAdapterContractChecks(
  adapter: ProjectAdapter,
  options: ContractCheckOptions = {}
): Promise<string[]> {
  const failures = validateAdapterShape(adapter);
  if (failures.length > 0) {
    return failures;
  }

  const projectRoot = options.projectRoot ?? "/tmp/agents-tower-contract-fixture";
  const refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;

  let source: ProjectSource;
  try {
    source = adapter.createSource({ projectRoot });
  } catch (error) {
    failures.push(`${adapter.id}: createSource threw synchronously: ${error instanceof Error ? error.message : String(error)}`);
    return failures;
  }

  for (const method of ["warm", "refresh", "getCachedSnapshot", "dispose"] as const) {
    if (typeof source[method] !== "function") {
      failures.push(`${adapter.id}: source.${method} must be a function`);
    }
  }
  if (failures.length > 0) {
    return failures;
  }

  checkSnapshotShape(source.getCachedSnapshot(), adapter.id, failures);

  try {
    await Promise.race([
      source.refresh("manual"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("refresh timed out")), refreshTimeoutMs))
    ]);
  } catch (error) {
    failures.push(
      `${adapter.id}: refresh("manual") must resolve without throwing (providers report failures via degraded/error health): `
      + (error instanceof Error ? error.message : String(error))
    );
  }

  checkSnapshotShape(source.getCachedSnapshot(), adapter.id, failures);

  try {
    await source.dispose();
  } catch (error) {
    failures.push(`${adapter.id}: dispose() must resolve without throwing: ${error instanceof Error ? error.message : String(error)}`);
  }

  return failures;
}
