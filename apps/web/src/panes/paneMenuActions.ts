import { resolveFocusedPaneId } from "./paneFocus";
import type { PaneEdge } from "./paneLayout";

export type PaneMenuIntent =
  /** Ask the user which thread to open beside the current ones, on `edge`. */
  | { readonly kind: "pick-thread-for-new-pane"; readonly edge: PaneEdge }
  | { readonly kind: "close-pane"; readonly paneId: string };

export function resolvePaneMenuIntent(input: {
  readonly action: string;
  readonly paneIds: ReadonlyArray<string>;
  readonly focusedPaneId: string | null;
}): PaneMenuIntent | null {
  if (input.action === "split-right") return { kind: "pick-thread-for-new-pane", edge: "right" };
  if (input.action === "split-down") return { kind: "pick-thread-for-new-pane", edge: "bottom" };
  if (input.action !== "close-pane") return null;
  // With one pane there is nothing to close: closing it would leave the chat
  // route with no thread at all, which is not what a pane control means.
  if (input.paneIds.length <= 1) return null;
  const paneId = resolveFocusedPaneId({
    current: input.focusedPaneId,
    paneIds: input.paneIds,
  });
  return paneId === null ? null : { kind: "close-pane", paneId };
}
