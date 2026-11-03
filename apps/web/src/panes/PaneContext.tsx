/**
 * Identity of the pane a subtree renders in.
 *
 * The default value describes the single-pane app, so every component that
 * reads this outside a split layout behaves exactly as it did before panes
 * existed: it is the primary pane, it is focused, and it owns the app-wide
 * singletons.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { PRIMARY_PANE_ID } from "./paneLayout";
import { usePaneFocusStore, usePaneThreadStore } from "./paneStore";

export interface PaneContextValue {
  readonly paneId: string;
  /** The pane backed by the route's path params. Only it may drive top-level navigation. */
  readonly isPrimary: boolean;
  readonly paneCount: number;
}

const SINGLE_PANE: PaneContextValue = {
  paneId: PRIMARY_PANE_ID,
  isPrimary: true,
  paneCount: 1,
};

const PaneContext = createContext<PaneContextValue>(SINGLE_PANE);

export function PaneProvider({
  paneId,
  isPrimary,
  paneCount,
  children,
}: PaneContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ paneId, isPrimary, paneCount }), [isPrimary, paneCount, paneId]);
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function usePane(): PaneContextValue {
  return useContext(PaneContext);
}

/**
 * Publishes the thread a pane is showing so cross-pane consumers can see it.
 * Keyed on the ref's fields rather than its identity: callers rebuild the ref
 * object on most renders, and an identity dependency would unregister and
 * re-register on every one of them.
 */
export function usePaneThreadRegistration(threadRef: ScopedThreadRef | null): void {
  const { paneId } = usePane();
  const environmentId = threadRef === null ? null : threadRef.environmentId;
  const threadId = threadRef === null ? null : threadRef.threadId;
  const registerPaneThread = usePaneThreadStore((state) => state.registerPaneThread);
  const unregisterPane = usePaneThreadStore((state) => state.unregisterPane);
  useEffect(() => {
    registerPaneThread(
      paneId,
      environmentId === null || threadId === null
        ? null
        : scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
    );
    return () => unregisterPane(paneId);
  }, [environmentId, paneId, registerPaneThread, threadId, unregisterPane]);
}

/** Thread keys currently visible in any pane. */
export function useVisiblePaneThreadKeys(): ReadonlySet<string> {
  const threadKeyByPaneId = usePaneThreadStore((state) => state.threadKeyByPaneId);
  return useMemo(() => new Set(Object.values(threadKeyByPaneId)), [threadKeyByPaneId]);
}

/** The thread ref of the focused pane, or null before any pane resolves one. */
export function useFocusedPaneThreadRef(): ScopedThreadRef | null {
  const focusedPaneId = usePaneFocusStore((state) => state.focusedPaneId);
  const threadRefByPaneId = usePaneThreadStore((state) => state.threadRefByPaneId);
  return focusedPaneId === null ? null : (threadRefByPaneId[focusedPaneId] ?? null);
}
