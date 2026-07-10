export function officeMapHorizontalWheelTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const host = target.closest("[data-office-map-host]");
  return host instanceof HTMLElement ? host : null;
}

export function wheelDeltaPixels(event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">): number {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? Math.max(window.innerHeight || 0, 1)
      : 1;
  const horizontalDelta = Math.abs(event.deltaX) >= 0.5
    ? event.deltaX
    : event.deltaY;
  return horizontalDelta * unit;
}

export function officeMapHorizontalMaxScrollLeft(host: HTMLElement): number {
  const canvas = host.querySelector("[data-office-map-canvas]");
  const canvasWidth = canvas instanceof HTMLElement
    ? Math.max(
      Number.parseFloat(canvas.style.width || ""),
      canvas.getBoundingClientRect().width,
      canvas.scrollWidth
    )
    : 0;
  const scrollWidth = Math.max(canvasWidth || 0, host.clientWidth);
  return Math.max(0, Math.round(scrollWidth - host.clientWidth));
}
