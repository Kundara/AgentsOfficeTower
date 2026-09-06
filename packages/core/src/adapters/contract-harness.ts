import type { AdapterSnapshot, ProjectAdapter, ProjectSource } from "./types";

export const PROVIDER_CONTRACT_VERSION = 1;

const VALID_HEALTH_STATUSES = new Set(["ready", "unconfigured", "degraded", "error"]);
const VALID_CONFIDENCES = new Set(["typed", "inferred"]);

export interface ContractCheckOptions {
  projectRoot?: string;
  /** Per-operation budget for warm, refresh, and dispose. */
  refreshTimeoutMs?: number;
}

function checkSnapshotShape(snapshot: AdapterSnapshot, adapter: ProjectAdapter, failures: string[]): void {
  const adapterId = adapter.id;
  if (!snapshot || typeof snapshot !== "object") {
    failures.push(`${adapterId}: getCachedSnapshot() must return an AdapterSnapshot object`);
    return;
  }
  if (snapshot.adapterId !== adapterId) {
    failures.push(`${adapterId}: snapshot.adapterId must equal the adapter id (got ${String(snapshot.adapterId)})`);
  }
  if (snapshot.source !== adapter.source) {
    failures.push(`${adapterId}: snapshot.source must equal the adapter source`);
  }
  if (typeof snapshot.generatedAt !== "string" || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    failures.push(`${adapterId}: snapshot.generatedAt must be a parseable ISO timestamp`);
  }
  for (const field of ["agents", "events", "notes"] as const) {
    if (!Array.isArray(snapshot[field])) failures.push(`${adapterId}: snapshot.${field} must be an array`);
  }
  if (snapshot.cloudTasks !== undefined && !Array.isArray(snapshot.cloudTasks)) {
    failures.push(`${adapterId}: snapshot.cloudTasks must be an array when present`);
  }
  if (!snapshot.health || !VALID_HEALTH_STATUSES.has(snapshot.health.status)) {
    failures.push(`${adapterId}: snapshot.health.status must be one of ${Array.from(VALID_HEALTH_STATUSES).join("/")}`);
  }
  if (snapshot.health && snapshot.health.status !== "ready"
    && (typeof snapshot.health.detail !== "string" || !snapshot.health.detail.trim())) {
    failures.push(`${adapterId}: non-ready health must carry a human-readable detail`);
  }
  if (snapshot.health && snapshot.health.lastUpdatedAt !== null
    && (typeof snapshot.health.lastUpdatedAt !== "string" || !Number.isFinite(Date.parse(snapshot.health.lastUpdatedAt)))) {
    failures.push(`${adapterId}: snapshot.health.lastUpdatedAt must be null or a parseable timestamp`);
  }
  for (const agent of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
    if (!agent || !VALID_CONFIDENCES.has(agent.confidence)) {
      failures.push(`${adapterId}: agent ${agent?.id ?? "(invalid)"} confidence must be typed or inferred`);
      break;
    }
  }
}

export function validateAdapterShape(adapter: ProjectAdapter): string[] {
  const failures: string[] = [];
  if (!adapter || typeof adapter !== "object") return ["adapter must be an object"];
  if (typeof adapter.id !== "string" || !adapter.id.trim()) failures.push("adapter.id must be a non-empty string");
  if (typeof adapter.source !== "string" || !adapter.source.trim()) failures.push(`${adapter.id ?? "adapter"}: source must be a non-empty string`);
  if (!adapter.capabilities || typeof adapter.capabilities !== "object" || Array.isArray(adapter.capabilities)) {
    failures.push(`${adapter.id}: capabilities must be an object (empty object is fine)`);
  }
  if (typeof adapter.createSource !== "function") failures.push(`${adapter.id}: createSource(context) must be a function`);
  if (adapter.capabilities?.discoverProjects === true && typeof adapter.discoverProjects !== "function") {
    failures.push(`${adapter.id}: capabilities.discoverProjects requires a discoverProjects() implementation`);
  }
  return failures;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bounded(operation: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runAdapterContractChecks(
  adapter: ProjectAdapter,
  options: ContractCheckOptions = {}
): Promise<string[]> {
  const failures = validateAdapterShape(adapter);
  if (failures.length > 0) return failures;
  const projectRoot = options.projectRoot ?? "/tmp/agents-tower-contract-fixture";
  const timeoutMs = options.refreshTimeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    return [`${adapter.id}: refreshTimeoutMs must be a positive finite timer budget no greater than 2147483647`];
  }
  let source: ProjectSource | undefined;
  const checkSnapshot = () => {
    try {
      checkSnapshotShape(source!.getCachedSnapshot(), adapter, failures);
    } catch (error) {
      failures.push(`${adapter.id}: getCachedSnapshot() or snapshot validation threw: ${describeError(error)}`);
    }
  };
  try {
    source = adapter.createSource({ projectRoot });
    if (!source || typeof source !== "object") {
      failures.push(`${adapter.id}: createSource() must return a ProjectSource object`);
      return failures;
    }
    for (const method of ["warm", "refresh", "getCachedSnapshot", "dispose"] as const) {
      if (typeof source[method] !== "function") failures.push(`${adapter.id}: source.${method} must be a function`);
    }
    if (source.subscribe !== undefined && typeof source.subscribe !== "function") {
      failures.push(`${adapter.id}: source.subscribe must be a function when present`);
    }
    if (adapter.capabilities.liveUpdates === true && typeof source.subscribe !== "function") {
      failures.push(`${adapter.id}: capabilities.liveUpdates requires source.subscribe()`);
    }
    if (failures.length > 0) return failures;
    checkSnapshot();
    for (const method of ["warm", "refresh"] as const) {
      try {
        await bounded(() => method === "warm" ? source!.warm() : source!.refresh("manual"), timeoutMs);
      } catch (error) {
        failures.push(`${adapter.id}: ${method === "warm" ? "warm()" : 'refresh("manual")'} must resolve without throwing (providers report failures via degraded/error health): ${describeError(error)}`);
      }
      checkSnapshot();
    }
  } catch (error) {
    failures.push(`${adapter.id}: createSource or source inspection threw: ${describeError(error)}`);
  } finally {
    try {
      if (source && typeof source.dispose === "function") await bounded(() => source!.dispose(), timeoutMs);
    } catch (error) {
      failures.push(`${adapter.id}: dispose() must resolve without throwing: ${describeError(error)}`);
    }
  }
  return failures;
}
