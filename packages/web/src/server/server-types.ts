import type { DashboardSnapshot } from "@codex-agents-office/core";
import type { AppearanceSettings } from "@codex-agents-office/core";
import type { CursorIntegrationSettings } from "@codex-agents-office/core";
import type { MultiplayerSettings } from "@codex-agents-office/core";

export interface ProjectDescriptor {
  root: string;
  label: string;
}

export interface FleetResponse {
  generatedAt: string;
  projects: DashboardSnapshot[];
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
