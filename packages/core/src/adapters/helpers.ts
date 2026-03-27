import type { AdapterHealth, AdapterSnapshot } from "./types";
import type { CloudTask, DashboardAgent, DashboardEvent } from "../types";

export function readyHealth(detail: string | null = null, generatedAt = new Date().toISOString()): AdapterHealth {
  return {
    status: "ready",
    detail,
    lastUpdatedAt: generatedAt
  };
}

export function degradedHealth(detail: string, generatedAt = new Date().toISOString()): AdapterHealth {
  return {
    status: "degraded",
    detail,
    lastUpdatedAt: generatedAt
  };
}

export function emptyAdapterSnapshot(input: {
  adapterId: string;
  source: DashboardAgent["source"];
  detail?: string | null;
  health?: AdapterHealth;
  agents?: DashboardAgent[];
  events?: DashboardEvent[];
  notes?: string[];
  cloudTasks?: CloudTask[];
  generatedAt?: string;
}): AdapterSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    adapterId: input.adapterId,
    source: input.source,
    generatedAt,
    agents: input.agents ?? [],
    events: input.events ?? [],
    notes: input.notes ?? [],
    cloudTasks: input.cloudTasks ?? [],
    health: input.health ?? readyHealth(input.detail ?? null, generatedAt)
  };
}

