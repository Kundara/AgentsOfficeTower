import * as http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";

import { resolveReadableRoomsFilePath, scaffoldRoomsFile } from "@codex-agents-office/core";
import * as vscode from "vscode";

const VIEW_ID = "codexAgentsOffice.view";
const REFRESH_COMMAND = "codexAgentsOffice.refresh";
const OPEN_ROOMS_XML_COMMAND = "codexAgentsOffice.openRoomsXml";
const SCAFFOLD_ROOMS_XML_COMMAND = "codexAgentsOffice.scaffoldRoomsXml";

interface EmbeddedServer {
  process: ChildProcess;
  projectRoot: string;
  port: number;
  baseUrl: string;
  logs: string[];
}

class OfficeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private server: EmbeddedServer | undefined;
  private startingServer: Promise<string> | undefined;
  private disposed = false;
  private currentOfficeUrl: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    void this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    void this.stopServer();
  }

  async refresh(forceRestart = false): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      await this.postMessage({
        type: "emptyWorkspace"
      });
      return;
    }

    await this.postMessage({
      type: "loading",
      detail: `Starting Agents Office for ${projectRoot}`
    });

    try {
      const baseUrl = await this.ensureServer(projectRoot, forceRestart);
      const officeUrl = this.buildOfficeUrl(baseUrl, projectRoot);
      this.currentOfficeUrl = officeUrl;
      await this.postMessage({
        type: "office",
        url: officeUrl
      });
    } catch (error) {
      await this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async openRoomsXml(scaffoldIfMissing: boolean): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return;
    }

    const filePath = scaffoldIfMissing
      ? await scaffoldRoomsFile(projectRoot)
      : await resolveReadableRoomsFilePath(projectRoot);

    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private getProjectRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private buildOfficeUrl(baseUrl: string, projectRoot: string): string {
    const selectedProjectRoot = canonicalizeProjectPath(projectRoot) ?? projectRoot;
    const params = new URLSearchParams({
      project: selectedProjectRoot,
      view: "map",
      embedded: "1",
      reload: String(Date.now())
    });
    return `${baseUrl}/?${params.toString()}`;
  }

  private async handleMessage(message: { type?: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "refresh":
        await this.refresh(true);
        return;
      case "openInBrowser":
        if (this.currentOfficeUrl) {
          await vscode.env.openExternal(vscode.Uri.parse(this.currentOfficeUrl));
        }
        return;
      case "openRoomsXml":
        await this.openRoomsXml(false);
        return;
      case "scaffoldRoomsXml":
        await this.openRoomsXml(true);
        return;
      default:
        return;
    }
  }

  private async ensureServer(projectRoot: string, forceRestart: boolean): Promise<string> {
    const activeServer = this.server;
    if (
      !forceRestart
      && activeServer
      && activeServer.projectRoot === projectRoot
      && activeServer.process.exitCode === null
      && !activeServer.process.killed
    ) {
      return activeServer.baseUrl;
    }

    if (this.startingServer) {
      return this.startingServer;
    }

    this.startingServer = this.startServer(projectRoot).finally(() => {
      this.startingServer = undefined;
    });
    return this.startingServer;
  }

  private async startServer(projectRoot: string): Promise<string> {
    await this.stopServer();

    const port = await findAvailablePort();
    const launch = await resolveServerLaunch(projectRoot, this.context.extensionPath, port);
    const childProcess = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const server: EmbeddedServer = {
      process: childProcess,
      projectRoot,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      logs: []
    };

    const appendLog = (chunk: Buffer): void => {
      const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      server.logs.push(...lines);
      if (server.logs.length > 20) {
        server.logs.splice(0, server.logs.length - 20);
      }
    };

    childProcess.stdout.on("data", appendLog);
    childProcess.stderr.on("data", appendLog);
    childProcess.once("exit", (code, signal) => {
      if (this.server?.process === childProcess) {
        this.server = undefined;
      }
      if (!this.disposed && this.view && code !== 0 && signal !== "SIGTERM") {
        void this.postMessage({
          type: "error",
          message: `Agents Office server exited early (${formatExit(code, signal)}).\n${this.formatServerLogs(server)}`
        });
      }
    });

    this.server = server;

    try {
      await waitForServer(server);
      return server.baseUrl;
    } catch (error) {
      await this.stopServer();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n${this.formatServerLogs(server)}`.trim());
    }
  }

  private formatServerLogs(server: EmbeddedServer): string {
    if (server.logs.length === 0) {
      return "No server logs were captured.";
    }
    return `Recent server logs:\n${server.logs.join("\n")}`;
  }

  private async stopServer(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    if (server.process.exitCode !== null || server.process.killed) {
      return;
    }

    server.process.kill("SIGTERM");
    try {
      await Promise.race([
        once(server.process, "exit"),
        delay(2000)
      ]);
    } catch {
      // Ignore shutdown races.
    }

    if (server.process.exitCode === null && !server.process.killed) {
      server.process.kill("SIGKILL");
      try {
        await once(server.process, "exit");
      } catch {
        // Ignore shutdown races.
      }
    }
  }

  private async postMessage(payload: Record<string, unknown>): Promise<void> {
    await this.view?.webview.postMessage(payload);
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:*; connect-src http://127.0.0.1:*;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b130f;
        --panel: rgba(20, 33, 28, 0.96);
        --border: #315143;
        --text: #f5efdd;
        --muted: #b0c0b7;
        --accent: #4bd69f;
        --danger: #f06d5e;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(75, 214, 159, 0.12), transparent 28%),
          linear-gradient(180deg, #0b130f 0%, #111b17 100%);
        color: var(--text);
        font-family: "Cascadia Code", "IBM Plex Mono", monospace;
      }

      .shell {
        display: grid;
        grid-template-rows: auto 1fr;
        width: 100%;
        height: 100%;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }

      .title {
        min-width: 0;
      }

      .title strong {
        display: block;
      }

      .status {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      button {
        cursor: pointer;
        border: 1px solid var(--border);
        background: rgba(26, 45, 37, 0.94);
        color: var(--text);
        padding: 7px 10px;
        font: inherit;
      }

      button:hover {
        border-color: var(--accent);
      }

      .viewport {
        position: relative;
        min-height: 0;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        background: #0f1714;
      }

      .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(11, 19, 15, 0.92);
        text-align: center;
        white-space: pre-wrap;
      }

      .overlay.hidden {
        display: none;
      }

      .panel {
        max-width: 520px;
        border: 1px solid var(--border);
        background: rgba(20, 33, 28, 0.96);
        padding: 18px;
      }

      .panel strong {
        display: block;
        margin-bottom: 8px;
      }

      .panel.error {
        border-color: rgba(240, 109, 94, 0.5);
      }

      .panel.error .detail {
        color: #ffd1cb;
      }

      .detail {
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="toolbar">
        <div class="title">
          <strong>Agents Office Tower</strong>
          <div id="status" class="status">Starting embedded office renderer…</div>
        </div>
        <div class="actions">
          <button data-action="refresh">Reload</button>
          <button data-action="openInBrowser">Open Browser</button>
          <button data-action="openRoomsXml">Rooms XML</button>
        </div>
      </div>
      <div class="viewport">
        <iframe id="office-frame" title="Agents Office Tower"></iframe>
        <div id="overlay" class="overlay">
          <div id="overlay-panel" class="panel">
            <strong>Starting Agents Office Tower</strong>
            <div id="overlay-detail" class="detail">Loading the real office renderer for this workspace…</div>
          </div>
        </div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const statusEl = document.getElementById("status");
      const overlay = document.getElementById("overlay");
      const overlayPanel = document.getElementById("overlay-panel");
      const overlayDetail = document.getElementById("overlay-detail");
      const frame = document.getElementById("office-frame");
      let currentUrl = "";

      function showOverlay(title, detail, isError = false) {
        overlay.classList.remove("hidden");
        overlayPanel.classList.toggle("error", isError);
        overlayPanel.querySelector("strong").textContent = title;
        overlayDetail.textContent = detail;
        statusEl.textContent = detail;
      }

      function hideOverlay() {
        overlay.classList.add("hidden");
      }

      frame.addEventListener("load", () => {
        if (currentUrl) {
          statusEl.textContent = "Live office renderer";
          hideOverlay();
        }
      });

      document.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const action = target.dataset.action;
        if (action) {
          vscode.postMessage({ type: action, url: currentUrl });
        }
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "loading") {
          showOverlay("Starting Agents Office Tower", message.detail || "Loading the office renderer…");
          return;
        }

        if (message.type === "office") {
          currentUrl = message.url;
          showOverlay("Loading workspace office", "Connecting the embedded office view…");
          frame.src = currentUrl;
          return;
        }

        if (message.type === "emptyWorkspace") {
          currentUrl = "";
          frame.removeAttribute("src");
          showOverlay("No workspace open", "Open a folder in VS Code to render its office view.");
          return;
        }

        if (message.type === "error") {
          currentUrl = "";
          frame.removeAttribute("src");
          showOverlay("Embedded office failed to start", message.message || "Unknown error.", true);
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 16; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

async function resolveWorkspaceServerEntry(projectRoot: string, extensionPath: string): Promise<string> {
  const candidates = [
    path.join(projectRoot, "packages", "web", "dist", "server.js"),
    path.join(projectRoot, "node_modules", "@codex-agents-office", "web", "dist", "server.js"),
    path.join(extensionPath, "node_modules", "@codex-agents-office", "web", "dist", "server.js")
  ];

  for (const candidate of candidates) {
    try {
      const entry = await stat(candidate);
      if (entry.isFile()) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    `Could not find Agents Office web server entry. Looked in:\n${candidates.join("\n")}`
  );
}

async function resolveServerLaunch(
  projectRoot: string,
  extensionPath: string,
  port: number
): Promise<{ command: string; args: string[]; cwd: string }> {
  const wslProjectRoot = windowsPathToWslPath(projectRoot);
  const wslServerEntry = wslProjectRoot ? `${wslProjectRoot.replace(/[\\/]+$/, "")}/packages/web/dist/server.js` : null;
  if (wslServerEntry) {
    const wslCommand = await resolveWslCommand();
    if (wslCommand) {
      const launchProjectRoot = wslProjectRoot!;
      const preferredWslCodexPath = await resolvePreferredWslCodexPath();
      const command = buildWslServerLaunchCommand({
        projectRoot: launchProjectRoot,
        serverEntry: wslServerEntry,
        port,
        preferredWslCodexPath
      });
      return {
        command: wslCommand,
        args: ["bash", "-lc", command],
        cwd: projectRoot
      };
    }
  }

  const serverEntry = await resolveWorkspaceServerEntry(projectRoot, extensionPath);
  return {
    command: process.execPath,
    args: [serverEntry, "--host", "127.0.0.1", "--port", String(port), "--seed-project", projectRoot],
    cwd: projectRoot
  };
}

async function resolvePreferredWslCodexPath(): Promise<string | null> {
  const windowsCandidates = [
    path.join(os.homedir(), ".codex", "bin", "wsl", "codex"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "OpenAI", "Codex", "resources", "codex")
  ];

  for (const candidate of windowsCandidates) {
    try {
      const entry = await stat(candidate);
      if (entry.isFile()) {
        return windowsPathToWslPath(candidate);
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function resolveWslCommand(): Promise<string | null> {
  const candidates = [
    "wsl.exe",
    "C:\\Windows\\System32\\wsl.exe"
  ];
  for (const candidate of candidates) {
    try {
      const entry = await stat(candidate);
      if (entry.isFile()) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function buildPreferredWslPathEnv(preferredWslCodexPath: string | null): string {
  const entries = [
    `/home/${os.userInfo().username}/.local/bin`,
    preferredWslCodexPath ? path.posix.dirname(preferredWslCodexPath) : null,
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    "/usr/games",
    "/usr/local/games",
    "/usr/lib/wsl/lib",
    "/snap/bin"
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return Array.from(new Set(entries)).join(":");
}

function buildWslServerLaunchCommand(input: {
  projectRoot: string;
  serverEntry: string;
  port: number;
  preferredWslCodexPath: string | null;
}): string {
  const exports: string[] = [];
  const codexHome =
    windowsPathToWslPath(process.env.CODEX_HOME ?? "")
    ?? windowsPathToWslPath(path.join(os.homedir(), ".codex"));
  if (codexHome) {
    exports.push(`export CODEX_HOME=${quotePosixShell(codexHome)}`);
  }

  const preferredWslPath = buildPreferredWslPathEnv(input.preferredWslCodexPath);
  if (preferredWslPath) {
    exports.push(`export PATH=${quotePosixShell(preferredWslPath)}:"$PATH"`);
  }
  if (input.preferredWslCodexPath) {
    exports.push(`export CODEX_CLI_PATH=${quotePosixShell(input.preferredWslCodexPath)}`);
  }
  if (process.env.TERM) {
    exports.push(`export TERM=${quotePosixShell(process.env.TERM)}`);
  }

  return [
    `cd ${quotePosixShell(input.projectRoot)}`,
    ...exports,
    `exec node ${quotePosixShell(input.serverEntry)} --host 127.0.0.1 --port ${input.port} --seed-project ${quotePosixShell(input.projectRoot)}`
  ].join(" && ");
}

function quotePosixShell(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function windowsPathToWslPath(input: string): string | null {
  const value = String(input || "").trim();
  const driveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (driveMatch) {
    const [, drive, rest] = driveMatch;
    return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, "/")}`;
  }
  if (value.startsWith("/mnt/")) {
    return value.replace(/\\/g, "/");
  }
  if (os.platform() !== "win32") {
    return value || null;
  }
  return null;
}

