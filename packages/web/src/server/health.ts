import type { ProviderHealth, ProviderHealthStatus } from "@agents-tower/core";

import type { FleetResponse, MultiplayerStatus, ServerOptions } from "./server-types";
import { buildFleetPulse, type FleetPulse } from "./pulse";

export type FleetHealthStatus = "healthy" | "starting" | "degraded" | "stale";

export const SNAPSHOT_STALE_AFTER_MS = 2 * 60 * 1000;
const FLEET_NOTE_LIMIT = 10;

export interface HealthBuildIdentity {
  pid: number;
  startedAt: string;
  buildAt: string;
  version: string;
}

export interface ProjectHealthSummary {
  projectRoot: string;
  projectLabel: string;
  generatedAt: string;
  snapshotAgeMs: number;
  status: FleetHealthStatus;
  providers: ProviderHealth[];
}

export interface ProviderHealthRollup {
  adapterId: string;
  provider: string;
  status: ProviderHealthStatus;
  detail: string | null;
  lastUpdatedAt: string | null;
  degradedProjects: number;
}

export interface HealthResponse extends HealthBuildIdentity {
  generatedAt: string;
  status: FleetHealthStatus;
  host: string;
  port: number;
  projectCount: number;
  projects: ProjectHealthSummary[];
  providers: ProviderHealthRollup[];
  notes: string[];
  pulse: FleetPulse;
  multiplayer: MultiplayerStatus;
}

const STATUS_SEVERITY: Record<ProviderHealthStatus, number> = {
  ready: 0,
  unconfigured: 1,
  degraded: 2,
  error: 3
};

function degradesProject(status: ProviderHealthStatus): boolean {
  return status === "degraded" || status === "error";
}

function snapshotAgeMs(generatedAt: string, nowMs: number): number {
  const generatedMs = Date.parse(generatedAt);
  return Number.isFinite(generatedMs) ? Math.max(0, nowMs - generatedMs) : Number.POSITIVE_INFINITY;
}

function projectStatus(ageMs: number, providers: ProviderHealth[]): FleetHealthStatus {
  if (ageMs > SNAPSHOT_STALE_AFTER_MS) {
    return "stale";
  }
  if (providers.some((provider) => degradesProject(provider.status))) {
    return "degraded";
  }
  return "healthy";
}

function rollupProviders(projects: ProjectHealthSummary[]): ProviderHealthRollup[] {
  const rollups = new Map<string, ProviderHealthRollup>();
  for (const project of projects) {
    for (const provider of project.providers) {
      const existing = rollups.get(provider.adapterId);
      if (!existing) {
        rollups.set(provider.adapterId, {
          adapterId: provider.adapterId,
          provider: provider.provider,
          status: provider.status,
          detail: provider.detail,
          lastUpdatedAt: provider.lastUpdatedAt,
          degradedProjects: degradesProject(provider.status) ? 1 : 0
        });
        continue;
      }
      if (degradesProject(provider.status)) {
        existing.degradedProjects += 1;
      }
      if (STATUS_SEVERITY[provider.status] > STATUS_SEVERITY[existing.status]) {
        existing.status = provider.status;
        existing.detail = provider.detail;
      }
      if ((provider.lastUpdatedAt ?? "") > (existing.lastUpdatedAt ?? "")) {
        existing.lastUpdatedAt = provider.lastUpdatedAt;
      }
    }
  }
  return Array.from(rollups.values()).sort((left, right) => left.adapterId.localeCompare(right.adapterId));
}

function fleetStatus(fleet: FleetResponse | null, projects: ProjectHealthSummary[]): FleetHealthStatus {
  if (!fleet) {
    return "starting";
  }
  if (projects.some((project) => project.status === "stale")) {
    return "stale";
  }
  if (projects.some((project) => project.status === "degraded")) {
    return "degraded";
  }
  return "healthy";
}

export function buildHealthResponse(input: {
  options: ServerOptions;
  fleet: FleetResponse | null;
  multiplayer: MultiplayerStatus;
  identity: HealthBuildIdentity;
  nowMs?: number;
}): HealthResponse {
  const nowMs = input.nowMs ?? Date.now();
  const snapshots = input.fleet?.projects ?? [];
  const projects: ProjectHealthSummary[] = snapshots.map((snapshot) => {
    const ageMs = snapshotAgeMs(snapshot.generatedAt, nowMs);
    return {
      projectRoot: snapshot.projectRoot,
      projectLabel: snapshot.projectLabel,
      generatedAt: snapshot.generatedAt,
      snapshotAgeMs: ageMs,
      status: projectStatus(ageMs, snapshot.providerHealth),
      providers: snapshot.providerHealth
    };
  });
  const notes = Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.notes))).slice(0, FLEET_NOTE_LIMIT);

  return {
    ...input.identity,
    generatedAt: new Date(nowMs).toISOString(),
    status: fleetStatus(input.fleet, projects),
    host: input.options.host,
    port: input.options.port,
    projectCount: projects.length,
    projects,
    providers: rollupProviders(projects),
    notes,
    pulse: buildFleetPulse(input.fleet, nowMs),
    multiplayer: input.multiplayer
  };
}
