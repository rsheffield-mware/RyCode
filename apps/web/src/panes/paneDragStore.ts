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
