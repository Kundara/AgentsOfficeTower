export interface SessionFocusSnapshot {
  sessionKey: string;
  controlIndex: number;
  controlSignature: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection: "forward" | "backward" | "none" | null;
}

type SessionFocusable = HTMLElement & {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  selectionDirection?: "forward" | "backward" | "none" | null;
  setSelectionRange?: (
    start: number,
    end: number,
    direction?: "forward" | "backward" | "none"
  ) => void;
  value?: string;
};

const SESSION_FOCUSABLE_SELECTOR = "button, textarea, input, select, [tabindex]";

function sessionControlSignature(element: SessionFocusable): string {
  const dataset = Object.entries(element.dataset || {})
    .filter(([key]) => key !== "sessionKey" && key !== "renderHtml")
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([String(element.tagName || "").toLowerCase(), dataset]);
}

export function captureSessionFocus(
  container: HTMLElement,
  activeElement: Element | null = container.ownerDocument?.activeElement || null
): SessionFocusSnapshot | null {
  if (!activeElement || !container.contains(activeElement)) {
    return null;
  }
  const session = activeElement.closest<HTMLElement>("[data-session-key]");
  if (!session || !container.contains(session) || !session.dataset.sessionKey) {
    return null;
  }
  const controls = Array.from(session.querySelectorAll<SessionFocusable>(SESSION_FOCUSABLE_SELECTOR));
  const active = activeElement as SessionFocusable;
  const controlIndex = active === session ? -1 : controls.indexOf(active);
  const selectionStart = typeof active.selectionStart === "number" ? active.selectionStart : null;
  const selectionEnd = typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  return {
    sessionKey: session.dataset.sessionKey,
    controlIndex,
    controlSignature: active === session ? "" : sessionControlSignature(active),
    selectionStart,
    selectionEnd,
    selectionDirection: selectionStart === null ? null : active.selectionDirection || "none"
  };
}

export function restoreSessionFocus(
  container: HTMLElement,
  snapshot: SessionFocusSnapshot | null
): boolean {
  if (!snapshot) {
    return false;
  }
  const session = Array.from(container.querySelectorAll<HTMLElement>("[data-session-key]"))
    .find((candidate) => candidate.dataset.sessionKey === snapshot.sessionKey);
  if (!session) {
    return false;
  }
  const controls = Array.from(session.querySelectorAll<SessionFocusable>(SESSION_FOCUSABLE_SELECTOR));
  const signatureMatch = snapshot.controlSignature
    ? controls.find((candidate) => sessionControlSignature(candidate) === snapshot.controlSignature)
    : null;
  const indexedMatch = snapshot.controlIndex >= 0 ? controls[snapshot.controlIndex] : null;
  const target = snapshot.controlIndex === -1 ? session as SessionFocusable : signatureMatch || indexedMatch;
  if (!target || typeof target.focus !== "function") {
    return false;
  }
  target.focus({ preventScroll: true });
  if (
    snapshot.selectionStart !== null
    && snapshot.selectionEnd !== null
    && typeof target.setSelectionRange === "function"
  ) {
    const valueLength = typeof target.value === "string" ? target.value.length : snapshot.selectionEnd;
    const start = Math.min(snapshot.selectionStart, valueLength);
    const end = Math.min(Math.max(start, snapshot.selectionEnd), valueLength);
    target.setSelectionRange(start, end, snapshot.selectionDirection || "none");
  }
  return true;
}
