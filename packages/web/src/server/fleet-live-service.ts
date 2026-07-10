import type { ServerResponse } from "node:http";

import {
  type ApprovalDecision,
  type UserInputAnswers,
  canonicalizeProjectPath,
  cycleAgentAppearance,
  describeStoredAppearanceSettings,
  describeCursorIntegrationSettings,
  describeStoredMultiplayerSettings,
  discoverProjects,
  listCloudTasks,
  loadClaudeHomeAccountAgents,
  loadRoamingHermesSnapshotData,
  loadRoamingOpenClawSnapshotData,
  normalizeDiscoveredProjectUpdatedAt,
  projectPathIdentityKey,
  ProjectLiveMonitor,
  respondToClaudeHookInputRequest,
  respondToClaudeHookPermissionRequest,
  scaffoldRoomsFile,
  setStoredAppearanceSettings,
  setStoredCursorApiKey,
  setStoredMultiplayerSettings
} from "@codex-agents-office/core";
import type { CloudTask, DashboardAgent, DashboardSnapshot, DiscoveredProject } from "@codex-agents-office/core";

import { buildFleetResponse } from "./server-metadata";
import { buildProjectDescriptors } from "./server-options";
import type { FleetResponse, IntegrationSettingsResponse, MultiplayerStatus, ProjectDescriptor } from "./server-types";
import {
  buildWebCliQueryResponse,
  hasSharedFleetData,
  type WebCliQueryRequest,
  type WebCliQueryResult,
  type WebCliTeamFleetCache
} from "./web-cli-query";

export const DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PROJECT_SET_REFRESH_INTERVAL_MS = 4000;
export const FLEET_MONITOR_REFRESH_TIMEOUT_MS = 20000;
const HERMES_FLOATING_AGENT_LIMIT = 12;
const OPENCLAW_FLOATING_AGENT_LIMIT = 12;

export function filterFreshDiscoveredProjects(
  projects: DiscoveredProject[],
  nowMs = Date.now(),
  freshnessWindowMs = DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS
): DiscoveredProject[] {
  const cutoffMs = nowMs - freshnessWindowMs;
  return projects.filter(
    (project) => project.count > 0
      && (normalizeDiscoveredProjectUpdatedAt(project.updatedAt) * 1000) >= cutoffMs
  );
}

export function shouldRefreshProjectSet(
  lastRefreshAt: number,
  force = false,
  now = Date.now(),
  refreshIntervalMs = PROJECT_SET_REFRESH_INTERVAL_MS
): boolean {
  return force
    || lastRefreshAt <= 0
    || now - lastRefreshAt >= refreshIntervalMs;
}

export async function refreshMonitorWithinTimeout(
  refresh: () => Promise<void>,
  timeoutMs = FLEET_MONITOR_REFRESH_TIMEOUT_MS
): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      refresh(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Project monitor refresh timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function mergeDiscoveredProjectRootsWithSeeds(
  discoveredRoots: string[],
  seedRoots: string[]
): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const preferredSeedRoots = new Map(
    seedRoots
      .map((root) => [projectPathIdentityKey(root), root] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0]))
  );

  for (const discoveredRoot of discoveredRoots) {
    const discoveredIdentityKey = projectPathIdentityKey(discoveredRoot);
    const root = discoveredIdentityKey
      ? preferredSeedRoots.get(discoveredIdentityKey) ?? discoveredRoot
      : discoveredRoot;
    const identityKey = projectPathIdentityKey(root);
    if (!identityKey || seen.has(identityKey)) {
      continue;
    }
    seen.add(identityKey);
    roots.push(root);
  }

  return roots;
}

function discoveredProjectSourceKinds(project: Pick<DiscoveredProject, "sourceKind" | "sourceKinds">): string[] {
  const kinds = [
    ...(Array.isArray(project.sourceKinds) ? project.sourceKinds : []),
    project.sourceKind
  ].filter((kind): kind is string => typeof kind === "string" && kind.trim().length > 0);
  return Array.from(new Set(kinds));
}

