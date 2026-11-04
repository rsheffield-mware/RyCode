import type { PaneEdge } from "./paneLayout";

export interface PaneRect {
  readonly paneId: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PaneDropTarget {
  readonly paneId: string;
  readonly edge: PaneEdge;
}

function isUsableRect(rect: PaneRect): boolean {
  return rect.right > rect.left && rect.bottom > rect.top;
}

export function resolvePaneDropTarget(input: {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly rects: ReadonlyArray<PaneRect>;
}): PaneDropTarget | null {
  const { pointerX, pointerY, rects } = input;
  for (const rect of rects) {
    if (!isUsableRect(rect)) continue;
    if (pointerX < rect.left || pointerX > rect.right) continue;
    if (pointerY < rect.top || pointerY > rect.bottom) continue;
    const halfWidth = (rect.right - rect.left) / 2;
    const halfHeight = (rect.bottom - rect.top) / 2;
    const normalizedX = (pointerX - (rect.left + halfWidth)) / halfWidth;
    const normalizedY = (pointerY - (rect.top + halfHeight)) / halfHeight;
    const edge: PaneEdge =
      Math.abs(normalizedX) >= Math.abs(normalizedY)
        ? normalizedX < 0
          ? "left"
          : "right"
        : normalizedY < 0
          ? "top"
          : "bottom";
    return { paneId: rect.paneId, edge };
  }
  return null;
}

/** The pane's size along `edge`, which is also the extent a split there divides. */
export function paneRectExtent(rect: PaneRect, edge: PaneEdge): number {
  return edge === "left" || edge === "right" ? rect.right - rect.left : rect.bottom - rect.top;
}

/** The half of the pane a split on `edge` would occupy. */
export function paneEdgeHighlight(
  rect: PaneRect,
  edge: PaneEdge,
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const halfWidth = (rect.right - rect.left) / 2;
  const halfHeight = (rect.bottom - rect.top) / 2;
  if (edge === "left" || edge === "right") {
    return {
      left: edge === "left" ? rect.left : rect.left + halfWidth,
      top: rect.top,
      width: halfWidth,
      height: rect.bottom - rect.top,
    };
  }
  return {
    left: rect.left,
    top: edge === "top" ? rect.top : rect.top + halfHeight,
    width: rect.right - rect.left,
    height: halfHeight,
  };
}

/** Reads the live pane boxes. Rendered order, since the DOM is in layout order. */
export function measurePaneRects(): ReadonlyArray<PaneRect> {
  if (typeof document === "undefined") return [];
  const rects: PaneRect[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const paneId = element.dataset.paneId;
    if (paneId === undefined) continue;
    const box = element.getBoundingClientRect();
    rects.push({
      paneId,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
    });
  }
  return rects;
}

/** The measured box of one pane, or null when it is not on screen. */
export function measurePaneRect(paneId: string): PaneRect | null {
  return measurePaneRects().find((rect) => rect.paneId === paneId) ?? null;
}
