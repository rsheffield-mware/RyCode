import {
  Outlet,
  createFileRoute,
  redirect,
  retainSearchParams,
  useParams,
} from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { PaneDropOverlay } from "../panes/PaneDropOverlay";
import { ThreadPanes } from "../panes/ThreadPanes";
import { useFocusedPaneThreadRef } from "../panes/PaneContext";
import { usePaneFocusStore } from "../panes/paneStore";
import { PRIMARY_PANE_ID } from "../panes/paneLayout";
import { useChatPaneActions, validateChatPaneSearch } from "../panes/usePanes";
import { resolvePaneMenuIntent } from "../panes/paneMenuActions";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useClientSettings, useLegacySidebarEnabled } from "../hooks/useSettings";
import { openCommandPalette } from "../commandPaletteBus";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isEditableFocused } from "../lib/editableFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { undoLatestThreadAction } from "../hooks/showThreadUndoNotice";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  // Shortcuts act on the pane the user is working in. With one pane open the
  // focused pane IS the route, so this resolves to `routeThreadRef`.
  const focusedPaneThreadRef = useFocusedPaneThreadRef();
  const shortcutThreadRef = focusedPaneThreadRef ?? routeThreadRef;
  const focusedPaneId = usePaneFocusStore((state) => state.focusedPaneId) ?? PRIMARY_PANE_ID;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const terminalOpen = useTerminalUiStateStore((state) =>
    shortcutThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, shortcutThreadRef)
          .terminalOpen
      : false,
  );
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    shortcutThreadRef
      ? selectActiveRightPanel(state.byThreadKey, shortcutThreadRef) === "preview"
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (command === "thread.undo") {
        if (event.repeat || isModelPickerOpen()) return;
        if (undoLatestThreadAction()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // The default sidebar routes creation through the command palette
        // whenever there is a real choice to make; the legacy sidebar (and
        // single-project setups) keep the immediate contextual create.
        if (!legacySidebarEnabled && projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!shortcutThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open RyCode in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel", focusedPaneId);
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : "reset-zoom";
        dispatchPreviewAction(action, focusedPaneId);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    focusedPaneId,
    previewOpen,
    projectGroupCount,
    shortcutThreadRef,
    selectedThreadKeysSize,
    legacySidebarEnabled,
    terminalOpen,
  ]);

  return null;
}

/**
 * Runs the desktop application menu's pane items.
 *
 * Mounted under the chat layout rather than beside the app-wide menu bridge:
 * these actions edit the `panes` search param, which only this route owns, so
 * listening anywhere else risks rewriting another route's search.
 */
function ChatRouteDesktopPaneMenu() {
  const { closePane } = useChatPaneActions();
  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") return;
    const unsubscribe = onMenuAction((action) => {
      // Read at event time: the pane row changes far more often than this
      // subscription should, and a menu click has no use for a snapshot.
      const { focusedPaneId, paneIds } = usePaneFocusStore.getState();
      const intent = resolvePaneMenuIntent({ action, focusedPaneId, paneIds });
      if (intent === null) return;
      if (intent.kind === "close-pane") {
        closePane(intent.paneId);
        return;
      }
      openCommandPalette({ open: "thread-in-new-pane", paneEdge: intent.edge });
    });
    return () => unsubscribe?.();
  }, [closePane]);
  return null;
}

function ChatRouteLayout() {
  // Both thread routes render here, not in their own leaf components, so the
  // draft-to-thread promotion keeps one ChatView mounted across the swap.
  const threadTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <ChatRouteDesktopPaneMenu />
      {threadTarget ? <ThreadPanes primaryTarget={threadTarget} /> : <Outlet />}
      <PaneDropOverlay />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
  // Panes are a property of the workspace, not of one thread: keep them across
  // every navigation inside the chat layout.
  search: { middlewares: [retainSearchParams(["panes"])] },
  validateSearch: validateChatPaneSearch,
});