function mergeSourceKinds(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function isCoworkOnlySourceKinds(sourceKinds: string[]): boolean {
  return sourceKinds.length > 0
    && sourceKinds.every((kind) => kind === "claude:cowork" || kind.startsWith("claude:cowork:"));
}

export function sortProjectRootsWithCoworkLast(
  projectRoots: string[],
  sourceKindsByIdentity: Map<string, string[]>
): string[] {
  return projectRoots
    .map((root, index) => ({ root, index }))
    .sort((left, right) => {
      const leftIdentity = projectPathIdentityKey(left.root);
      const rightIdentity = projectPathIdentityKey(right.root);
      const leftTier = leftIdentity && isCoworkOnlySourceKinds(sourceKindsByIdentity.get(leftIdentity) ?? []) ? 1 : 0;
      const rightTier = rightIdentity && isCoworkOnlySourceKinds(sourceKindsByIdentity.get(rightIdentity) ?? []) ? 1 : 0;
      if (leftTier !== rightTier) {
        return leftTier - rightTier;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.root);
}

export class FleetLiveService {
  private static readonly PROJECT_DISCOVERY_LIMIT = 200;
  private static readonly PROJECT_DISCOVERY_RETENTION_MS = 2 * 60 * 1000;
  private static readonly CLOUD_REFRESH_INTERVAL_MS = 30000;
  private static readonly CLOUD_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
  private static readonly ACCOUNT_AGENT_REFRESH_INTERVAL_MS = 4000;
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[];
  private fleet: FleetResponse | null = null;
  private accountAgents: DashboardAgent[] = [];
  private lastAccountAgentRefreshAt = 0;
  private accountAgentRefresh: Promise<void> | null = null;
  private lastProjectSetRefreshAt = 0;
  private sharedCloudTasks: CloudTask[] = [];
  private sharedCloudErrorMessage: string | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private cloudBackoffUntil = 0;
  private coordinatedTeamFleet: WebCliTeamFleetCache | null = null;
  private readonly recentlyDiscoveredProjects = new Map<string, { root: string; lastSeenAt: number; sourceKinds: string[] }>();

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean
  ) {
    this.projects = explicitProjects ? [...seedProjects] : [];
  }

  async start(): Promise<void> {
    this.fleet = buildFleetResponse(this.projects, new Map(), this.accountAgents);
    this.cloudTimer = setInterval(() => {
      void this.refreshSharedCloudTasks();
    }, FleetLiveService.CLOUD_REFRESH_INTERVAL_MS);
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await this.publish();
  }

  async stop(): Promise<void> {
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
      this.cloudTimer = null;
    }
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
    return this.fleet ?? buildFleetResponse(this.projects, new Map(), this.accountAgents);
  }

  setCoordinatedTeamFleet(fleet: FleetResponse | null, hasSharedData?: boolean): void {
    if (!fleet || hasSharedData === false || !hasSharedFleetData(fleet)) {
      this.coordinatedTeamFleet = null;
      return;
    }

    this.coordinatedTeamFleet = {
      fleet,
      receivedAt: new Date().toISOString(),
      hasSharedData: true
    };
  }

  async queryWebCli(request: WebCliQueryRequest): Promise<WebCliQueryResult> {
    return buildWebCliQueryResponse(request, await this.getFleet(), this.coordinatedTeamFleet);
  }

  getMultiplayerStatus(): MultiplayerStatus {
    return {
      enabled: false,
      transport: null,
      secure: false,
      peerCount: 0,
      note: "Multiplayer transport not configured."
    };
  }

  getCurrentProjects(): ProjectDescriptor[] {
    return [...this.projects];
  }

  async getProjects(): Promise<ProjectDescriptor[]> {
    await this.ensureProjectSet();
    return [...this.projects];
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await this.refreshAccountAgents(true);
    await Promise.all(Array.from(this.monitors.values()).map((monitor) => (
      refreshMonitorWithinTimeout(() => monitor.refreshNow())
    )));
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

  async respondToApprovalRequest(
    projectRoot: string,
    requestId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    await this.ensureProjectSet();
    const monitor = this.monitors.get(projectRoot) ?? null;
    if (!monitor) {
      throw new Error(`No live monitor found for ${projectRoot}`);
    }

    const snapshot = monitor.getSnapshot();
    const agent = snapshot?.agents.find((entry) => entry.needsUser?.requestId === requestId) ?? null;
    if (agent?.provenance === "claude" && agent.confidence === "typed" && agent.threadId) {
      if (decision !== "accept" && decision !== "decline") {
        throw new Error("Claude approval requests only support accept or decline from Agents Office.");
      }
      await respondToClaudeHookPermissionRequest(projectRoot, agent.threadId, requestId, decision);
      await monitor.refreshNow();
      await this.publish();
      return;
    }

    await monitor.respondToApprovalRequest(requestId, decision);
    await this.publish();
  }

  async respondToInputRequest(
    projectRoot: string,
    requestId: string,
    answers: UserInputAnswers
  ): Promise<void> {
    await this.ensureProjectSet();
    const monitor = this.monitors.get(projectRoot) ?? null;
    if (!monitor) {
      throw new Error(`No live monitor found for ${projectRoot}`);
    }

    const snapshot = monitor.getSnapshot();
    const agent = snapshot?.agents.find((entry) => entry.needsUser?.requestId === requestId) ?? null;
    if (agent?.provenance === "claude" && agent.confidence === "typed" && agent.threadId) {
      if (agent.needsUser?.kind !== "input" || !Array.isArray(agent.needsUser.questions)) {
        throw new Error("Claude input request is not actionable from Agents Office.");
      }
      await respondToClaudeHookInputRequest(projectRoot, agent.threadId, requestId, agent.needsUser.questions, answers);
      await monitor.refreshNow();
      await this.publish();
      return;
    }

    await monitor.respondToInputRequest(requestId, answers);
    await this.publish();
  }

  async sendThreadReply(projectRoot: string, threadId: string, text: string): Promise<void> {
    await this.ensureProjectSet();
    const monitor = this.monitors.get(projectRoot) ?? null;
    if (!monitor) {
      throw new Error(`No live monitor found for ${projectRoot}`);
    }

    await monitor.sendThreadReply(threadId, text);
    await this.publish();
  }

  getIntegrationSettings(): IntegrationSettingsResponse {
    return {
      cursor: describeCursorIntegrationSettings(),
      appearance: describeStoredAppearanceSettings(),
      multiplayer: describeStoredMultiplayerSettings()
    };
  }

  async setCursorApiKey(apiKey: string | null): Promise<IntegrationSettingsResponse> {
    await setStoredCursorApiKey(apiKey);
    await Promise.all(Array.from(this.monitors.values()).map((monitor) => monitor.refreshNow()));
    await this.publish();
    return this.getIntegrationSettings();
  }

  async setMultiplayerSettings(settings: {
    enabled?: boolean;
    host?: string | null;
    room?: string | null;
    nickname?: string | null;
  } | null): Promise<IntegrationSettingsResponse> {
    await setStoredMultiplayerSettings(settings);
    await this.publish();
    return this.getIntegrationSettings();
  }

  async setAppearanceSettings(settings: {
    hatId?: string | null;
  } | null): Promise<IntegrationSettingsResponse> {
    await setStoredAppearanceSettings(settings);
    void Promise.all(Array.from(this.monitors.values()).map((monitor) => monitor.refreshNow()))
      .then(() => this.publish())
      .catch(() => undefined);
    return this.getIntegrationSettings();
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
    await this.refreshAccountAgents(forceProjectRefresh);
    const snapshotsByRoot = new Map<string, DashboardSnapshot>();
    for (const project of this.projects) {
      const snapshot = this.monitors.get(project.root)?.getSnapshot();
      if (snapshot) {
        snapshotsByRoot.set(project.root, snapshot);
      }
    }

    await this.attachRoamingHermesAgents(snapshotsByRoot);
    await this.attachRoamingOpenClawAgents(snapshotsByRoot);
    this.fleet = buildFleetResponse(this.projects, snapshotsByRoot, this.accountAgents);

    for (const response of this.clients) {
      response.write(`event: fleet\ndata: ${JSON.stringify(this.fleet)}\n\n`);
    }
  }

  private async attachRoamingHermesAgents(snapshotsByRoot: Map<string, DashboardSnapshot>): Promise<void> {
    const anchorProject = this.projects[0] ?? null;
    if (!anchorProject) {
      return;
    }

    const anchorSnapshot = snapshotsByRoot.get(anchorProject.root) ?? null;
    if (!anchorSnapshot) {
      return;
    }

    const roaming = await loadRoamingHermesSnapshotData({
      anchorProjectRoot: anchorProject.root,
      knownProjectRoots: this.projects.map((project) => project.root),
      limit: HERMES_FLOATING_AGENT_LIMIT
    }).catch(() => null);
    if (!roaming || (roaming.agents.length === 0 && roaming.events.length === 0 && roaming.notes.length === 0)) {
      return;
    }

    const existingAgentIds = new Set(anchorSnapshot.agents.map((agent) => agent.id));
    snapshotsByRoot.set(anchorProject.root, {
      ...anchorSnapshot,
      agents: [
        ...anchorSnapshot.agents,
        ...roaming.agents.filter((agent) => !existingAgentIds.has(agent.id))
      ],
      events: [
        ...roaming.events,
        ...anchorSnapshot.events
      ],
      notes: [
        ...anchorSnapshot.notes,
        ...roaming.notes.filter((note) => !anchorSnapshot.notes.includes(note))
      ]
    });
  }

  private async attachRoamingOpenClawAgents(snapshotsByRoot: Map<string, DashboardSnapshot>): Promise<void> {
    const anchorProject = this.projects[0] ?? null;
    if (!anchorProject) {
      return;
    }

    const anchorSnapshot = snapshotsByRoot.get(anchorProject.root) ?? null;
    if (!anchorSnapshot) {
      return;
    }

    const roaming = await loadRoamingOpenClawSnapshotData({
      anchorProjectRoot: anchorProject.root,
      knownProjectRoots: this.projects.map((project) => project.root),
      limit: OPENCLAW_FLOATING_AGENT_LIMIT
    }).catch(() => null);
    if (!roaming || (roaming.agents.length === 0 && roaming.notes.length === 0)) {
      return;
    }

    const existingAgentIds = new Set(anchorSnapshot.agents.map((agent) => agent.id));
    snapshotsByRoot.set(anchorProject.root, {
      ...anchorSnapshot,
      agents: [
        ...anchorSnapshot.agents,
        ...roaming.agents.filter((agent) => !existingAgentIds.has(agent.id))
      ],
      notes: [
        ...anchorSnapshot.notes,
        ...roaming.notes.filter((note) => !anchorSnapshot.notes.includes(note))
      ]
    });
  }

  private async ensureProjectSet(force = false): Promise<void> {
    if (!shouldRefreshProjectSet(this.lastProjectSetRefreshAt, force)) {
      return;
    }
    await this.refreshProjectSet();
  }

  private async refreshProjectSet(): Promise<void> {
    const now = Date.now();
    const rawDiscoveredProjects = this.explicitProjects
      ? []
      : await discoverProjects(FleetLiveService.PROJECT_DISCOVERY_LIMIT).catch(() => []);
    const discoveredProjects = filterFreshDiscoveredProjects(rawDiscoveredProjects);
    const normalizedSeeds = this.seedProjects
      .map((project) => {
        const root = canonicalizeProjectPath(project.root);
        const identityKey = projectPathIdentityKey(root);
        return root && identityKey ? { root, label: project.label, identityKey } : null;
      })
      .filter((project): project is ProjectDescriptor & { identityKey: string } => Boolean(project));
    const preferredRootsByIdentity = new Map(normalizedSeeds.map((project) => [project.identityKey, project.root]));

    const sourceKindsByIdentity = new Map<string, string[]>();
    const discoveredEntries = discoveredProjects
      .map((project) => {
        const identityKey = projectPathIdentityKey(project.root);
        if (!identityKey) {
          return null;
        }
        const root = preferredRootsByIdentity.get(identityKey) ?? project.root;
        return { root, identityKey, sourceKinds: discoveredProjectSourceKinds(project) };
      })
      .filter((entry): entry is { root: string; identityKey: string; sourceKinds: string[] } => Boolean(entry));
    for (const entry of discoveredEntries) {
      sourceKindsByIdentity.set(
        entry.identityKey,
        mergeSourceKinds(sourceKindsByIdentity.get(entry.identityKey) ?? [], entry.sourceKinds)
      );
      this.recentlyDiscoveredProjects.set(entry.identityKey, {
        root: entry.root,
        lastSeenAt: now,
        sourceKinds: sourceKindsByIdentity.get(entry.identityKey) ?? entry.sourceKinds
      });
    }
    for (const [identityKey, project] of Array.from(this.recentlyDiscoveredProjects.entries())) {
      if (now - project.lastSeenAt > FleetLiveService.PROJECT_DISCOVERY_RETENTION_MS) {
        this.recentlyDiscoveredProjects.delete(identityKey);
      } else {
        sourceKindsByIdentity.set(
          identityKey,
          mergeSourceKinds(sourceKindsByIdentity.get(identityKey) ?? [], project.sourceKinds)
        );
      }
    }
    const retainedRoots = Array.from(this.recentlyDiscoveredProjects.values()).map((project) => project.root);
    const seedRoots = normalizedSeeds.map((project) => project.root);
    const unsortedProjectRoots = this.explicitProjects
      ? seedRoots
      : mergeDiscoveredProjectRootsWithSeeds(
        [...discoveredEntries.map((entry) => entry.root), ...retainedRoots],
        seedRoots
      );
    const nextProjectRoots = this.explicitProjects
      ? unsortedProjectRoots
      : sortProjectRootsWithCoworkLast(unsortedProjectRoots, sourceKindsByIdentity);
    const nextProjects = buildProjectDescriptors(nextProjectRoots);
    const nextRoots = new Set(nextProjects.map((project) => project.root));

    const newMonitors: ProjectLiveMonitor[] = [];

    for (const project of nextProjects) {
      if (this.monitors.has(project.root)) {
        continue;
      }

      const monitor = new ProjectLiveMonitor({
        projectRoot: project.root,
        includeCloud: false
      });
      monitor.on("snapshot", () => {
        void this.publish();
      });
      monitor.setSharedCloudTasks(this.sharedCloudTasks, this.sharedCloudErrorMessage);
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

  private async refreshSharedCloudTasks(): Promise<void> {
    if (Date.now() < this.cloudBackoffUntil) {
      this.applySharedCloudTasksToMonitors();
      return;
    }

    try {
      this.sharedCloudTasks = await listCloudTasks(10);
      this.sharedCloudErrorMessage = null;
      this.cloudBackoffUntil = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sharedCloudTasks = [];
      const rateLimited = /429|rate limit/i.test(message);
      if (rateLimited) {
        this.cloudBackoffUntil = Date.now() + FleetLiveService.CLOUD_RATE_LIMIT_BACKOFF_MS;
        this.sharedCloudErrorMessage = "Codex cloud temporarily rate-limited; retrying in 5 minutes.";
      } else {
        this.sharedCloudErrorMessage = message;
      }
    }

    this.applySharedCloudTasksToMonitors();
  }

  private applySharedCloudTasksToMonitors(): void {
    let emittedSharedError = false;
    for (const monitor of this.monitors.values()) {
      const errorMessage: string | null = this.sharedCloudErrorMessage && !emittedSharedError
        ? this.sharedCloudErrorMessage
        : null;
      monitor.setSharedCloudTasks(this.sharedCloudTasks, errorMessage);
      emittedSharedError = emittedSharedError || Boolean(errorMessage);
    }
  }

  private async refreshAccountAgents(force = false): Promise<void> {
    const stale = Date.now() - this.lastAccountAgentRefreshAt >= FleetLiveService.ACCOUNT_AGENT_REFRESH_INTERVAL_MS;
    if (!force && !stale) {
      return;
    }
    if (this.accountAgentRefresh) {
      await this.accountAgentRefresh;
      return;
    }

    this.accountAgentRefresh = (async () => {
      try {
        this.accountAgents = await loadClaudeHomeAccountAgents();
      } catch {
        // Account discovery is an optional, read-only enhancement. Keep the last
        // good view when a desktop cache is temporarily locked or changing.
      } finally {
        this.lastAccountAgentRefreshAt = Date.now();
      }
    })();
    try {
      await this.accountAgentRefresh;
    } finally {
      this.accountAgentRefresh = null;
    }
  }

}
