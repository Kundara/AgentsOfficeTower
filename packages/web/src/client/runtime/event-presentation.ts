import type { AgentActivityEvent, DashboardEvent } from "@codex-agents-office/core";

type IconCatalog = Readonly<Record<string, string>>;
type PresentationEvent = Partial<DashboardEvent & AgentActivityEvent> & {
  type?: string;
};
type HistoryEntry = { createdAt?: string | null } | null | undefined;

export function createEventPresentation(catalogs: {
  eventIconUrls: IconCatalog;
  threadItemIconUrls: IconCatalog;
}) {
  const { eventIconUrls, threadItemIconUrls } = catalogs;

  function notificationLabel(event: PresentationEvent | null | undefined): string {
    if (!event) return "";
    switch (event.action) {
      case "created": return "Created";
      case "deleted": return "Deleted";
      case "moved": return "Moved";
      case "edited": return event.isImage ? "Updated" : "Edited";
      case "ran": return "Ran";
      case "said": return "Update";
      default: return "Changed";
    }
  }

  function notificationKindClassForFileChange(action: PresentationEvent["action"]): string {
    switch (action) {
      case "created": return "create";
      case "deleted": return "blocked";
      case "moved": return "update";
      default: return "edit";
    }
  }

  function extensionForNotificationPath(location: unknown): string {
    const normalized = String(location || "").split(/[?#]/)[0].toLowerCase();
    return normalized.match(/[.]([a-z0-9]+)$/)?.[1] ?? "";
  }

  function isScriptFileChangeEvent(event: PresentationEvent | null | undefined): boolean {
    if (!event || (event.kind !== "fileChange" && event.type !== "fileChange")) return false;
    const extension = extensionForNotificationPath(event.path || event.title || event.detail || "");
    return [
      "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "sass", "less", "html",
      "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "cc", "cpp", "h",
      "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql",
      "graphql", "gql", "vue", "svelte", "astro", "lua", "pl", "r"
    ].includes(extension);
  }

  function eventIconUrlForMethod(method: unknown): string | null {
    if (typeof method !== "string" || method.length === 0) return null;
    if (Object.prototype.hasOwnProperty.call(eventIconUrls, method)) return eventIconUrls[method] ?? null;
    if (method === "item/fileChange/patchUpdated") return eventIconUrls["item/fileChange/outputDelta"] ?? null;
    if (method === "item/commandExecution/terminalInteraction") return eventIconUrls["item/commandExecution/outputDelta"] ?? null;
    if ([
      "item/mcpToolCall/progress",
      "mcpServer/startupStatus/updated",
      "mcpServer/oauthLogin/completed",
      "hook/started",
      "hook/completed"
    ].includes(method)) return eventIconUrls["item/tool/call"] ?? null;
    if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      return eventIconUrls["item/commandExecution/requestApproval"] ?? null;
    }
    if (method === "turn/interrupted" || method === "turn/failed") return eventIconUrls["turn/completed"] ?? null;
    return null;
  }

  function eventIconUrlForThreadItemType(type: unknown): string | null {
    if (typeof type !== "string" || type.length === 0) return null;
    return Object.prototype.hasOwnProperty.call(threadItemIconUrls, type)
      ? threadItemIconUrls[type] ?? null
      : null;
  }

  function scriptFileChangeIconUrl(event: PresentationEvent | null | undefined): string | null {
    return isScriptFileChangeEvent(event)
      ? eventIconUrlForThreadItemType("scriptEdit") || "/assets/pixel-office/sprites/icons/thread-item/scriptEdit.png"
      : null;
  }

  function eventIconUrlForActivityType(
    type: unknown,
    options: { approvalType?: string; isCommand?: boolean } = {}
  ): string | null {
    switch (type) {
      case "approval":
        return eventIconUrlForMethod(options.approvalType === "fileChange"
          ? "item/fileChange/requestApproval"
          : "item/commandExecution/requestApproval");
      case "input": return eventIconUrlForMethod("item/tool/requestUserInput");
      default: return options.isCommand ? null : eventIconUrlForThreadItemType(type);
    }
  }

  function eventIconUrlForDashboardEvent(event: PresentationEvent | null | undefined): string | null {
    if (!event) return null;
    const itemIconUrl = eventIconUrlForThreadItemType(event.itemType);
    const methodIconUrl = eventIconUrlForMethod(event.method);
    const scriptFileIconUrl = scriptFileChangeIconUrl(event);
    if (scriptFileIconUrl) return scriptFileIconUrl;
    if (
      event.kind === "tool"
      || event.kind === "subagent"
      || event.method === "item/tool/call"
      || event.method === "item/mcpToolCall/progress"
    ) return itemIconUrl || methodIconUrl;
    return methodIconUrl || itemIconUrl;
  }

  function threadHistoryEntryTimeMs(entry: HistoryEntry): number {
    if (!entry || typeof entry.createdAt !== "string") return 0;
    const value = Date.parse(entry.createdAt);
    return Number.isFinite(value) ? value : 0;
  }

  function historyToneForEvent(event: PresentationEvent | null | undefined) {
    if (!event) return { tone: "system", label: "Note" } as const;
    if (event.kind === "message") {
      if (event.method?.startsWith("item/reasoning/")) return { tone: "thinking", label: "Think" } as const;
      return { tone: "agent", label: "Agent" } as const;
    }
    if (event.kind === "approval") return { tone: "waiting", label: "Wait" } as const;
    if (event.kind === "input") return { tone: "input", label: "Ask" } as const;
    if (event.kind === "command") return { tone: "run", label: "Run" } as const;
    if (event.kind === "fileChange") return { tone: "edit", label: "Edit" } as const;
    if (event.kind === "tool") return { tone: "tool", label: "Tool" } as const;
    if (event.kind === "turn") return { tone: "plan", label: "Turn" } as const;
    return { tone: "system", label: "Note" } as const;
  }

  function historyBodyForEvent(event: PresentationEvent | null | undefined): string {
    if (!event) return "";
    if (event.kind === "approval" || event.kind === "input") {
      return event.detail || event.title || "Waiting for input.";
    }
    if (["command", "fileChange", "tool", "turn"].includes(event.kind ?? "")) {
      return event.detail || event.title || event.method || "Updated.";
    }
    return event.detail || event.title || "Updated.";
  }

  function threadEntryExpansionStateKey(threadId: unknown, entryKey: unknown): string {
    return [threadId || "", entryKey || ""].join("::");
  }

  function threadEntryLooksLong(body: unknown): boolean {
    const text = String(body || "");
    if (!text.trim()) return false;
    return text.split(/\r\n|\r|\n/).length > 8 || text.length > 520;
  }

  return {
    notificationLabel,
    notificationKindClassForFileChange,
    extensionForNotificationPath,
    isScriptFileChangeEvent,
    scriptFileChangeIconUrl,
    eventIconUrlForMethod,
    eventIconUrlForThreadItemType,
    eventIconUrlForActivityType,
    eventIconUrlForDashboardEvent,
    threadHistoryEntryTimeMs,
    historyToneForEvent,
    historyBodyForEvent,
    threadEntryExpansionStateKey,
    threadEntryLooksLong
  };
}
