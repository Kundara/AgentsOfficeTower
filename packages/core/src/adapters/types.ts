import type { CloudTask, DashboardAgent, DashboardEvent } from "../types";
import type { DiscoveredProject } from "../project-paths";

export type AdapterHealthStatus = "ready" | "degraded" | "error";
export type AdapterRefreshReason = "warm" | "startup" | "interval" | "manual" | "event";

export interface AdapterCapabilities {
  discoverProjects?: boolean;
  liveUpdates?: boolean;
  typedNeedsUser?: boolean;
  cloudTasks?: boolean;
}

export interface AdapterHealth {
  status: AdapterHealthStatus;
  detail: string | null;
  lastUpdatedAt: string | null;
}

export interface AdapterSnapshot {
  adapterId: string;
  source: DashboardAgent["source"];
  generatedAt: string;
  agents: DashboardAgent[];
  events: DashboardEvent[];
  notes: string[];
  cloudTasks?: CloudTask[];
  health: AdapterHealth;
}

export interface ProjectAdapterContext {
  projectRoot: string;
  localLimit?: number;
  readThreads?: boolean;
}

export interface ProjectSource {
  warm(): Promise<void>;
  refresh(reason: AdapterRefreshReason): Promise<void>;
  getCachedSnapshot(): AdapterSnapshot;
  subscribe?(listener: () => void): () => void;
  dispose(): Promise<void>;
}

export interface ProjectAdapter {
  id: string;
  source: DashboardAgent["source"];
  capabilities: AdapterCapabilities;
  discoverProjects?(limit?: number): Promise<DiscoveredProject[]>;
  createSource(context: ProjectAdapterContext): ProjectSource;
}

