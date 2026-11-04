/**
 * Router-backed pane actions. The pane grid lives in the `panes` search param
 * on `_chat`, so opening or closing a pane is a navigation.
 */
import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import type { ThreadRouteTarget } from "../threadRoutes";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import {
  decodeSecondaryPanes,
  encodeSecondaryPanes,
  flattenSecondaryPanes,
  isPaneSplitRefusal,
  MAX_PANES,
  paneTargetToken,
  planPaneDrop,
  promotePrimaryPane,
  PRIMARY_PANE_ID,
  removeSecondaryPane,
  resolvePaneSplitRefusal,
  type PaneDropPlan,
  type PaneEdge,
  type PaneSplitSizing,
  type SecondaryPaneLayout,
} from "./paneLayout";
import { measurePaneRect, paneRectExtent } from "./paneDropTarget";
import type { ArmedPaneDrop } from "./paneDragStore";
import { usePaneFocusStore, usePaneSizingStore } from "./paneStore";

export interface ChatPaneSearch {
  readonly panes?: string | undefined;
}

/** Fallback direction when the requested one has run out of grid. */
const PERPENDICULAR_EDGE: Record<PaneEdge, PaneEdge> = {
  left: "top",
  right: "bottom",
  top: "left",
  bottom: "right",
};

/** Validates the `panes` search value, repairing anything malformed. */
export function validateChatPaneSearch(raw: Record<string, unknown>): ChatPaneSearch {
  const encoded = encodeSecondaryPanes(decodeSecondaryPanes(raw.panes));
  return encoded === undefined ? {} : { panes: encoded };
}

export function useSecondaryPanes(): SecondaryPaneLayout {
  const raw = useSearch({
    strict: false,
    select: (search) => (search as ChatPaneSearch).panes ?? null,
  });
  return (() => decodeSecondaryPanes(raw))();
}

function paneSearchUpdater(
  layout: SecondaryPaneLayout,
): (previous: ChatPaneSearch) => ChatPaneSearch {
  return () => ({ panes: encodeSecondaryPanes(layout) });
}

function navigateTargetOptions(target: ThreadRouteTarget) {
  return target.kind === "server"
    ? ({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
      } as const)
    : ({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(target.draftId) } as const);
}

export interface PaneActions {
  /**
   * Opens a thread beside the focused one, on `edge`. No-op when it is already
   * on screen.
   */
  openInNewPane: (target: ThreadRouteTarget, edge?: PaneEdge) => void;
  /** Closes a pane; closing the primary promotes the next pane onto the route. */
  closePane: (paneId: string) => void;

  replacePane: (paneId: string, target: ThreadRouteTarget) => void;
  /**
   * Resolves a drag-to-split drop. A thread already on screen moves to the
   * dropped slot instead of opening a second time.
   */
  dropIntoPaneRow: (target: ThreadRouteTarget, drop: ArmedPaneDrop) => void;
}

function paneLimitToast() {
  toastManager.add(
    stackedThreadToast({
      type: "info",
      title: "Pane limit reached",
      description: `Close a pane to split again. Up to ${MAX_PANES} can be open at once, in a 2x2 grid.`,
    }),
  );
}

function paneFloorToast() {
  toastManager.add(
    stackedThreadToast({
      type: "info",
      title: "Not enough room to split",
      description: "Shrinking this pane would leave it too small to use. Resize the window first.",
    }),
  );
}

