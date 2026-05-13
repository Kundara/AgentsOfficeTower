import { env, exit } from "node:process";

interface WebQueryCliOptions {
  repo: string;
  command: "recent" | "last";
  scope: "local" | "team";
  values: Record<string, string | number>;
  json: boolean;
  serverBase: string;
}

function normalizeServerBase(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function webQueryHost(host: string): string {
  const normalized = host.trim();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]"
    ? "127.0.0.1"
    : normalized;
}

function defaultWebServerBase(): string {
  const host = webQueryHost(env.CODEX_AGENTS_OFFICE_HOST ?? "127.0.0.1");
  const port = Number.parseInt(env.CODEX_AGENTS_OFFICE_PORT ?? "4181", 10);
  return `http://${host}:${Number.isFinite(port) ? port : 4181}`;
}

function setWebQueryValue(
  options: { scope: "local" | "team"; values: Record<string, string | number>; serverBase: string },
  key: string,
  value: string
): void {
  if (key === "scope") {
    if (value !== "local" && value !== "team") {
      throw new Error("scope must be local or team");
    }
    options.scope = value;
    return;
  }

  if (key === "server") {
    options.serverBase = normalizeServerBase(value);
    return;
  }

  if (key === "host") {
    const current = new URL(options.serverBase);
    current.hostname = webQueryHost(value);
    options.serverBase = current.toString();
    return;
  }

  if (key === "port") {
    const current = new URL(options.serverBase);
    const port = Number.parseInt(value, 10);
    if (!Number.isFinite(port)) {
      throw new Error("port must be a number");
    }
    current.port = String(port);
    options.serverBase = current.toString();
    return;
  }

  if (!["limit", "type", "state", "source", "kind", "since", "agent"].includes(key)) {
    throw new Error(`Unsupported query value: ${key}`);
  }

  if (key === "limit") {
    const limit = Number.parseInt(value, 10);
    if (!Number.isFinite(limit)) {
      throw new Error("limit must be a number");
    }
    options.values.limit = limit;
    return;
  }

  options.values[key] = value;
}

function parseWebQueryCliArgs(args: string[]): WebQueryCliOptions {
  const positionals: string[] = [];
  const options = {
    scope: "local" as "local" | "team",
    values: {} as Record<string, string | number>,
    serverBase: defaultWebServerBase()
  };
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--server" || arg === "--host" || arg === "--port" || arg === "--scope" || arg === "--limit" || arg === "--type" || arg === "--state" || arg === "--source" || arg === "--kind" || arg === "--since" || arg === "--agent") {
      const key = arg.slice(2);
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      setWebQueryValue(options, key, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  const [repo, command, ...extras] = positionals;
  if (!repo || !command) {
    throw new Error("web query requires <repo> and <recent|last>");
  }
  if (command !== "recent" && command !== "last") {
    throw new Error("web query command must be recent or last");
  }

  for (const extra of extras) {
    if ((extra === "local" || extra === "team") && options.scope === "local") {
      options.scope = extra;
      continue;
    }
    const separator = extra.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Query values must be key=value pairs: ${extra}`);
    }
    setWebQueryValue(options, extra.slice(0, separator), extra.slice(separator + 1));
  }

  return {
    repo,
    command,
    scope: options.scope,
    values: options.values,
    json,
    serverBase: options.serverBase
  };
}

function buildWebQueryUrl(options: WebQueryCliOptions): string {
  const url = new URL("/api/web-cli/query", options.serverBase.endsWith("/") ? options.serverBase : `${options.serverBase}/`);
  url.searchParams.set("repo", options.repo);
  url.searchParams.set("command", options.command);
  url.searchParams.set("scope", options.scope);
  for (const [key, value] of Object.entries(options.values)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function formatCacheAge(ageMs: unknown): string {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) {
    return "unknown age";
  }
  if (ageMs < 1000) {
    return `${Math.round(ageMs)}ms old`;
  }
  if (ageMs < 60000) {
    return `${Math.round(ageMs / 1000)}s old`;
  }
  return `${Math.round(ageMs / 60000)}m old`;
}

function formatWebQueryItem(item: Record<string, unknown>): string {
  const timestamp = typeof item.timestamp === "string" ? item.timestamp : "";
  const type = typeof item.type === "string" ? item.type : "item";
  const label = typeof item.label === "string" ? item.label : "(untitled)";
  const detail = typeof item.detail === "string" && item.detail.length > 0 ? ` - ${item.detail}` : "";
  const peer = typeof item.peerLabel === "string" && item.peerLabel.length > 0 ? ` @ ${item.peerLabel}` : "";
  if (type === "agent") {
    const source = typeof item.source === "string" ? item.source : "unknown";
    const state = typeof item.state === "string" ? item.state : "unknown";
    return `  - ${timestamp} [agent/${source}/${state}] ${label}${peer}${detail}`;
  }
  const kind = typeof item.eventKind === "string" ? item.eventKind : "event";
  const phase = typeof item.eventPhase === "string" ? item.eventPhase : "updated";
  return `  - ${timestamp} [event/${kind}/${phase}] ${label}${detail}`;
}

function printWebQueryResponse(payload: Record<string, unknown>): void {
  const project = payload.matchedProject && typeof payload.matchedProject === "object"
    ? payload.matchedProject as Record<string, unknown>
    : {};
  const items = Array.isArray(payload.items) ? payload.items as Record<string, unknown>[] : [];
  const teamNote = payload.scope === "team"
    ? payload.teamDataAvailable === true
      ? `, team cache ${formatCacheAge(payload.teamCacheAgeMs)}`
      : ", no coordinated team cache"
    : "";

  console.log(`Repo: ${String(project.repoName || project.projectLabel || payload.repo)}`);
  console.log(`Project: ${String(project.projectLabel || "(unknown)")}`);
  console.log(`Query: ${String(payload.scope)} ${String(payload.command)} (${String(payload.dataSource)}${teamNote})`);
  if (items.length === 0) {
    console.log("  (no matching data)");
    return;
  }
  for (const item of items) {
    console.log(formatWebQueryItem(item));
  }
}

export async function runWebQuery(args: string[], showUsage: () => void): Promise<void> {
  let options: WebQueryCliOptions;
  try {
    options = parseWebQueryCliArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    showUsage();
    exit(1);
  }

  let response: Response;
  const url = buildWebQueryUrl(options);
  try {
    response = await fetch(url);
  } catch (error) {
    console.error(`Could not reach Agents Office web server at ${options.serverBase}: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }

  const rawPayload = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    payload = { error: rawPayload };
  }
  if (!response.ok) {
    console.error(typeof payload.error === "string" ? payload.error : `Web query failed with HTTP ${response.status}`);
    if (Array.isArray(payload.candidates) && payload.candidates.length > 0) {
      console.error("Candidates:");
      for (const candidate of payload.candidates as Array<Record<string, unknown>>) {
        console.error(`  - ${String(candidate.repoName || candidate.projectLabel || candidate.projectRoot)}`);
      }
    }
    exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  printWebQueryResponse(payload);
}
