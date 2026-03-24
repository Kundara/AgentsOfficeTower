import type { ServerResponse } from "node:http";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  discoverProjects,
  ProjectLiveMonitor,
  scaffoldRoomsFile
} from "@codex-agents-office/core";

import { buildFleetResponse } from "./server-metadata";
import { buildProjectDescriptors } from "./server-options";
import type { FleetResponse, ProjectDescriptor } from "./server-types";

export class FleetLiveService {
  private static readonly PROJECT_SET_REFRESH_INTERVAL_MS = 4000;
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;
  private lastProjectSetRefreshAt = 0;

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean
  ) {}

  async start(): Promise<void> {
    await this.ensureProjectSet(true);
    await this.publish();
  }

  async stop(): Promise<void> {
    for (const monitor of this.monitors.values()) {
      await monitor.stop();
    }
    this.monitors.clear();
    for (const response of this.clients) {
      response.end();
    }
    this.clients.clear();
  }

  async getFleet(): Promise<FleetResponse> {
    if (!this.fleet) {
      await this.publish(true);
    }
    return this.fleet ?? buildFleetResponse(this.projects, new Map());
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.ensureProjectSet(true);
    await Promise.all(Array.from(this.monitors.values()).map((monitor) => monitor.refreshNow()));
    await this.publish();
    return this.getFleet();
  }

  async cycleAppearance(projectRoot: string, agentId: string): Promise<void> {
    await cycleAgentAppearance(projectRoot, agentId);
    await this.monitors.get(projectRoot)?.refreshNow();
    await this.publish();
  }

  async scaffoldRooms(projectRoot: string): Promise<string> {
    const filePath = await scaffoldRoomsFile(projectRoot);
    await this.monitors.get(projectRoot)?.refreshNow();
    await this.publish();
    return filePath;
  }

  registerSse(response: ServerResponse): void {
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 15000);

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(": connected\n\n");
    this.clients.add(response);

    if (this.fleet) {
      response.write(`event: fleet\ndata: ${JSON.stringify(this.fleet)}\n\n`);
    }

    response.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(response);
    });
  }

  private async publish(forceProjectRefresh = false): Promise<void> {
    await this.ensureProjectSet(forceProjectRefresh);
    const snapshotsByRoot = new Map();
    for (const project of this.projects) {
      const snapshot = this.monitors.get(project.root)?.getSnapshot();
      if (snapshot) {
        snapshotsByRoot.set(project.root, snapshot);
      }
    }

    this.fleet = buildFleetResponse(this.projects, snapshotsByRoot);

    for (const response of this.clients) {
      response.write(`event: fleet\ndata: ${JSON.stringify(this.fleet)}\n\n`);
    }
  }

  private async ensureProjectSet(force = false): Promise<void> {
    const stale = Date.now() - this.lastProjectSetRefreshAt >= FleetLiveService.PROJECT_SET_REFRESH_INTERVAL_MS;
    if (!force && this.projects.length > 0 && !stale) {
      return;
    }
    await this.refreshProjectSet();
  }

  private async refreshProjectSet(): Promise<void> {
    const discoveredProjects: ProjectDescriptor[] = this.explicitProjects
      ? []
      : await discoverProjects(10).catch(() => []);
    const normalizedSeeds = this.seedProjects
      .map((project) => {
        const root = canonicalizeProjectPath(project.root);
        return root ? { root, label: project.label } : null;
      })
      .filter((project): project is ProjectDescriptor => Boolean(project));

    const nextProjectRoots = this.explicitProjects
      ? normalizedSeeds.map((project) => project.root)
      : (
        discoveredProjects.length > 0
          ? discoveredProjects.map((project) => project.root)
          : normalizedSeeds.map((project) => project.root)
      );
    const nextProjects = buildProjectDescriptors(nextProjectRoots);
    const nextRoots = new Set(nextProjects.map((project) => project.root));

    const newMonitors: ProjectLiveMonitor[] = [];

    for (const project of nextProjects) {
      if (this.monitors.has(project.root)) {
        continue;
      }

      const monitor = new ProjectLiveMonitor({
        projectRoot: project.root,
        includeCloud: true
      });
      monitor.on("snapshot", () => {
        void this.publish();
      });
      this.monitors.set(project.root, monitor);
      newMonitors.push(monitor);
    }

    await Promise.all(newMonitors.map((monitor) => monitor.start()));

    for (const [projectRoot, monitor] of Array.from(this.monitors.entries())) {
      if (nextRoots.has(projectRoot)) {
        continue;
      }
      await monitor.stop();
      this.monitors.delete(projectRoot);
    }

    this.projects = nextProjects;
    this.lastProjectSetRefreshAt = Date.now();
  }
}
