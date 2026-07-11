import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { DashboardAgent, DashboardSnapshot } from "@agents-tower/core";

import type { HealthBuildIdentity } from "./health";
import type { FleetResponse, MultiplayerStatus, ProjectDescriptor, ServerMeta, ServerOptions } from "./server-types";

const SERVER_ENTRY = resolve(__dirname, "server.js");
const SERVER_STARTED_AT = new Date().toISOString();
export const SERVER_BUILD_AT = statSync(SERVER_ENTRY).mtime.toISOString();

function readPackageVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const SERVER_VERSION = readPackageVersion();

export function serverBuildIdentity(): HealthBuildIdentity {
  return {
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    buildAt: SERVER_BUILD_AT,
    version: SERVER_VERSION
  };
}

function createStartupSnapshot(project: ProjectDescriptor): DashboardSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    projectRoot: project.root,
    projectLabel: project.label,
    projectIdentity: null,
    generatedAt,
    rooms: {
      version: 1,
      generated: true,
      filePath: "",
      rooms: []
    },
    agents: [],
    cloudTasks: [],
    events: [],
    activity: {
      generatedAt,
      hotChanges: [],
      hotTools: [],
      runningCommands: []
    },
    notes: [`Project ${project.label} is starting up.`],
    providerHealth: []
  };
}

export function buildFleetResponse(
  projects: ProjectDescriptor[],
  snapshotsByRoot: Map<string, DashboardSnapshot>,
  accountAgents: DashboardAgent[] = []
): FleetResponse {
  return {
    generatedAt: new Date().toISOString(),
    accountAgents,
    projects: projects.map((project) => {
      const snapshot = snapshotsByRoot.get(project.root);
      return snapshot ?? createStartupSnapshot(project);
    })
  };
}

export function buildServerMeta(
  options: ServerOptions,
  projects = options.projects,
  multiplayer: MultiplayerStatus = {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  }
): ServerMeta {
  return {
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    buildAt: SERVER_BUILD_AT,
    entry: SERVER_ENTRY,
    host: options.host,
    port: options.port,
    explicitProjects: options.explicitProjects,
    projects,
    multiplayerHostId: "",
    multiplayer
  };
}
