/**
 * Renders the pane grid: one fully functional thread per pane, separated by
 * drag-to-resize splitters. Groups run along the root axis, panes inside a
 * group run across it, and both are capped at two.
 *
 * A lone pane renders `ThreadRouteView` directly with no wrapper element and
 * no context provider, so the single-pane tree is exactly what it was before
 * panes existed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";

import { notifyBrowserSurfaceLayoutChanged } from "../browser/browserSurfaceLayout";
import { ThreadRouteView } from "../components/ThreadRouteView";
import type { ThreadRouteTarget } from "../threadRoutes";
import { cn } from "../lib/utils";
import { PaneProvider } from "./PaneContext";
import {
  buildPaneLayout,
  normalizePaneFractions,
  PANE_FLOOR_HEIGHT,
  PANE_FLOOR_WIDTH,
  PRIMARY_PANE_ID,
  resizePaneFractions,
  type PaneAxis,
} from "./paneLayout";
import { paneGroupSizingKey, usePaneFocusStore, usePaneSizingStore } from "./paneStore";
import { useSecondaryPanes } from "./usePanes";

type SplitterOrientation = "vertical" | "horizontal";

function PaneSplitter({
  onDragDelta,
  onDragEnd,
  onReset,
  orientation,
}: {
  onDragDelta: (deltaPx: number) => void;
  onDragEnd: () => void;
  onReset: () => void;
  /** `vertical` separates side-by-side boxes; `horizontal` separates stacked ones. */
  orientation: SplitterOrientation;
}) {
  const lastPositionRef = useRef<number | null>(null);
  const readPosition = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) =>
      orientation === "vertical" ? event.clientX : event.clientY,
    [orientation],
  );
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      lastPositionRef.current = readPosition(event);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [readPosition],
  );
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const lastPosition = lastPositionRef.current;
      if (lastPosition === null) return;
      const position = readPosition(event);
      lastPositionRef.current = position;
      onDragDelta(position - lastPosition);
    },
    [onDragDelta, readPosition],
  );
  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (lastPositionRef.current === null) return;
      lastPositionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onDragEnd();
    },
    [onDragEnd],
  );
  return (
    <div
      aria-label="Resize panes"
      aria-orientation={orientation}
      className={cn(
        "relative z-10 shrink-0 touch-none after:absolute after:content-[''] hover:after:bg-sidebar-border",
        orientation === "vertical"
          ? "w-0 cursor-col-resize after:inset-y-0 after:-left-1.5 after:w-3"
          : "h-0 cursor-row-resize after:inset-x-0 after:-top-1.5 after:h-3",
      )}
      onDoubleClick={onReset}
      onLostPointerCapture={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      role="separator"
      tabIndex={-1}
    />
  );
}

/** Which stored bucket a live drag is editing. */
type DragScope = { readonly key: string; readonly fractions: ReadonlyArray<number> };

