import { createContext, useContext, useEffect, type ReactNode } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { PRIMARY_PANE_ID } from "./paneLayout";
import { usePaneThreadStore } from "./paneStore";

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
  const value = (() => ({ paneId, isPrimary, paneCount }))();
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function usePane(): PaneContextValue {
  return useContext(PaneContext);
}

export function usePaneThreadRegistration(threadRef: ScopedThreadRef | null): void {
  const { paneId } = usePane();
  const environmentId = threadRef === null ? null : threadRef.environmentId;
  const threadId = threadRef === null ? null : threadRef.threadId;
  const registerPaneThread = usePaneThreadStore((state) => state.registerPaneThread);
  const unregisterPane = usePaneThreadStore((state) => state.unregisterPane);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers each mounted pane in the external thread registry
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
  return (() => new Set(Object.values(threadKeyByPaneId)))();
}
