export function isCodexChatProjectRootForStreetCafe(projectRoot: unknown): boolean {
  const normalized = String(projectRoot ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
  return /(?:^|\/)documents\/codex$/i.test(normalized);
}