function canonicalizeProjectPath(input: string): string | null {
  const value = String(input || "").trim();
  if (!value) {
    return null;
  }
  const wslPath = windowsPathToWslPath(value);
  if (wslPath) {
    return wslPath.replace(/[\\/]+$/, "");
  }
  if (value.startsWith("/")) {
    return value.replace(/\\/g, "/").replace(/[\\/]+$/, "");
  }
  return value.replace(/\\/g, "/").replace(/[\\/]+$/, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function findAvailablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate an embedded office port.");
  }
  return address.port;
}

async function waitForServer(server: EmbeddedServer, timeoutMs = 120000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.process.exitCode !== null) {
      throw new Error(`Agents Office server exited before it became ready (${formatExit(server.process.exitCode, null)}).`);
    }

    try {
      await requestServerMeta(server.baseUrl);
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for Agents Office at ${server.baseUrl}.`);
}

async function requestServerMeta(baseUrl: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}/api/server-meta`, (response) => {
      if (!response.statusCode || response.statusCode >= 400) {
        response.resume();
        reject(new Error(`Unexpected status ${response.statusCode ?? "unknown"}`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error("Timed out waiting for server response."));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  if (typeof code === "number") {
    return `code ${code}`;
  }
  return "unknown exit";
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new OfficeViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => provider.refresh(true)),
    vscode.commands.registerCommand(OPEN_ROOMS_XML_COMMAND, () => provider.openRoomsXml(false)),
    vscode.commands.registerCommand(SCAFFOLD_ROOMS_XML_COMMAND, () => provider.openRoomsXml(true)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void provider.refresh(true);
    })
  );
}

export function deactivate(): void {}
