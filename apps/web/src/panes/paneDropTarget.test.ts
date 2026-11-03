import { describe, expect, it } from "vite-plus/test";

import {
  paneEdgeHighlight,
  paneRectExtent,
  resolvePaneDropTarget,
  type PaneRect,
} from "./paneDropTarget";

function rect(paneId: string, left: number, right: number, top = 100, bottom = 700): PaneRect {
  return { paneId, left, right, top, bottom };
}

const TWO_PANES = [rect("pane:primary", 0, 400), rect("t:env:b", 400, 800)];

describe("resolvePaneDropTarget", () => {
  it("returns nothing when no pane is open", () => {
    expect(resolvePaneDropTarget({ pointerX: 10, pointerY: 200, rects: [] })).toBeNull();
  });

  it("cuts a pane into four edges along its diagonals", () => {
    const rects = [rect("pane:primary", 0, 1000, 0, 500)];
    const at = (pointerX: number, pointerY: number) =>
      resolvePaneDropTarget({ pointerX, pointerY, rects })?.edge;
    expect(at(20, 250)).toBe("left");
    expect(at(980, 250)).toBe("right");
    expect(at(500, 20)).toBe("top");
    expect(at(500, 480)).toBe("bottom");
  });

  // Normalizing by half-width and half-height keeps a wide pane's corners from
  // all reading as left or right.
  it("resolves a corner by how deep into each side the pointer is", () => {
    const rects = [rect("wide", 0, 2000, 0, 200)];
    const at = (pointerX: number, pointerY: number) =>
      resolvePaneDropTarget({ pointerX, pointerY, rects })?.edge;
    expect(at(900, 10)).toBe("top");
    expect(at(100, 90)).toBe("left");
  });

  it("names the pane the pointer is over", () => {
    expect(resolvePaneDropTarget({ pointerX: 700, pointerY: 400, rects: TWO_PANES })).toEqual({
      paneId: "t:env:b",
      edge: "right",
    });
    expect(resolvePaneDropTarget({ pointerX: 50, pointerY: 400, rects: TWO_PANES })).toEqual({
      paneId: "pane:primary",
      edge: "left",
    });
  });

  it("gives a shared boundary to whichever pane comes first", () => {
    expect(resolvePaneDropTarget({ pointerX: 400, pointerY: 400, rects: TWO_PANES })).toMatchObject(
      {
        paneId: "pane:primary",
      },
    );
  });

  it("accepts the grid's far edges so every slot is reachable", () => {
    expect(resolvePaneDropTarget({ pointerX: 800, pointerY: 400, rects: TWO_PANES })).toEqual({
      paneId: "t:env:b",
      edge: "right",
    });
    expect(resolvePaneDropTarget({ pointerX: 200, pointerY: 100, rects: TWO_PANES })).toEqual({
      paneId: "pane:primary",
      edge: "top",
    });
  });

  it("rejects a pointer outside every pane", () => {
    expect(resolvePaneDropTarget({ pointerX: -5, pointerY: 200, rects: TWO_PANES })).toBeNull();
    expect(resolvePaneDropTarget({ pointerX: 801, pointerY: 200, rects: TWO_PANES })).toBeNull();
    expect(resolvePaneDropTarget({ pointerX: 200, pointerY: 50, rects: TWO_PANES })).toBeNull();
    expect(resolvePaneDropTarget({ pointerX: 200, pointerY: 900, rects: TWO_PANES })).toBeNull();
  });

  it("skips a collapsed pane rather than resolving to a zero-width slot", () => {
    const rects = [rect("collapsed", 0, 0), rect("t:env:b", 0, 400)];
    expect(resolvePaneDropTarget({ pointerX: 10, pointerY: 200, rects })).toMatchObject({
      paneId: "t:env:b",
    });
  });
});

describe("paneRectExtent", () => {
  it("measures the dimension the edge divides", () => {
    const box = rect("a", 0, 800, 0, 600);
    expect(paneRectExtent(box, "left")).toBe(800);
    expect(paneRectExtent(box, "right")).toBe(800);
    expect(paneRectExtent(box, "top")).toBe(600);
    expect(paneRectExtent(box, "bottom")).toBe(600);
  });
});

describe("paneEdgeHighlight", () => {
  const box = rect("a", 0, 800, 0, 600);

  it("covers the half the new pane would take", () => {
    expect(paneEdgeHighlight(box, "left")).toEqual({ left: 0, top: 0, width: 400, height: 600 });
    expect(paneEdgeHighlight(box, "right")).toEqual({ left: 400, top: 0, width: 400, height: 600 });
    expect(paneEdgeHighlight(box, "top")).toEqual({ left: 0, top: 0, width: 800, height: 300 });
    expect(paneEdgeHighlight(box, "bottom")).toEqual({
      left: 0,
      top: 300,
      width: 800,
      height: 300,
    });
  });
});
