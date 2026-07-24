import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";

import { canonicalizeProjectPath, filesystemPathForProjectRoot } from "@agents-tower/core";

const WEB_PUBLIC_DIR = resolve(__dirname, "../public");
const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024;

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
    case ".css":
      return "text/css; charset=utf-8";
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
  method: string,
  cacheControl = "public, max-age=3600"
): Promise<void> {
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "cache-control": cacheControl
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

export async function readJsonBody(
  request: IncomingMessage,
  options: { maxBytes?: number } = {}
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
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
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(filePath);
}

export async function sendProjectFile(
  response: ServerResponse,
  projectRoot: string,
  filePath: string,
  method: string
): Promise<void> {
  const normalizedRoot = resolve(
    filesystemPathForProjectRoot(canonicalizeProjectPath(projectRoot) ?? projectRoot)
  );
  const candidate = filePath.startsWith("/")
    ? resolve(filePath)
    : resolve(normalizedRoot, filePath);

  if (!isInsideDirectory(normalizedRoot, candidate) || !isPreviewableImage(candidate)) {
    notFound(response);
    return;
  }

  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(normalizedRoot),
      realpath(candidate)
    ]);
    if (!isInsideDirectory(realRoot, realCandidate)) {
      notFound(response);
      return;
    }

    const body = await readFile(realCandidate);
    response.writeHead(200, {
      "content-type": contentTypeForPath(realCandidate),
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
