import { PRIMARY_PANE_ID } from "../../panes/paneLayout";
import { usePaneFocusStore } from "../../panes/paneStore";
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

export function dispatchPreviewAction(
  action: PreviewAction,
  paneId = usePaneFocusStore.getState().focusedPaneId ?? PRIMARY_PANE_ID,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PreviewActionMessage>(EVENT_NAME, { detail: { action, paneId } }),
  );
}

/** Subscribes to actions addressed to `paneId`; other panes' actions are ignored. */
export function subscribePreviewAction(
  listener: (action: PreviewAction) => void,
  paneId: string = PRIMARY_PANE_ID,
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
