import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { readJsonBody, notFound, sendAbsoluteFileAsset, sendHtml, sendJson, sendProjectFile, sendStaticAsset } from "../http-helpers";
import { buildServerMeta } from "./server-metadata";
import { renderHtml } from "../render/render-html";
import { renderIconAuditHtml } from "../render/render-icon-audit-html";
import { renderSceneEffectsAuditHtml } from "../render/render-scene-effects-audit-html";
import { renderZOrderAuditHtml } from "../render/render-z-order-audit-html";
import type { FleetLiveService } from "./fleet-live-service";
import type { FleetResponse, ServerOptions } from "./server-types";
import type { WebCliCommand, WebCliItemType, WebCliQueryRequest, WebCliScope } from "./web-cli-query";

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  options: ServerOptions;
  service: FleetLiveService;
}

type RouteHandler = (context: RequestContext) => Promise<boolean>;

const PIXI_BROWSER_BUNDLE = resolve(__dirname, "../../../../node_modules/pixi.js/dist/pixi.min.js");
const EASYSTAR_BROWSER_BUNDLE = resolve(__dirname, "../../../../node_modules/easystarjs/bin/easystar-0.4.4.min.js");
const PARTYSOCKET_BROWSER_DIR = resolve(__dirname, "../../../../node_modules/partysocket/dist");
const CLIENT_BUNDLE_DIR = resolve(__dirname, "../client");
const WEB_CLI_TEAM_FLEET_MAX_BYTES = 2 * 1024 * 1024;
const WEB_CLI_CACHE_HEADER = "x-agents-office-web-cli-cache";

function requestMethod(context: RequestContext): string {
  return context.request.method ?? "GET";
}

function matchesMethod(context: RequestContext, ...methods: string[]): boolean {
  return methods.includes(requestMethod(context));
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizeHeaderHost(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeOriginHost(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1"
    || normalized.startsWith("127.");
}

function isLoopbackHost(value: string | null): boolean {
  const host = normalizeHeaderHost(value);
  return host === "localhost" || host === "::1" || host?.startsWith("127.") === true;
}

function isLoopbackWebCliRequest(context: RequestContext): boolean {
  return isLoopbackAddress(context.request.socket.remoteAddress)
    && isLoopbackHost(firstHeader(context.request.headers.host));
}

function requestOriginMatchesHost(context: RequestContext): boolean {
  const origin = firstHeader(context.request.headers.origin);
  if (!origin) {
    return true;
  }
  const originHost = normalizeOriginHost(origin);
  const requestHost = firstHeader(context.request.headers.host)?.toLowerCase() ?? null;
  return Boolean(originHost && requestHost && originHost === requestHost);
}

function parseWebCliCommand(value: string | null): WebCliCommand | null {
  return value === "recent" || value === "last" || value === "gist" ? value : null;
}

function parseWebCliScope(value: string | null): WebCliScope | null {
  if (!value) {
    return "local";
  }
  return value === "local" || value === "team" ? value : null;
}

function parseWebCliItemType(value: string | null): WebCliItemType | undefined | null {
  if (!value) {
    return undefined;
  }
  return value === "agents" || value === "events" || value === "all" ? value : null;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nullableParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseWebCliQuery(context: RequestContext): WebCliQueryRequest | { error: string } {
  const repo = nullableParam(context.url, "repo");
  const command = parseWebCliCommand(context.url.searchParams.get("command"));
  const scope = parseWebCliScope(context.url.searchParams.get("scope"));
  const type = parseWebCliItemType(context.url.searchParams.get("type"));

  if (!repo) {
    return { error: "repo is required" };
  }
  if (!command) {
    return { error: "command must be recent, last, or gist" };
  }
  if (!scope) {
    return { error: "scope must be local or team" };
  }
  if (type === null) {
    return { error: "type must be agents, events, or all" };
  }

  return {
    repo,
    command,
    scope,
    values: {
      limit: parseLimit(context.url.searchParams.get("limit")),
      type,
      state: nullableParam(context.url, "state"),
      source: nullableParam(context.url, "source"),
      kind: nullableParam(context.url, "kind"),
      since: nullableParam(context.url, "since"),
      agent: nullableParam(context.url, "agent")
    }
  };
}

async function handleAssetRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || !context.url.pathname.startsWith("/assets/")) {
    return false;
  }

  let assetPath = context.url.pathname.slice("/assets/".length);
  try {
    assetPath = decodeURIComponent(assetPath);
  } catch {
    notFound(context.response);
    return true;
  }

  await sendStaticAsset(
    context.response,
    assetPath,
    requestMethod(context)
  );
  return true;
}

async function handleHomeRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderHtml(context.options, context.service.getCurrentProjects()));
  return true;
}

