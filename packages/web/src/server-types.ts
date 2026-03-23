import type { DashboardSnapshot } from "@codex-agents-office/core";

export interface ProjectDescriptor {
  root: string;
  label: string;
}

export interface FleetResponse {
  generatedAt: string;
  projects: DashboardSnapshot[];
}

export interface ServerOptions {
  host: string;
  port: number;
  projects: ProjectDescriptor[];
  explicitProjects: boolean;
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
}