function usePaneActions(input: {
  readonly primaryTarget: ThreadRouteTarget | null;
  readonly layout: SecondaryPaneLayout;
}): PaneActions {
  const navigate = useNavigate();
  // Pane edits keep the current path. Routing through the live pathname keeps
  // this hook usable from every route under `_chat` (thread, draft, index)
  // without pinning it to one of them.
  const pathname = useLocation({ select: (location) => location.pathname });
  const { layout, primaryTarget } = input;
  const focusPane = usePaneFocusStore((state) => state.focusPane);
  const setGroupFractions = usePaneSizingStore((state) => state.setGroupFractions);
  const setPaneFractions = usePaneSizingStore((state) => state.setPaneFractions);

  const persistSplitSizing = (sizing: PaneSplitSizing | null) => {
    if (sizing === null) return;
    if (sizing.groupIndex === null) {
      setGroupFractions(sizing.axis, sizing.fractions);
      return;
    }
    setPaneFractions(sizing.axis, sizing.groupIndex, sizing.fractions);
  };

  const splitInto = (
    target: ThreadRouteTarget,
    anchorPaneId: string,
    edge: PaneEdge,
  ): PaneDropPlan["kind"] => {
    const rect = measurePaneRect(anchorPaneId);
    const plan = planPaneDrop({
      primaryTarget,
      layout,
      target,
      anchorPaneId,
      edge,
      anchorExtent: rect === null ? 0 : paneRectExtent(rect, edge),
    });
    if (plan.kind !== "secondary" && plan.kind !== "promote") return plan.kind;
    persistSplitSizing(plan.sizing);
    const droppedPaneId = paneTargetToken(target);
    if (plan.kind === "secondary") {
      void navigate({ to: pathname, search: paneSearchUpdater(plan.layout) }).then(() =>
        focusPane(droppedPaneId),
      );
      return plan.kind;
    }
    // Landing ahead of the primary pane rewrites the route: the grid's first
    // slot is the path params, so the dropped thread becomes primary.
    const promotedIsDropped = paneTargetToken(plan.primary) === droppedPaneId;
    void navigate({
      ...navigateTargetOptions(plan.primary),
      search: paneSearchUpdater(plan.layout),
    }).then(() => focusPane(promotedIsDropped ? PRIMARY_PANE_ID : droppedPaneId));
    return plan.kind;
  };

  const openInNewPane = (target: ThreadRouteTarget, edge: PaneEdge = "right") => {
    const token = paneTargetToken(target);
    const alreadyOpen =
      (primaryTarget !== null && paneTargetToken(primaryTarget) === token) ||
      flattenSecondaryPanes(layout).some((pane) => pane.paneId === token);
    if (alreadyOpen) return;
    // A menu or palette split has no pointer, so it acts on the pane the
    // user is working in.
    const { focusedPaneId, paneIds } = usePaneFocusStore.getState();
    const anchorPaneId =
      focusedPaneId !== null && paneIds.includes(focusedPaneId) ? focusedPaneId : PRIMARY_PANE_ID;
    // The 2x2 cap and the size guards each block one direction at a time,
    // and "open this beside the current thread" is the real intent, so a
    // refusal of either kind tries the perpendicular edge before giving up.
    const attempted = splitInto(target, anchorPaneId, edge);
    if (!isPaneSplitRefusal(attempted)) return;
    const fallback = splitInto(target, anchorPaneId, PERPENDICULAR_EDGE[edge]);
    const refusal = resolvePaneSplitRefusal(attempted, fallback);
    if (refusal === "full") paneLimitToast();
    else if (refusal === "no-room") paneFloorToast();
  };

  const closePane = (paneId: string) => {
    if (paneId !== PRIMARY_PANE_ID) {
      void navigate({
        to: pathname,
        search: paneSearchUpdater(removeSecondaryPane(layout, paneId)),
      });
      return;
    }
    const promotion = promotePrimaryPane(layout);
    if (!promotion) return;
    void navigate({
      ...navigateTargetOptions(promotion.promoted),
      search: paneSearchUpdater(promotion.layout),
    });
    focusPane(PRIMARY_PANE_ID);
  };

  const replacePane = (paneId: string, target: ThreadRouteTarget) => {
    const nextPaneId = paneTargetToken(target);
    if (paneId === nextPaneId) return;
    let found = false;
    const groups = layout.groups.map((group) =>
      group.map((pane) => {
        if (pane.paneId !== paneId) return pane;
        found = true;
        return { paneId: nextPaneId, target };
      }),
    );
    if (!found) return;
    void navigate({ to: pathname, search: paneSearchUpdater({ axis: layout.axis, groups }) });
    focusPane(nextPaneId);
  };

  const dropIntoPaneRow = (target: ThreadRouteTarget, drop: ArmedPaneDrop) => {
    const outcome =
      drop.kind === "no-room" ? drop.reason : splitInto(target, drop.paneId, drop.edge);
    if (outcome === "full") paneLimitToast();
    else if (outcome === "no-room") paneFloorToast();
  };

  return { openInNewPane, closePane, replacePane, dropIntoPaneRow };
}

/** Pane actions bound to the current route, usable anywhere under `_chat`. */
export function useChatPaneActions(): PaneActions {
  const primaryTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const layout = useSecondaryPanes();
  return usePaneActions({ primaryTarget, layout });
}
