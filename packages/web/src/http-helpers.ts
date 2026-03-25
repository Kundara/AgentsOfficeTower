import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";

import { canonicalizeProjectPath } from "@codex-agents-office/core";

const WEB_PUBLIC_DIR = resolve(__dirname, "../public");

function isInsideDirectory(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".ase":
    case ".aseprite":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

export async function sendStaticAsset(
  response: ServerResponse,
  assetPath: string,
  method: string
): Promise<void> {
  const normalizedAssetPath = normalize(assetPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(WEB_PUBLIC_DIR, normalizedAssetPath);
  if (!isInsideDirectory(WEB_PUBLIC_DIR, filePath)) {
    notFound(response);
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "cache-control": "public, max-age=3600"
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  } catch {
    notFound(response);
  }
}

export async function sendAbsoluteFileAsset(
  response: ServerResponse,
  filePath: string,
  method: string
): Promise<void> {
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "cache-control": "public, max-age=3600"
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  } catch {
    notFound(response);
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

export function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

export function notFound(response: ServerResponse): void {
  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end("Not found");
}

function isPreviewableImage(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filePath);
}

export async function sendProjectFile(
  response: ServerResponse,
  projectRoot: string,
  filePath: string,
  method: string
): Promise<void> {
  const normalizedRoot = canonicalizeProjectPath(projectRoot) ?? resolve(projectRoot);
  const candidate = filePath.startsWith("/")
    ? resolve(filePath)
    : resolve(normalizedRoot, filePath);

  if (!isInsideDirectory(normalizedRoot, candidate) || !isPreviewableImage(candidate)) {
    notFound(response);
    return;
  }

  try {
    const body = await readFile(candidate);
    response.writeHead(200, {
      "content-type": contentTypeForPath(candidate),
      "cache-control": "no-store"
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  } catch {
    notFound(response);
  }
}
