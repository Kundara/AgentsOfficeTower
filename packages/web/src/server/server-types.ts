import type { DashboardAgent, DashboardSnapshot } from "@agents-tower/core";
import type { AppearanceSettings } from "@agents-tower/core";
import type { CursorIntegrationSettings } from "@agents-tower/core";
import type { MultiplayerSettings } from "@agents-tower/core";

export interface ProjectDescriptor {
  root: string;
  label: string;
}

export interface FleetResponse {
  generatedAt: string;
  projects: DashboardSnapshot[];
  /** Private, rootless account sessions rendered locally without joining project snapshots. */
  accountAgents: DashboardAgent[];
}

export interface MultiplayerStatus {
  enabled: boolean;
  transport: string | null;
  secure: boolean;
  peerCount: number;
  note: string | null;
}

export interface ServerOptions {
  host: string;
  port: number;
  projects: ProjectDescriptor[];
  explicitProjects: boolean;
}

export interface IntegrationSettingsResponse {
  cursor: CursorIntegrationSettings;
  appearance: AppearanceSettings;
  multiplayer: MultiplayerSettings;
}

export interface ServerMeta {
  pid: number;
  startedAt: string;
  buildAt: string;
  entry: string;
  host: string;
  port: number;
  explicitProjects: boolean;
  projects: ProjectDescriptor[];
  multiplayerHostId: string;
  multiplayer: MultiplayerStatus;
}
