import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { startWebServer } from "@agents-tower/web";
import { buildDemoSnapshot } from "./demo-fixture";

export async function runDemoPreview(args: string[]): Promise<void> {
  const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] ?? fallback : fallback;
  const parsedPort = Number(value("--port", "4181"));
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 4181;
  const host = value("--host", "127.0.0.1");
  const duration = Number(value("--duration", "75"));
  const keep = args.includes("--keep");
  const fixedElapsed = args.includes("--at") ? Number(value("--at", "0")) * 1000 : null;
  if (fixedElapsed !== null && (!Number.isFinite(fixedElapsed) || fixedElapsed < 0)) throw new Error("--at requires non-negative seconds.");
  const projectRoot = await mkdtemp(join(tmpdir(), "agents-office-preview-"));
  await mkdir(join(projectRoot, "src"));
  await writeFile(join(projectRoot, "README.md"), "# Isolated Agents Office demo\n\nAll sessions and requests are in-memory fixtures. No provider is connected.\n");
  await writeFile(join(projectRoot, "src/demo.ts"), "// In-memory request lifecycle demo; no executable application.\n");
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (!keep) rmSync(projectRoot, { recursive: true, force: true });
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);
  const startedAt = Date.now();
  console.log(`DEMO workspace: ${projectRoot}`);
  console.log(`DEMO URL: http://${host}:${port}/?project=${encodeURIComponent(projectRoot)}`);
  console.log("Isolated fixtures: running → WAIT (5s) → OK (12s) → ASK (16s) → OK (24s) → done (32s). Requests are read-only.");
  await startWebServer([projectRoot, "--port", String(port), "--host", host], () => {
    const now = Date.now();
    const snapshot = buildDemoSnapshot(projectRoot, fixedElapsed === null ? startedAt : now - fixedElapsed, now);
    return { generatedAt: snapshot.generatedAt, projects: [snapshot], accountAgents: [] };
  });
  if (Number.isFinite(duration) && duration > 0) setTimeout(() => { cleanup(); process.exit(0); }, duration * 1000);
  await new Promise<void>(() => {});
}

export async function deletePreviewWorkspace(projectRoot: string): Promise<void> {
  const target = resolve(projectRoot);
  if (!basename(target).startsWith("agents-office-preview-") || resolve(target, "..") !== resolve(tmpdir())) {
    throw new Error("Only a generated preview workspace directly under the temporary directory can be deleted.");
  }
  await rm(target, { recursive: true, force: true });
}
