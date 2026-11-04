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
  for (const listener of listeners) listener();
}

export function notifyBrowserSurfaceLayoutChanged(): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    flush();
    return;
  }
  if (scheduledFrame !== null) return;
  scheduledFrame = window.requestAnimationFrame(flush);
}
