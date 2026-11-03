/**
 * "Measure now" broadcast for every mounted browser surface slot.
 *
 * A slot re-measures from its own ResizeObserver, which only fires when the
 * slot's box changes size. A pane splitter drag can translate a fixed-size
 * slot sideways without resizing it, and the guest would stay behind at its
 * old x. Anything that moves slots without resizing them pings this instead.
 *
 * Notifications coalesce onto one animation frame, so a drag emitting a
 * pointermove per frame measures once per frame rather than once per event,
 * and a burst of pane edits collapses into a single measuring pass.
 */
const listeners = new Set<() => void>();
let scheduledFrame: number | null = null;

export function subscribeBrowserSurfaceLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function flush(): void {
  scheduledFrame = null;
  for (const listener of [...listeners]) listener();
}

export function notifyBrowserSurfaceLayoutChanged(): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    flush();
    return;
  }
  if (scheduledFrame !== null) return;
  scheduledFrame = window.requestAnimationFrame(flush);
}
