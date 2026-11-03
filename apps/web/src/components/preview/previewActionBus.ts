"use client";

/**
 * Typed window-event bus for preview-panel actions. Lets the global
 * keybinding handler in `routes/_chat.tsx` reach `ChatView`'s URL-aware
 * arbitration without prop drilling or shared refs.
 *
 * Every action carries the pane it is meant for. In a split layout several
 * ChatViews are mounted at once, and an unaddressed broadcast would toggle
 * the preview in all of them.
 */
export type PreviewAction =
  | "toggle-panel"
  | "refresh"
  | "focus-url"
  | "zoom-in"
  | "zoom-out"
  | "reset-zoom";

export interface PreviewActionMessage {
  readonly action: PreviewAction;
  /** Pane the action is addressed to. */
  readonly paneId: string;
}

const EVENT_NAME = "t3code:preview-action";

export function dispatchPreviewAction(action: PreviewAction, paneId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PreviewActionMessage>(EVENT_NAME, { detail: { action, paneId } }),
  );
}

/** Subscribes to actions addressed to `paneId`; other panes' actions are ignored. */
export function subscribePreviewAction(
  paneId: string,
  listener: (action: PreviewAction) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PreviewActionMessage>).detail;
    if (!detail || typeof detail.action !== "string") return;
    if (detail.paneId !== paneId) return;
    listener(detail.action);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