async function handleClientBundleRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || !context.url.pathname.startsWith("/client/")) {
    return false;
  }

  const relativePath = context.url.pathname.slice("/client/".length);
  const filePath = resolve(CLIENT_BUNDLE_DIR, relativePath);
  if (!(filePath === CLIENT_BUNDLE_DIR || filePath.startsWith(CLIENT_BUNDLE_DIR + "/") || filePath.startsWith(CLIENT_BUNDLE_DIR + "\\"))) {
    return false;
  }

  await sendAbsoluteFileAsset(context.response, filePath, requestMethod(context), "no-store");
  return true;
}

async function handleVendorRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD")) {
    return false;
  }

  if (context.url.pathname === "/vendor/pixi.min.js") {
    await sendAbsoluteFileAsset(context.response, PIXI_BROWSER_BUNDLE, requestMethod(context));
    return true;
  }

  if (context.url.pathname === "/vendor/easystar.min.js") {
    await sendAbsoluteFileAsset(context.response, EASYSTAR_BROWSER_BUNDLE, requestMethod(context));
    return true;
  }

  if (context.url.pathname.startsWith("/vendor/partysocket/")) {
    const relativePath = context.url.pathname.slice("/vendor/partysocket/".length);
    const filePath = resolve(PARTYSOCKET_BROWSER_DIR, relativePath);
    if (!(filePath === PARTYSOCKET_BROWSER_DIR || filePath.startsWith(PARTYSOCKET_BROWSER_DIR + "/") || filePath.startsWith(PARTYSOCKET_BROWSER_DIR + "\\"))) {
      return false;
    }
    await sendAbsoluteFileAsset(context.response, filePath, requestMethod(context));
    return true;
  }

  return false;
}

async function handleIconAuditRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/icon-audit") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderIconAuditHtml());
  return true;
}

async function handleZOrderAuditRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/z-order-audit") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderZOrderAuditHtml());
  return true;
}

async function handleSceneEffectsAuditRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/scene-effects-audit") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderSceneEffectsAuditHtml());
  return true;
}

async function handleFleetRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/fleet") {
    return false;
  }

  sendJson(context.response, 200, await context.service.getFleet());
  return true;
}

async function handleServerMetaRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/server-meta") {
    return false;
  }

  sendJson(
    context.response,
    200,
    buildServerMeta(context.options, context.service.getCurrentProjects(), context.service.getMultiplayerStatus())
  );
  return true;
}

async function handleMultiplayerStatusRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/multiplayer") {
    return false;
  }
  sendJson(context.response, 200, context.service.getMultiplayerStatus());
  return true;
}

async function handleWebCliTeamFleetRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/web-cli/team-fleet") {
    return false;
  }

  if (!isLoopbackWebCliRequest(context)) {
    sendJson(context.response, 403, { error: "web CLI cache updates are only accepted from loopback clients" });
    return true;
  }

  if (!requestOriginMatchesHost(context)) {
    sendJson(context.response, 403, { error: "origin does not match this Agents Office server" });
    return true;
  }

  if (firstHeader(context.request.headers[WEB_CLI_CACHE_HEADER]) !== "1") {
    sendJson(context.response, 403, { error: "missing internal web CLI cache header" });
    return true;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody(context.request, { maxBytes: WEB_CLI_TEAM_FLEET_MAX_BYTES });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(context.response, message === "Request body too large" ? 413 : 400, { error: message });
    return true;
  }

  const fleet = payload.fleet;
  if (!fleet || typeof fleet !== "object" || !Array.isArray((fleet as { projects?: unknown }).projects)) {
    sendJson(context.response, 400, { error: "fleet.projects is required" });
    return true;
  }

  const hasSharedData = typeof payload.hasSharedData === "boolean" ? payload.hasSharedData : undefined;
  context.service.setCoordinatedTeamFleet(fleet as FleetResponse, hasSharedData);
  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleWebCliQueryRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/web-cli/query") {
    return false;
  }

  if (!isLoopbackWebCliRequest(context)) {
    sendJson(context.response, 403, { error: "web CLI queries are only available from loopback clients" });
    return true;
  }

  const query = parseWebCliQuery(context);
  if ("error" in query) {
    sendJson(context.response, 400, { error: query.error });
    return true;
  }

  const result = await context.service.queryWebCli(query);
  if (!result.ok) {
    sendJson(context.response, result.status, { error: result.error, candidates: result.candidates ?? [] });
    return true;
  }

  sendJson(context.response, 200, result.response);
  return true;
}

