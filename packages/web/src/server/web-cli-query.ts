import type { DashboardAgent, DashboardEvent, DashboardSnapshot, HotChangeSummary } from "@codex-agents-office/core";

import type { FleetResponse } from "./server-types";

export type WebCliScope = "local" | "team";
export type WebCliCommand = "recent" | "last" | "gist";
export type WebCliItemType = "agents" | "events" | "all";

export interface WebCliQueryValues {
  limit?: number;
  type?: WebCliItemType;
  state?: string;
  source?: string;
  kind?: string;
  since?: string;
  agent?: string;
}

export interface WebCliQueryRequest {
  repo: string;
  scope: WebCliScope;
  command: WebCliCommand;
  values: WebCliQueryValues;
}

export interface WebCliTeamFleetCache {
  fleet: FleetResponse;
  receivedAt: string;
  hasSharedData: boolean;
}

export interface WebCliQueryItem {
  type: "agent" | "event";
  timestamp: string;
  projectRoot: string;
  projectLabel: string;
  id: string;
  label: string;
  state?: string;
  source?: string;
  provenance?: string;
  confidence?: string;
  role?: string | null;
  detail: string;
  path?: string | null;
  roomId?: string | null;
  threadId?: string | null;
  peerLabel?: string | null;
  peerRoom?: string | null;
  eventKind?: string;
  eventPhase?: string;
}

export interface WebCliGistHotChange {
  path: string;
  label: string;
  fileType: HotChangeSummary["fileType"];
  branch: string | null;
  branches: string[];
  users: string[];
  heat: number;
  changeCount: number;
  lastChangedAt: string;
  linesAdded: number;
  linesRemoved: number;
  agents: string[];
  provenance: HotChangeSummary["provenance"];
  confidence: HotChangeSummary["confidence"];
}

export interface WebCliGistAgent {
  id: string;
  label: string;
  state: string;
  source: string;
  role: string | null;
  updatedAt: string;
  roomId: string | null;
  threadId: string | null;
  peerLabel: string | null;
  lastMessage: string;
  lastFileChange: {
    path: string | null;
    label: string;
    action: string;
    lastUpdatedAt: string;
    linesAdded?: number;
    linesRemoved?: number;
  } | null;
  provenance: string;
  confidence: string;
}

export interface WebCliGist {
  summary: string;
  activeAgentCount: number;
  hotChangeCount: number;
  hotChanges: WebCliGistHotChange[];
  activeAgents: WebCliGistAgent[];
}

export interface WebCliProjectMatch {
  projectRoot: string;
  projectLabel: string;
  repoName: string | null;
  participants: string[];
  sharedRemoteOnly: boolean;
}

export interface WebCliQueryResponse {
  generatedAt: string;
  scope: WebCliScope;
  command: WebCliCommand;
  repo: string;
  values: Required<Pick<WebCliQueryValues, "limit" | "type">> & Omit<WebCliQueryValues, "limit" | "type">;
  dataSource: "local" | "team-cache";
  teamDataAvailable: boolean;
  teamCacheReceivedAt: string | null;
  teamCacheAgeMs: number | null;
  matchedProject: WebCliProjectMatch;
  items: WebCliQueryItem[];
  gist?: WebCliGist;
}

export type WebCliQueryResult =
  | { ok: true; status: 200; response: WebCliQueryResponse }
  | { ok: false; status: 400 | 404 | 409; error: string; candidates?: WebCliProjectMatch[] };

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TEXT_LIMIT = 600;

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\.git$/i, "");
}

function lastPathSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function sharedParticipants(snapshot: DashboardSnapshot): string[] {
  const labels = (snapshot as unknown as { sharedParticipantLabels?: unknown }).sharedParticipantLabels;
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels.filter((label): label is string => typeof label === "string" && label.trim().length > 0);
}

function isSharedRemoteOnly(snapshot: DashboardSnapshot): boolean {
  return (snapshot as unknown as { sharedRemoteOnly?: unknown }).sharedRemoteOnly === true;
}

function projectMatchDescriptor(snapshot: DashboardSnapshot): WebCliProjectMatch {
  return {
    projectRoot: snapshot.projectRoot,
    projectLabel: snapshot.projectLabel,
    repoName: snapshot.projectIdentity?.repoName ?? lastPathSegment(snapshot.projectIdentity?.gitRoot) ?? lastPathSegment(snapshot.projectRoot),
    participants: sharedParticipants(snapshot),
    sharedRemoteOnly: isSharedRemoteOnly(snapshot)
  };
}

function projectCandidateNames(snapshot: DashboardSnapshot): string[] {
  return uniqueStrings([
    snapshot.projectLabel,
    snapshot.projectIdentity?.repoName,
    snapshot.projectIdentity?.worktreeName,
    lastPathSegment(snapshot.projectIdentity?.gitRoot),
    lastPathSegment(snapshot.projectRoot),
    snapshot.projectRoot
  ]);
}

