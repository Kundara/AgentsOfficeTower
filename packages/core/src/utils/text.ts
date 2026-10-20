export function shortenText(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function isMeaningfulText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

const SHELL_WRAPPER_PATTERN =
  /^\s*(?:"([^"]+)"|(\S+))\s+(?:-(?:NoLogo|NoProfile|NonInteractive)\s+|-ExecutionPolicy\s+\S+\s+)*(-Command|-c|-lc|\/c)\s+([\s\S]+)$/i;
const SHELL_WRAPPER_EXECUTABLES = /^(?:powershell|pwsh|cmd|bash|sh|zsh)(?:\.exe)?$/i;

// Reads one POSIX shell word made of concatenated quoted/unquoted segments,
// e.g. 'a='"'"'b'"'"'' -> a='b'. Returns null when the text is several words.
function unquotePosixWord(text: string): string | null {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      const end = text.indexOf("'", index + 1);
      if (end === -1) {
        return null;
      }
      output += text.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === "\"") {
      index += 1;
      while (index < text.length && text[index] !== "\"") {
        if (text[index] === "\\" && /["\\$`]/.test(text[index + 1] ?? "")) {
          index += 1;
        }
        output += text[index];
        index += 1;
      }
      if (index >= text.length) {
        return null;
      }
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      return null;
    }
    output += char;
    index += 1;
  }
  return output;
}

// Codex on Windows reports commands as `"...\powershell.exe" -Command '<script>'`
// (and Unix shells as `bash -lc '<script>'`). Show the script the agent wrote.
export function unwrapShellCommand(command: string): string {
  const match = SHELL_WRAPPER_PATTERN.exec(command);
  if (!match) {
    return command;
  }
  const executable = (match[1] ?? match[2] ?? "").split(/[\\/]/).at(-1) ?? "";
  if (!SHELL_WRAPPER_EXECUTABLES.test(executable)) {
    return command;
  }
  const body = match[4].trim();
  const unquoted = unquotePosixWord(body);
  const script = (unquoted ?? body).trim();
  return script.length > 0 ? script : command;
}

export function looksLikeValidationCommand(command: string): boolean {
  return /\b(test|tests|lint|build|check|verify|pytest|cargo test|go test|npm test|pnpm test|vitest|jest)\b/i.test(
    command
  );
}

