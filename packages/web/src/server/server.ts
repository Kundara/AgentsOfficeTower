import { createServer } from "node:http";

import { FleetLiveService } from "./fleet-live-service";
import { sendJson } from "../http-helpers";
import { handleRequest } from "./router";
import { buildServerMeta } from "./server-metadata";
import { parseArgs } from "./server-options";

let disconnectExceptionGuardInstalled = false;

function isClientDisconnectError(error: NodeJS.ErrnoException): boolean {
  return error.code === "EPIPE" || error.code === "ECONNRESET";
}

function installClientDisconnectExceptionGuard(): void {
  if (disconnectExceptionGuardInstalled) {
    return;
  }
  disconnectExceptionGuardInstalled = true;
  process.on("uncaughtException", (error) => {
    const socketError = error as NodeJS.ErrnoException;
    if (isClientDisconnectError(socketError)) {
      console.warn(
        `Agents Office Tower ignored disconnected client socket error: ${socketError.code}`
      );
      return;
    }
    throw error;
  });
}

export async function startWebServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  installClientDisconnectExceptionGuard();
  const options = parseArgs(argv);
  const service = new FleetLiveService(options.projects, options.explicitProjects);
  const meta = buildServerMeta(options, options.projects, service.getMultiplayerStatus());
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, service).catch((error) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  server.on("connection", (socket) => {
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (isClientDisconnectError(error)) {
        return;
      }
      console.error(
        `Agents Office Tower client socket failed: ${error.stack ?? error.message}`
      );
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(options.port, options.host, () => {
      resolvePromise();
    });
  });

  const mode = options.explicitProjects ? "pinned" : "fleet";
  const scope = options.explicitProjects
    ? options.projects.map((project) => project.root).join(", ")
    : `autodiscover (seed ${options.projects.map((project) => project.root).join(", ")})`;
  console.log(
    `Agents Office Tower web listening on http://${options.host}:${options.port} pid=${meta.pid} build=${meta.buildAt} mode=${mode} scope=${scope}`
  );

  void service.start().catch((error) => {
    console.error(
      `Agents Office Tower fleet startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
    );
  });

  const shutdown = () => {
    const forceExitTimer = setTimeout(() => {
      console.error("Shutdown grace period elapsed with connections still open; exiting.");
      process.exit(0);
    }, 5000);
    forceExitTimer.unref();
    void service.stop().finally(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  void startWebServer();
}
