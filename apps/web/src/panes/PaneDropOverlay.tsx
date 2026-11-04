import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { resolveThreadRouteTarget } from "../threadRoutes";
import { paneIdGrid, paneTargetToken, PRIMARY_PANE_ID, resolvePaneSplit } from "./paneLayout";
import { setArmedPaneDrop, usePaneDragStore } from "./paneDragStore";
import {
  measurePaneRects,
  paneEdgeHighlight,
  paneRectExtent,
  resolvePaneDropTarget,
  type PaneDropTarget,
  type PaneRect,
} from "./paneDropTarget";
import { useSecondaryPanes } from "./usePanes";

function PaneDropZones() {
  // Measured once, on mount, because this component only exists while a drag
  // is in flight and the pane row cannot reflow until the drop lands.
  const [rects] = useState<ReadonlyArray<PaneRect>>(measurePaneRects);
  const [active, setActive] = useState<PaneDropTarget | null>(null);
  const layout = useSecondaryPanes();
  const draggedTarget = usePaneDragStore((state) => state.draggedTarget);
  const primaryTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const grid = (() => paneIdGrid(layout))();
  // The dragged thread may already be on screen, in which case the drop moves
  // it and the caps have one fewer pane to account for.
  const movingPaneId = (() => {
    if (draggedTarget === null) return null;
    const token = paneTargetToken(draggedTarget);
    if (primaryTarget !== null && paneTargetToken(primaryTarget) === token) return PRIMARY_PANE_ID;
    return grid.some((group) => group.includes(token)) ? token : null;
  })();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attaches document pointer listeners for the pane drop overlay
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const target = resolvePaneDropTarget({
        pointerX: event.clientX,
        pointerY: event.clientY,
        rects,
      });
      const rect = rects.find((candidate) => candidate.paneId === target?.paneId);
      const outcome =
        target === undefined || target === null || rect === undefined
          ? null
          : resolvePaneSplit({
              grid,
              axis: layout.axis,
              anchorPaneId: target.paneId,
              edge: target.edge,
              anchorExtent: paneRectExtent(rect, target.edge),
              movingPaneId,
            });
      if (target === null || outcome === null || outcome.kind === "noop") {
        setArmedPaneDrop(null);
      } else if (outcome.kind === "ok") {
        setArmedPaneDrop({ kind: "insert", paneId: target.paneId, edge: target.edge });
      } else {
        setArmedPaneDrop({ kind: "no-room", reason: outcome.kind });
      }
      // Only show a split preview where the drop can actually land. Keep the
      // refusal armed so dropping there can still explain why it was blocked.
      const preview = outcome?.kind === "ok" ? target : null;
      // Identity is held steady while the pointer stays in one zone, so the
      // overlay repaints on a zone change rather than on every move.
      setActive((current) =>
        current !== null &&
        preview !== null &&
        current.paneId === preview.paneId &&
        current.edge === preview.edge
          ? current
          : preview,
      );
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      setArmedPaneDrop(null);
    };
  }, [grid, layout.axis, movingPaneId, rects]);

  if (active === null) return null;
  const rect = rects.find((candidate) => candidate.paneId === active.paneId);
  if (rect === undefined) return null;
  const box = paneEdgeHighlight(rect, active.edge);
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <div
        className="absolute rounded-md border-2 border-primary bg-primary/15"
        style={{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        }}
      />
    </div>,
    document.body,
  );
}

/** Renders the drop zones only while a sidebar thread drag is in flight. */
export function PaneDropOverlay() {
  const dragging = usePaneDragStore((state) => state.draggedTarget !== null);
  if (!dragging) return null;
  return <PaneDropZones />;
}