export function ThreadPanes({ primaryTarget }: { primaryTarget: ThreadRouteTarget }) {
  const secondaryPanes = useSecondaryPanes();
  const storedGroupFractions = usePaneSizingStore((state) => state.groupFractions);
  const storedPaneFractions = usePaneSizingStore((state) => state.paneFractions);
  const setGroupFractions = usePaneSizingStore((state) => state.setGroupFractions);
  const setPaneFractions = usePaneSizingStore((state) => state.setPaneFractions);
  const resetGroupFractions = usePaneSizingStore((state) => state.resetGroupFractions);
  const resetPaneFractions = usePaneSizingStore((state) => state.resetPaneFractions);

  // Live drag state stays local so a drag does not write localStorage on every
  // pointermove; the final split is committed once on pointerup. The ref
  // mirrors it so the commit can read the latest fractions without reaching
  // into a state updater, which React may replay during another component's
  // render.
  const [drag, setDrag] = useState<DragScope | null>(null);
  const dragRef = useRef<DragScope | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef<Array<HTMLDivElement | null>>([]);

  const axis = secondaryPanes.axis;
  const readStored = useCallback(
    (key: string, fallback: ReadonlyArray<number> | undefined) =>
      drag?.key === key ? drag.fractions : fallback,
    [drag],
  );
  const layout = useMemo(
    () =>
      buildPaneLayout({
        primaryTarget,
        layout: secondaryPanes,
        groupFractions: readStored("groups", storedGroupFractions[axis]) ?? null,
        paneFractions: [0, 1].map((groupIndex) => {
          const key = paneGroupSizingKey(axis, groupIndex);
          return readStored(key, storedPaneFractions[key]) ?? null;
        }),
      }),
    [axis, primaryTarget, readStored, secondaryPanes, storedGroupFractions, storedPaneFractions],
  );

  const syncPaneIds = usePaneFocusStore((state) => state.syncPaneIds);
  const focusPane = usePaneFocusStore((state) => state.focusPane);
  const focusedPaneId = usePaneFocusStore((state) => state.focusedPaneId);
  const paneIdsKey = layout.groups
    .flatMap((group) => group.panes.map((pane) => pane.paneId))
    .join(" ");
  useEffect(() => {
    syncPaneIds(paneIdsKey.length === 0 ? [] : paneIdsKey.split(" "));
    // Opening or closing a pane reflows the rest of the grid. A native browser
    // surface that only moved keeps its old bounds until it is told to
    // measure again.
    notifyBrowserSurfaceLayoutChanged();
  }, [paneIdsKey, syncPaneIds]);

  const handleDragDelta = useCallback(
    (input: {
      readonly key: string;
      readonly container: HTMLDivElement | null;
      readonly along: PaneAxis;
      readonly stored: ReadonlyArray<number> | undefined;
      readonly count: number;
      readonly deltaPx: number;
    }) => {
      const extent =
        input.along === "row" ? input.container?.clientWidth : input.container?.clientHeight;
      if (extent === undefined || extent <= 0) return;
      const floor = input.along === "row" ? PANE_FLOOR_WIDTH : PANE_FLOOR_HEIGHT;
      const current = dragRef.current;
      const base =
        current?.key === input.key
          ? current.fractions
          : normalizePaneFractions(input.stored, input.count);
      const next = {
        key: input.key,
        fractions: resizePaneFractions(base, 0, input.deltaPx / extent, floor / extent),
      };
      dragRef.current = next;
      setDrag(next);
      notifyBrowserSurfaceLayoutChanged();
    },
    [],
  );
  const handleDragEnd = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (current !== null) {
      if (current.key === "groups") setGroupFractions(axis, current.fractions);
      else
        setPaneFractions(
          axis,
          current.key === paneGroupSizingKey(axis, 0) ? 0 : 1,
          current.fractions,
        );
    }
    notifyBrowserSurfaceLayoutChanged();
  }, [axis, setGroupFractions, setPaneFractions]);
  const handleReset = useCallback(
    (groupIndex: number | null) => {
      dragRef.current = null;
      setDrag(null);
      if (groupIndex === null) resetGroupFractions(axis);
      else resetPaneFractions(axis, groupIndex);
      notifyBrowserSurfaceLayoutChanged();
    },
    [axis, resetGroupFractions, resetPaneFractions],
  );

  if (layout.paneCount === 1) {
    return <ThreadRouteView target={primaryTarget} />;
  }

  // Panes inside a group run across the root axis, so a `row` grid stacks them.
  const crossAxis: PaneAxis = axis === "row" ? "column" : "row";
  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1",
        axis === "row" ? "flex-row" : "flex-col",
      )}
      ref={rootRef}
    >
      {/* Groups are keyed by slot, not content, so a pane that stays put is not remounted. */}
      {layout.groups.map((group, groupIndex) => (
        <Fragment key={groupIndex === 0 ? "primary-group" : "secondary-group"}>
          {groupIndex > 0 ? (
            <PaneSplitter
              onDragDelta={(deltaPx) =>
                handleDragDelta({
                  key: "groups",
                  container: rootRef.current,
                  along: axis,
                  stored: storedGroupFractions[axis],
                  count: layout.groups.length,
                  deltaPx,
                })
              }
              onDragEnd={handleDragEnd}
              onReset={() => handleReset(null)}
              orientation={axis === "row" ? "vertical" : "horizontal"}
            />
          ) : null}
          <div
            className={cn(
              "flex min-h-0 min-w-0",
              axis === "row" ? "flex-col" : "flex-row",
              // A quiet separator rather than a highlight: a bright border
              // around the focused pane reads as an error state next to a
              // timeline that is already full of colour.
              groupIndex > 0 &&
                (axis === "row"
                  ? "border-sidebar-border border-l"
                  : "border-sidebar-border border-t"),
            )}
            ref={(element) => {
              groupRefs.current[groupIndex] = element;
            }}
            style={{ flexBasis: `${group.sizeFraction * 100}%`, flexGrow: 0, flexShrink: 1 }}
          >
            {group.panes.map((pane, paneIndex) => (
              <Fragment key={pane.paneId}>
                {paneIndex > 0 ? (
                  <PaneSplitter
                    onDragDelta={(deltaPx) =>
                      handleDragDelta({
                        key: paneGroupSizingKey(axis, groupIndex),
                        container: groupRefs.current[groupIndex] ?? null,
                        along: crossAxis,
                        stored: storedPaneFractions[paneGroupSizingKey(axis, groupIndex)],
                        count: group.panes.length,
                        deltaPx,
                      })
                    }
                    onDragEnd={handleDragEnd}
                    onReset={() => handleReset(groupIndex)}
                    orientation={crossAxis === "row" ? "vertical" : "horizontal"}
                  />
                ) : null}
                <PaneProvider
                  isPrimary={pane.paneId === PRIMARY_PANE_ID}
                  paneCount={layout.paneCount}
                  paneId={pane.paneId}
                >
                  <div
                    className={cn(
                      "flex min-h-0 min-w-0 flex-col",
                      paneIndex > 0 &&
                        (crossAxis === "row"
                          ? "border-sidebar-border border-l"
                          : "border-sidebar-border border-t"),
                    )}
                    data-pane-focused={focusedPaneId === pane.paneId ? "true" : "false"}
                    onFocusCapture={() => focusPane(pane.paneId)}
                    onPointerDownCapture={() => focusPane(pane.paneId)}
                    style={{ flexBasis: `${pane.sizeFraction * 100}%`, flexGrow: 0, flexShrink: 1 }}
                  >
                    <ThreadRouteView target={pane.target} />
                  </div>
                </PaneProvider>
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