async function handleIntegrationSettingsRoute(context: RequestContext): Promise<boolean> {
  if (context.url.pathname !== "/api/settings/integrations") {
    return false;
  }

  if (matchesMethod(context, "GET")) {
    sendJson(context.response, 200, context.service.getIntegrationSettings());
    return true;
  }

  if (matchesMethod(context, "POST")) {
    const payload = await readJsonBody(context.request);
    const rawCursorApiKey = payload.cursorApiKey;
    const rawAppearance = payload.appearance;
    const rawMultiplayer = payload.multiplayer;
    if (rawCursorApiKey !== null && typeof rawCursorApiKey !== "string" && typeof rawCursorApiKey !== "undefined") {
      sendJson(context.response, 400, { error: "cursorApiKey must be a string or null" });
      return true;
    }
    if (
      rawAppearance !== null
      && typeof rawAppearance !== "undefined"
      && (typeof rawAppearance !== "object" || Array.isArray(rawAppearance))
    ) {
      sendJson(context.response, 400, { error: "appearance must be an object or null" });
      return true;
    }
    if (
      rawMultiplayer !== null
      && typeof rawMultiplayer !== "undefined"
      && (typeof rawMultiplayer !== "object" || Array.isArray(rawMultiplayer))
    ) {
      sendJson(context.response, 400, { error: "multiplayer must be an object or null" });
      return true;
    }

    if (typeof rawMultiplayer === "object" && rawMultiplayer) {
      const { enabled, host, room, nickname } = rawMultiplayer as Record<string, unknown>;
      if (typeof enabled !== "boolean" && typeof enabled !== "undefined") {
        sendJson(context.response, 400, { error: "multiplayer.enabled must be a boolean when provided" });
        return true;
      }
      if (host !== null && typeof host !== "string" && typeof host !== "undefined") {
        sendJson(context.response, 400, { error: "multiplayer.host must be a string or null" });
        return true;
      }
      if (room !== null && typeof room !== "string" && typeof room !== "undefined") {
        sendJson(context.response, 400, { error: "multiplayer.room must be a string or null" });
        return true;
      }
      if (nickname !== null && typeof nickname !== "string" && typeof nickname !== "undefined") {
        sendJson(context.response, 400, { error: "multiplayer.nickname must be a string or null" });
        return true;
      }
    }

    if (typeof rawAppearance === "object" && rawAppearance) {
      const { hatId } = rawAppearance as Record<string, unknown>;
      if (hatId !== null && typeof hatId !== "string" && typeof hatId !== "undefined") {
        sendJson(context.response, 400, { error: "appearance.hatId must be a string or null when provided" });
        return true;
      }
    }

    if (
      typeof rawCursorApiKey === "undefined"
      && typeof rawAppearance === "undefined"
      && typeof rawMultiplayer === "undefined"
    ) {
      sendJson(context.response, 400, { error: "cursorApiKey, appearance, or multiplayer is required" });
      return true;
    }

    if (typeof rawCursorApiKey !== "undefined") {
      const cursorApiKey = typeof rawCursorApiKey === "string" ? rawCursorApiKey : null;
      await context.service.setCursorApiKey(cursorApiKey);
    }
    if (typeof rawAppearance !== "undefined") {
      await context.service.setAppearanceSettings(rawAppearance as {
        hatId?: string | null;
      } | null);
    }
    const response =
      typeof rawMultiplayer !== "undefined"
        ? await context.service.setMultiplayerSettings(rawMultiplayer as {
          enabled?: boolean;
          host?: string | null;
          room?: string | null;
          nickname?: string | null;
        } | null)
        : context.service.getIntegrationSettings();
    sendJson(context.response, 200, response);
    return true;
  }

  return false;
}

