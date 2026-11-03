/**
 * Cross-tree handshake for drag-to-split.
 *
 * The sidebar owns the drag (it is a dnd-kit sortable list) and the pane row
 * owns the drop zones, and neither is an ancestor of the other. The store
 * carries exactly one reactive bit — is a thread being dragged — so mounting
 * the drop overlay is the only render the rest of the tree pays for. The armed
 * drop is deliberately *not* reactive: it changes on every pointermove, and is
 * read once, imperatively, when the drag ends.
 */
import { create } from "zustand";

import type { ThreadRouteTarget } from "../threadRoutes";
import type { PaneEdge } from "./paneLayout";

interface PaneDragStore {
  /** The thread currently being dragged out of the sidebar, if any. */
  draggedTarget: ThreadRouteTarget | null;
  beginPaneDrag: (target: ThreadRouteTarget) => void;
  endPaneDrag: () => void;
}

export const usePaneDragStore = create<PaneDragStore>((set) => ({
  draggedTarget: null,
  beginPaneDrag: (target) => set({ draggedTarget: target }),
  endPaneDrag: () =>
    set((state) => (state.draggedTarget === null ? state : { draggedTarget: null })),
}));

export type ArmedPaneDrop =
  | { readonly kind: "insert"; readonly paneId: string; readonly edge: PaneEdge }
  /** Over a pane, but the split is refused by a cap or the size floor. */
  | { readonly kind: "no-room"; readonly reason: "full" | "no-room" };

let armedPaneDrop: ArmedPaneDrop | null = null;

export function setArmedPaneDrop(drop: ArmedPaneDrop | null): void {
  armedPaneDrop = drop;
}

export function readArmedPaneDrop(): ArmedPaneDrop | null {
  return armedPaneDrop;
}

/** Clears both halves of the handshake. Safe to call when no drag is running. */
export function clearPaneDrag(): void {
  armedPaneDrop = null;
  usePaneDragStore.getState().endPaneDrag();
}