function matchesRepo(snapshot: DashboardSnapshot, repo: string): boolean {
  const wanted = normalizeName(repo);
  const wantedCompact = compactName(wanted);
  if (!wanted || !wantedCompact) {
    return false;
  }

  return projectCandidateNames(snapshot).some((candidate) => {
    const normalized = normalizeName(candidate);
    return normalized === wanted || compactName(normalized) === wantedCompact;
  });
}

function chooseProject(fleet: FleetResponse, repo: string): WebCliQueryResult | DashboardSnapshot {
  if (!repo.trim()) {
    return { ok: false, status: 400, error: "repo is required" };
  }

  const matches = fleet.projects.filter((project) => matchesRepo(project, repo));
  if (matches.length === 0) {
    return {
      ok: false,
      status: 404,
      error: `No project matched repo "${repo}".`,
      candidates: fleet.projects.slice(0, 20).map(projectMatchDescriptor)
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      error: `Multiple projects matched repo "${repo}".`,
      candidates: matches.map(projectMatchDescriptor)
    };
  }

  return matches[0];
}

function normalizeLimit(value: number | undefined, command: WebCliCommand): number {
  if (command === "last") {
    return 1;
  }
  if (command === "gist" && !Number.isFinite(value ?? NaN)) {
    return 8;
  }
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value as number)));
}