async function handleProjectFileRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/api/project-file") {
    return false;
  }

  const projectRoot = context.url.searchParams.get("projectRoot");
  const filePath = context.url.searchParams.get("path");
  if (!projectRoot || !filePath) {
    sendJson(context.response, 400, { error: "projectRoot and path are required" });
    return true;
  }

  await sendProjectFile(context.response, projectRoot, filePath, requestMethod(context));
  return true;
}

async function handleEventsRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/events") {
    return false;
  }

  context.service.registerSse(context.response);
  return true;
}

async function handleAppearanceRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/appearance/cycle") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (typeof payload.projectRoot !== "string" || typeof payload.agentId !== "string") {
    sendJson(context.response, 400, { error: "projectRoot and agentId are required" });
    return true;
  }

  await context.service.cycleAppearance(payload.projectRoot, payload.agentId);
  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleNeedsUserRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/needs-user/respond") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (typeof payload.projectRoot !== "string" || typeof payload.requestId !== "string" || typeof payload.decision !== "string") {
    sendJson(context.response, 400, { error: "projectRoot, requestId, and decision are required" });
    return true;
  }

  if (!["accept", "acceptForSession", "decline", "cancel"].includes(payload.decision)) {
    sendJson(context.response, 400, { error: "decision must be accept, acceptForSession, decline, or cancel" });
    return true;
  }

  const decision = payload.decision as "accept" | "acceptForSession" | "decline" | "cancel";

  try {
    await context.service.respondToApprovalRequest(payload.projectRoot, payload.requestId, decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(context.response, 400, { error: message });
    return true;
  }

  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleNeedsUserInputRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/needs-user/answer") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (
    typeof payload.projectRoot !== "string"
    || typeof payload.requestId !== "string"
    || typeof payload.answers !== "object"
    || !payload.answers
    || Array.isArray(payload.answers)
  ) {
    sendJson(context.response, 400, { error: "projectRoot, requestId, and answers are required" });
    return true;
  }

  try {
    await context.service.respondToInputRequest(
      payload.projectRoot,
      payload.requestId,
      payload.answers as Record<string, { answers: string[] }>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(context.response, 400, { error: message });
    return true;
  }

  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleThreadReplyRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/thread/reply") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (
    typeof payload.projectRoot !== "string"
    || typeof payload.threadId !== "string"
    || typeof payload.text !== "string"
  ) {
    sendJson(context.response, 400, { error: "projectRoot, threadId, and text are required" });
    return true;
  }

  try {
    await context.service.sendThreadReply(payload.projectRoot, payload.threadId, payload.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(context.response, 400, { error: message });
    return true;
  }

  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleRoomsScaffoldRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/rooms/scaffold") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (typeof payload.projectRoot !== "string") {
    sendJson(context.response, 400, { error: "projectRoot is required" });
    return true;
  }

  const filePath = await context.service.scaffoldRooms(payload.projectRoot);
  sendJson(context.response, 200, { ok: true, filePath });
  return true;
}

async function handleRefreshRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/refresh") {
    return false;
  }

  sendJson(context.response, 200, await context.service.refreshAll());
  return true;
}

const ROUTES: RouteHandler[] = [
  handleAssetRoute,
  handleClientBundleRoute,
  handleVendorRoute,
  handleHomeRoute,
  handleIconAuditRoute,
  handleSceneEffectsAuditRoute,
  handleZOrderAuditRoute,
  handleFleetRoute,
  handleServerMetaRoute,
  handleMultiplayerStatusRoute,
  handleWebCliTeamFleetRoute,
  handleWebCliQueryRoute,
  handleIntegrationSettingsRoute,
  handleProjectFileRoute,
  handleEventsRoute,
  handleAppearanceRoute,
  handleNeedsUserRoute,
  handleNeedsUserInputRoute,
  handleThreadReplyRoute,
  handleRoomsScaffoldRoute,
  handleRefreshRoute
];

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
  service: FleetLiveService
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const context: RequestContext = {
    request,
    response,
    url,
    options,
    service
  };

  for (const route of ROUTES) {
    if (await route(context)) {
      return;
    }
  }

  notFound(response);
}
