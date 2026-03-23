import type { ServerResponse } from "node:http";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  discoverProjects,
  ProjectLiveMonitor,
  scaffoldRoomsFile,
  type DashboardSnapshot
} from "@codex-agents-office/core";

import { buildFleetResponse } from "./server-metadata";
import { buildProjectDescriptors } from "./server-options";
import type { FleetResponse, ProjectDescriptor } from "./server-types";

export class FleetLiveService {
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean
  ) {}

  async start(): Promise<void> {
    await this.refreshProjectSet();
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
      await this.publish();
    }
    return this.fleet ?? buildFleetResponse(this.projects, new Map<string, DashboardSnapshot>());
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.refreshProjectSet();
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

  private async publish(): Promise<void> {
    await this.refreshProjectSet();
    const snapshotsByRoot = new Map<string, DashboardSnapshot>();
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

  private async refreshProjectSet(): Promise<void> {
    const discoveredProjects = this.explicitProjects
      ? []
      : await discoverProjects(50).catch(() => []);
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
      await monitor.start();
    }

    for (const [projectRoot, monitor] of Array.from(this.monitors.entries())) {
      if (nextRoots.has(projectRoot)) {
        continue;
      }
      await monitor.stop();
      this.monitors.delete(projectRoot);
    }

    this.projects = nextProjects;
  }
}