function normalizeType(value: WebCliItemType | undefined): WebCliItemType {
  return value === "agents" || value === "events" || value === "all" ? value : "all";
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function itemTimeMs(item: WebCliQueryItem): number {
  const timestamp = Date.parse(item.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function truncateText(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (normalized.length <= TEXT_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, TEXT_LIMIT - 3)}...`;
}

function agentPeerLabel(agent: DashboardAgent): string | null {
  return agent.network?.peerLabel ?? null;
}

function agentPeerRoom(agent: DashboardAgent): string | null {
  return agent.network?.peerRoom ?? null;
}

function agentDetail(agent: DashboardAgent): string {
  return truncateText(agent.latestMessage || agent.detail || agent.statusText || "");
}

function eventDetail(event: DashboardEvent): string {
  return truncateText(event.detail || event.title || "");
}

function agentToItem(snapshot: DashboardSnapshot, agent: DashboardAgent): WebCliQueryItem {
  return {
    type: "agent",
    timestamp: agent.updatedAt,
    projectRoot: snapshot.projectRoot,
    projectLabel: snapshot.projectLabel,
    id: agent.id,
    label: agent.label,
    state: agent.state,
    source: agent.source,
    provenance: agent.provenance,
    confidence: agent.confidence,
    role: agent.role,
    detail: agentDetail(agent),
    roomId: agent.roomId,
    threadId: agent.threadId,
    peerLabel: agentPeerLabel(agent),
    peerRoom: agentPeerRoom(agent)
  };
}

function eventToItem(snapshot: DashboardSnapshot, event: DashboardEvent): WebCliQueryItem {
  return {
    type: "event",
    timestamp: event.createdAt,
    projectRoot: snapshot.projectRoot,
    projectLabel: snapshot.projectLabel,
    id: event.id,
    label: event.title,
    source: event.source,
    provenance: event.source,
    confidence: event.confidence,
    detail: eventDetail(event),
    path: event.path,
    threadId: event.threadId,
    eventKind: event.kind,
    eventPhase: event.phase
  };
}

function isActiveAgent(agent: DashboardAgent): boolean {
  return agent.isCurrent
    || agent.isOngoing
    || !["done", "idle", "cloud"].includes(agent.state);
}

function hotChangeToGist(change: HotChangeSummary): WebCliGistHotChange {
  return {
    path: change.path,
    label: change.label,
    fileType: change.fileType,
    branch: change.branch,
    branches: change.branches,
    users: change.users,
    heat: change.heat,
    changeCount: change.changeCount,
    lastChangedAt: change.lastChangedAt,
    linesAdded: change.linesAdded,
    linesRemoved: change.linesRemoved,
    agents: change.agents,
    provenance: change.provenance,
    confidence: change.confidence
  };
}

function agentLastFileChange(agent: DashboardAgent): WebCliGistAgent["lastFileChange"] {
  const hotFile = agent.activitySummary?.hotFiles?.[0];
  if (hotFile) {
    return {
      path: hotFile.path,
      label: hotFile.label,
      action: hotFile.action,
      lastUpdatedAt: hotFile.lastUpdatedAt,
      linesAdded: hotFile.linesAdded,
      linesRemoved: hotFile.linesRemoved
    };
  }
  if (agent.activityEvent?.type === "fileChange") {
    return {
      path: agent.activityEvent.path,
      label: agent.activityEvent.title,
      action: agent.activityEvent.action,
      lastUpdatedAt: agent.updatedAt,
      linesAdded: agent.activityEvent.linesAdded,
      linesRemoved: agent.activityEvent.linesRemoved
    };
  }
  return null;
}

function agentToGist(agent: DashboardAgent): WebCliGistAgent {
  return {
    id: agent.id,
    label: agent.label,
    state: agent.state,
    source: agent.source,
    role: agent.role,
    updatedAt: agent.updatedAt,
    roomId: agent.roomId,
    threadId: agent.threadId,
    peerLabel: agentPeerLabel(agent),
    lastMessage: agentDetail(agent),
    lastFileChange: agentLastFileChange(agent),
    provenance: agent.provenance,
    confidence: agent.confidence
  };
}

function buildGist(snapshot: DashboardSnapshot, limit: number): WebCliGist {
  const activeAgents = snapshot.agents
    .filter(isActiveAgent)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit)
    .map(agentToGist);
  const hotChanges = (snapshot.activity?.hotChanges ?? [])
    .slice(0, limit)
    .map(hotChangeToGist);
  const agentPhrase = `${activeAgents.length} active agent${activeAgents.length === 1 ? "" : "s"}`;
  const hotPhrase = `${hotChanges.length} hot change${hotChanges.length === 1 ? "" : "s"}`;
  return {
    summary: `${agentPhrase}; ${hotPhrase}`,
    activeAgentCount: activeAgents.length,
    hotChangeCount: hotChanges.length,
    hotChanges,
    activeAgents
  };
}

function passesFilters(item: WebCliQueryItem, values: WebCliQueryValues, sinceMs: number | null): boolean {
  if (sinceMs !== null && itemTimeMs(item) < sinceMs) {
    return false;
  }
  if (values.state && item.state !== values.state) {
    return false;
  }
  if (values.source && item.source !== values.source && item.provenance !== values.source) {
    return false;
  }
  if (values.kind && item.eventKind !== values.kind) {
    return false;
  }
  if (values.agent) {
    const wanted = compactName(values.agent);
    const label = compactName(item.label);
    if (!label.includes(wanted)) {
      return false;
    }
  }
  return true;
}

function buildItems(snapshot: DashboardSnapshot, values: WebCliQueryValues): WebCliQueryItem[] {
  const type = normalizeType(values.type);
  const sinceMs = parseTimestamp(values.since);
  const items = [
    ...(type === "events" ? [] : snapshot.agents.map((agent) => agentToItem(snapshot, agent))),
    ...(type === "agents" ? [] : snapshot.events.map((event) => eventToItem(snapshot, event)))
  ];

  return items
    .filter((item) => passesFilters(item, values, sinceMs))
    .sort((left, right) => itemTimeMs(right) - itemTimeMs(left));
}

function teamFleet(localFleet: FleetResponse, teamCache: WebCliTeamFleetCache | null): FleetResponse {
  return teamCache?.hasSharedData ? teamCache.fleet : localFleet;
}

export function buildWebCliQueryResponse(
  query: WebCliQueryRequest,
  localFleet: FleetResponse,
  teamCache: WebCliTeamFleetCache | null,
  nowMs = Date.now()
): WebCliQueryResult {
  const fleet = query.scope === "team" ? teamFleet(localFleet, teamCache) : localFleet;
  const project = chooseProject(fleet, query.repo);
  if ("ok" in project) {
    return project;
  }

  const limit = normalizeLimit(query.values.limit, query.command);
  const type = normalizeType(query.values.type);
  const items = query.command === "gist" ? [] : buildItems(project, { ...query.values, limit, type }).slice(0, limit);
  const gist = query.command === "gist" ? buildGist(project, limit) : undefined;
  const cacheReceivedMs = teamCache ? Date.parse(teamCache.receivedAt) : NaN;
  const teamDataAvailable = query.scope === "team" && Boolean(teamCache?.hasSharedData);
  const teamCacheAgeMs = query.scope === "team" && Number.isFinite(cacheReceivedMs)
    ? Math.max(0, nowMs - cacheReceivedMs)
    : null;

  return {
    ok: true,
    status: 200,
    response: {
      generatedAt: new Date(nowMs).toISOString(),
      scope: query.scope,
      command: query.command,
      repo: query.repo,
      values: {
        ...query.values,
        limit,
        type
      },
      dataSource: teamDataAvailable ? "team-cache" : "local",
      teamDataAvailable,
      teamCacheReceivedAt: query.scope === "team" ? teamCache?.receivedAt ?? null : null,
      teamCacheAgeMs,
      matchedProject: projectMatchDescriptor(project),
      items,
      ...(gist ? { gist } : {})
    }
  };
}

export function hasSharedFleetData(fleet: FleetResponse): boolean {
  return fleet.projects.some((snapshot) => {
    if (sharedParticipants(snapshot).length > 0) {
      return true;
    }
    return snapshot.agents.some((agent) => agent.network !== null);
  });
}
