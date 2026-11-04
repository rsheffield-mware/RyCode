import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import type { PaneAxis } from "./paneLayout";
import { paneOwnsGlobalHandlers, resolveFocusedPaneId } from "./paneFocus";

const PANE_WIDTHS_STORAGE_KEY = "chat_pane_widths";

/** Key a group's internal split is stored under; a group only exists per axis. */
export function paneGroupSizingKey(axis: PaneAxis, groupIndex: number): string {
  return `${axis}:${groupIndex}`;
}

interface PaneSizingStore {
  /** How the root splits between its groups, per axis. */
  groupFractions: Record<PaneAxis, ReadonlyArray<number>>;
  /** How a group splits between its panes, keyed by `paneGroupSizingKey`. */
  paneFractions: Record<string, ReadonlyArray<number>>;
  setGroupFractions: (axis: PaneAxis, fractions: ReadonlyArray<number>) => void;
  setPaneFractions: (axis: PaneAxis, groupIndex: number, fractions: ReadonlyArray<number>) => void;
  resetGroupFractions: (axis: PaneAxis) => void;
  resetPaneFractions: (axis: PaneAxis, groupIndex: number) => void;
}

export const usePaneSizingStore = create<PaneSizingStore>()(
  persist(
    (set) => ({
      groupFractions: { row: [], column: [] },
      paneFractions: {},
      setGroupFractions: (axis, fractions) =>
        set((state) => ({ groupFractions: { ...state.groupFractions, [axis]: fractions } })),
      setPaneFractions: (axis, groupIndex, fractions) =>
        set((state) => ({
          paneFractions: {
            ...state.paneFractions,
            [paneGroupSizingKey(axis, groupIndex)]: fractions,
          },
        })),
      resetGroupFractions: (axis) =>
        set((state) => ({ groupFractions: { ...state.groupFractions, [axis]: [] } })),
      resetPaneFractions: (axis, groupIndex) =>
        set((state) => {
          const next = { ...state.paneFractions };
          delete next[paneGroupSizingKey(axis, groupIndex)];
          return { paneFractions: next };
        }),
    }),
    {
      name: PANE_WIDTHS_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      // A two-pane horizontal split is the one v1 layout that still means the
      // same thing; the wider rows it stored are no longer representable.
      migrate: (persisted, version) => {
        const carried =
          version < 2 &&
          typeof persisted === "object" &&
          persisted !== null &&
          "widthsByPaneCount" in persisted
            ? (persisted as { widthsByPaneCount?: Record<string, ReadonlyArray<number>> })
                .widthsByPaneCount?.["2"]
            : undefined;
        // Only the persisted slice; zustand merges the actions back in.
        return {
          groupFractions: { row: carried ?? [], column: [] },
          paneFractions: {},
        } as unknown as PaneSizingStore;
      },
    },
  ),
);

interface PaneFocusStore {
  focusedPaneId: string | null;
  /** Pane ids in layout order, mirrored from the rendered layout. */
  paneIds: ReadonlyArray<string>;
  focusPane: (paneId: string) => void;
  syncPaneIds: (paneIds: ReadonlyArray<string>) => void;
}

export const usePaneFocusStore = create<PaneFocusStore>((set) => ({
  focusedPaneId: null,
  paneIds: [],
  focusPane: (paneId) =>
    set((state) => {
      const focusedPaneId = resolveFocusedPaneId({
        current: state.focusedPaneId,
        paneIds: state.paneIds,
        requested: paneId,
      });
      return focusedPaneId === state.focusedPaneId ? state : { focusedPaneId };
    }),
  syncPaneIds: (paneIds) =>
    set((state) => {
      const sameOrder =
        state.paneIds.length === paneIds.length &&
        state.paneIds.every((id, index) => id === paneIds[index]);
      const focusedPaneId = resolveFocusedPaneId({ current: state.focusedPaneId, paneIds });
      if (sameOrder && focusedPaneId === state.focusedPaneId) return state;
      return { paneIds: sameOrder ? state.paneIds : paneIds, focusedPaneId };
    }),
}));

interface PaneThreadStore {
  /** Thread key shown by each mounted pane. Panes with no resolved thread are absent. */
  threadKeyByPaneId: Readonly<Record<string, string>>;
  threadRefByPaneId: Readonly<Record<string, ScopedThreadRef>>;
  registerPaneThread: (paneId: string, threadRef: ScopedThreadRef | null) => void;
  unregisterPane: (paneId: string) => void;
}

export const usePaneThreadStore = create<PaneThreadStore>((set) => ({
  threadKeyByPaneId: {},
  threadRefByPaneId: {},
  registerPaneThread: (paneId, threadRef) =>
    set((state) => {
      if (threadRef === null) {
        if (!(paneId in state.threadKeyByPaneId)) return state;
        const threadKeyByPaneId = { ...state.threadKeyByPaneId };
        const threadRefByPaneId = { ...state.threadRefByPaneId };
        delete threadKeyByPaneId[paneId];
        delete threadRefByPaneId[paneId];
        return { threadKeyByPaneId, threadRefByPaneId };
      }
      const threadKey = scopedThreadKey(threadRef);
      if (state.threadKeyByPaneId[paneId] === threadKey) return state;
      return {
        threadKeyByPaneId: { ...state.threadKeyByPaneId, [paneId]: threadKey },
        threadRefByPaneId: { ...state.threadRefByPaneId, [paneId]: threadRef },
      };
    }),
  unregisterPane: (paneId) =>
    set((state) => {
      if (!(paneId in state.threadKeyByPaneId)) return state;
      const threadKeyByPaneId = { ...state.threadKeyByPaneId };
      const threadRefByPaneId = { ...state.threadRefByPaneId };
      delete threadKeyByPaneId[paneId];
      delete threadRefByPaneId[paneId];
      return { threadKeyByPaneId, threadRefByPaneId };
    }),
}));

/** The thread ref of the pane that currently owns keyboard focus. */
export function readFocusedPaneThreadRef(): ScopedThreadRef | null {
  const { focusedPaneId, paneIds } = usePaneFocusStore.getState();
  const resolved = resolveFocusedPaneId({ current: focusedPaneId, paneIds });
  if (resolved === null) return null;
  return usePaneThreadStore.getState().threadRefByPaneId[resolved] ?? null;
}

export function focusPaneForThread(threadRef: ScopedThreadRef | null): void {
  if (threadRef === null) return;
  const { focusPane, paneIds } = usePaneFocusStore.getState();
  if (paneIds.length <= 1) return;
  const threadKey = scopedThreadKey(threadRef);
  const { threadKeyByPaneId } = usePaneThreadStore.getState();
  const paneId = paneIds.find((candidate) => threadKeyByPaneId[candidate] === threadKey);
  if (paneId !== undefined) focusPane(paneId);
}

export function readPaneOwnsGlobalHandlers(paneId: string): boolean {
  const { focusedPaneId, paneIds } = usePaneFocusStore.getState();
  return paneOwnsGlobalHandlers({
    paneId,
    paneCount: Math.max(paneIds.length, 1),
    focusedPaneId,
  });
}
