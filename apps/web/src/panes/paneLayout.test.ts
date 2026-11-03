import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  buildPaneLayout,
  decodeSecondaryPanes,
  encodeSecondaryPanes,
  EMPTY_PANE_LAYOUT,
  flattenSecondaryPanes,
  MAX_PANES,
  normalizePaneFractions,
  PANE_FLOOR_HEIGHT,
  PANE_FLOOR_WIDTH,
  PANE_MIN_HEIGHT,
  PANE_MIN_WIDTH,
  paneIdGrid,
  paneTargetToken,
  planPaneDrop,
  promotePrimaryPane,
  PRIMARY_PANE_ID,
  reconcileSecondaryPanes,
  removeSecondaryPane,
  resizePaneFractions,
  resolvePaneSplit,
  resolvePaneSplitRefusal,
  type PaneAxis,
  type SecondaryPaneLayout,
} from "./paneLayout";

function serverTarget(environmentId: string, threadId: string): ThreadRouteTarget {
  return {
    kind: "server",
    threadRef: scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
  };
}

function draftTarget(draftId: string): ThreadRouteTarget {
  return { kind: "draft", draftId: draftId as DraftId };
}

function entriesOf(...targets: ReadonlyArray<ThreadRouteTarget>) {
  return targets.map((target) => ({ paneId: paneTargetToken(target), target }));
}

/** Builds a layout from groups of secondary targets; group 0 excludes the primary. */
function layoutOf(
  axis: PaneAxis,
  ...groups: ReadonlyArray<ReadonlyArray<ThreadRouteTarget>>
): SecondaryPaneLayout {
  return { axis, groups: groups.map((group) => entriesOf(...group)) };
}

/** The grid as ids, with the primary written as `A` so cases read like the docs. */
function shapeOf(layout: SecondaryPaneLayout, names: Record<string, string>) {
  return paneIdGrid(layout).map((group) =>
    group.map((paneId) => names[paneId] ?? (paneId === PRIMARY_PANE_ID ? "A" : paneId)),
  );
}

const A = serverTarget("env-1", "a");
const B = serverTarget("env-1", "b");
const C = serverTarget("env-1", "c");
const D = serverTarget("env-1", "d");
const NAMES = {
  [paneTargetToken(A)]: "A",
  [paneTargetToken(B)]: "B",
  [paneTargetToken(C)]: "C",
  [paneTargetToken(D)]: "D",
};

describe("pane search encoding", () => {
  // Every arrangement of up to four panes, as the URL grammar writes it.
  const cases: ReadonlyArray<{
    readonly encoded: string;
    readonly axis: PaneAxis;
    readonly groups: ReadonlyArray<ReadonlyArray<ThreadRouteTarget>>;
  }> = [
    { encoded: "tB", axis: "row", groups: [[], [B]] },
    { encoded: "|tB", axis: "row", groups: [[B]] },
    { encoded: "tB|tC", axis: "row", groups: [[], [B, C]] },
    { encoded: "|tB,tC", axis: "row", groups: [[B], [C]] },
    { encoded: "|tB,tC|tD", axis: "row", groups: [[B], [C, D]] },
    { encoded: "v|tB,tC", axis: "column", groups: [[B], [C]] },
    { encoded: "vtB", axis: "column", groups: [[], [B]] },
  ];

  for (const { axis, encoded, groups } of cases) {
    it(`round-trips ${encoded}`, () => {
      const layout = layoutOf(axis, ...groups);
      const written = encodeSecondaryPanes(layout);
      // Tokens are opaque, so compare the shape rather than the literal text.
      expect(written?.replaceAll(paneTargetToken(B), "tB")).toBeTypeOf("string");
      expect(decodeSecondaryPanes(written)).toEqual(layout);
    });
  }

  it("writes the documented grammar", () => {
    const token = (target: ThreadRouteTarget) => paneTargetToken(target);
    expect(encodeSecondaryPanes(layoutOf("row", [], [B]))).toBe(token(B));
    expect(encodeSecondaryPanes(layoutOf("row", [B]))).toBe(`|${token(B)}`);
    expect(encodeSecondaryPanes(layoutOf("row", [], [B, C]))).toBe(`${token(B)}|${token(C)}`);
    expect(encodeSecondaryPanes(layoutOf("row", [B], [C]))).toBe(`|${token(B)},${token(C)}`);
    expect(encodeSecondaryPanes(layoutOf("row", [B], [C, D]))).toBe(
      `|${token(B)},${token(C)}|${token(D)}`,
    );
    expect(encodeSecondaryPanes(layoutOf("column", [B], [C]))).toBe(`v|${token(B)},${token(C)}`);
  });

  it("reads the old comma-only format as a horizontal row", () => {
    const decoded = decodeSecondaryPanes(paneTargetToken(B));
    expect(decoded.axis).toBe("row");
    expect(shapeOf(decoded, NAMES)).toEqual([["A"], ["B"]]);
  });

  // The router percent-decodes the search value before the decoder runs, so the
  // encoding has to protect the delimiters on its own.
  it("survives ids containing the separators and the escape character", () => {
    const target = serverTarget("env:with,commas|pipes", "thread:with,commas~and~tildes|pipes");
    const encoded = encodeSecondaryPanes(layoutOf("row", [], [target]));
    expect(encoded).not.toContain("%");
    const decoded = flattenSecondaryPanes(decodeSecondaryPanes(encoded));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.target).toEqual(target);
  });

  it("round-trips a provider-import thread id after a percent-decode", () => {
    const target = serverTarget(
      "3697202a-7157-416d-bd59-49d71d009b06",
      "import:claudeAgent:63db1088-e3d9-41a8-9238-86b5568536ab",
    );
    const encoded = encodeSecondaryPanes(layoutOf("row", [], [target]));
    // What the router hands back after parsing `?panes=<encoded>`.
    const afterUrlRoundTrip = decodeURIComponent(encodeURIComponent(encoded ?? ""));
    expect(flattenSecondaryPanes(decodeSecondaryPanes(afterUrlRoundTrip))[0]?.target).toEqual(
      target,
    );
  });

  it("round-trips a draft pane", () => {
    const layout = layoutOf("row", [draftTarget("draft-9")], [B]);
    expect(decodeSecondaryPanes(encodeSecondaryPanes(layout))).toEqual(layout);
  });

  it("reads a hand-written token whose id left its colons unescaped", () => {
    const decoded = flattenSecondaryPanes(decodeSecondaryPanes("t:env-1:import:claudeAgent:abc"));
    expect(decoded[0]?.target).toEqual(serverTarget("env-1", "import:claudeAgent:abc"));
  });

  it("encodes nothing for a lone primary pane", () => {
    expect(encodeSecondaryPanes(EMPTY_PANE_LAYOUT)).toBeUndefined();
    expect(encodeSecondaryPanes(layoutOf("column"))).toBeUndefined();
  });

  it("repairs malformed values instead of throwing", () => {
    for (const raw of [undefined, 42, "", "x:a:b,t:only-one,t::b,d: ,d", "v", "|", "v|"]) {
      expect(decodeSecondaryPanes(raw)).toEqual(EMPTY_PANE_LAYOUT);
    }
  });

  it("keeps the good panes from a partly broken value", () => {
    const good = paneTargetToken(B);
    expect(
      flattenSecondaryPanes(decodeSecondaryPanes(`garbage,${good},t:`)).map((pane) => pane.paneId),
    ).toEqual([good]);
  });

  it("drops duplicates and clamps to the caps", () => {
    const token = paneTargetToken(B);
    expect(flattenSecondaryPanes(decodeSecondaryPanes(`${token},${token}`))).toHaveLength(1);
    const many = Array.from({ length: MAX_PANES + 4 }, (_unused, index) =>
      paneTargetToken(serverTarget("env-1", `thread-${index}`)),
    );
    // Two panes per group, two groups, four panes total.
    expect(
      flattenSecondaryPanes(decodeSecondaryPanes(`|${many.join("|")},${many.join("|")}`)),
    ).toHaveLength(MAX_PANES - 1);
    expect(shapeOf(decodeSecondaryPanes(`|${many.join("|")},${many.join("|")}`), {})).toSatisfy(
      (grid: ReadonlyArray<ReadonlyArray<string>>) =>
        grid.length === 2 && grid.every((group) => group.length === 2),
    );
    // A legacy value is folded rather than truncated, but still stops at four.
    expect(flattenSecondaryPanes(decodeSecondaryPanes(many.join(",")))).toHaveLength(MAX_PANES - 1);
  });

  // Losing a thread the user had open is worse than moving it, so a value from
  // before the grid keeps every pane it can and only the arrangement changes.
  it("folds a legacy comma-only value into the grid instead of dropping panes", () => {
    const flat = (...targets: ReadonlyArray<ThreadRouteTarget>) =>
      targets.map((target) => paneTargetToken(target)).join(",");
    const E = serverTarget("env-1", "e");
    const F = serverTarget("env-1", "f");
    expect(shapeOf(decodeSecondaryPanes(flat(B)), NAMES)).toEqual([["A"], ["B"]]);
    expect(shapeOf(decodeSecondaryPanes(flat(B, C)), NAMES)).toEqual([["A"], ["B", "C"]]);
    expect(shapeOf(decodeSecondaryPanes(flat(B, C, D)), NAMES)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    // Past the cap the tail is dropped, and the rest folds as if it were alone.
    expect(shapeOf(decodeSecondaryPanes(flat(B, C, D, E, F)), NAMES)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    expect(decodeSecondaryPanes(flat(B, C)).axis).toBe("row");
  });

  it("re-encodes a folded legacy value in the current grammar, so the URL self-heals", () => {
    const legacy = `${paneTargetToken(B)},${paneTargetToken(C)}`;
    const healed = encodeSecondaryPanes(decodeSecondaryPanes(legacy));
    expect(healed).toBe(`${paneTargetToken(B)}|${paneTargetToken(C)}`);
    // And the rewritten value means exactly what the folded one did.
    expect(decodeSecondaryPanes(healed)).toEqual(decodeSecondaryPanes(legacy));
  });

  // The new grammar says which shape it is, so only a value in neither folds.
  it("keeps dropping the surplus from a hand-edited value in the current grammar", () => {
    const many = Array.from({ length: MAX_PANES + 1 }, (_unused, index) =>
      paneTargetToken(serverTarget("env-1", `thread-${index}`)),
    );
    expect(flattenSecondaryPanes(decodeSecondaryPanes(`|${many.join(",")}`))).toHaveLength(2);
    expect(flattenSecondaryPanes(decodeSecondaryPanes(`v${many.join(",")}`))).toHaveLength(1);
  });
});

describe("resolvePaneSplitRefusal", () => {
  it("stays quiet while either edge still landed", () => {
    expect(resolvePaneSplitRefusal("full", "secondary")).toBeNull();
    expect(resolvePaneSplitRefusal("no-room", "promote")).toBeNull();
    expect(resolvePaneSplitRefusal("noop", "noop")).toBeNull();
  });

  it("blames the cap only when it refused both edges", () => {
    expect(resolvePaneSplitRefusal("full", "full")).toBe("full");
    expect(resolvePaneSplitRefusal("no-room", "no-room")).toBe("no-room");
    // Room in the grid but not on the screen: the window is the problem.
    expect(resolvePaneSplitRefusal("full", "no-room")).toBe("no-room");
    expect(resolvePaneSplitRefusal("no-room", "full")).toBe("no-room");
  });
});

describe("pane layout mutations", () => {
  it("removes a pane by id and leaves the layout alone when it is absent", () => {
    const layout = layoutOf("row", [B], [C]);
    expect(shapeOf(removeSecondaryPane(layout, paneTargetToken(B)), NAMES)).toEqual([["A"], ["C"]]);
    expect(removeSecondaryPane(layout, "nope")).toBe(layout);
  });

  it("drops a group that loses its last pane", () => {
    const layout = layoutOf("row", [], [B]);
    expect(removeSecondaryPane(layout, paneTargetToken(B))).toEqual(EMPTY_PANE_LAYOUT);
  });

  it("promotes the next pane in render order when the primary closes", () => {
    const layout = layoutOf("row", [B], [C, D]);
    const promotion = promotePrimaryPane(layout);
    expect(promotion?.promoted).toEqual(B);
    expect(shapeOf(promotion!.layout, NAMES)).toEqual([["A"], ["C", "D"]]);
    expect(promotePrimaryPane(EMPTY_PANE_LAYOUT)).toBeNull();
  });

  it("drops a secondary pane the route has navigated onto", () => {
    const layout = layoutOf("row", [B], [C]);
    expect(shapeOf(reconcileSecondaryPanes(layout, B), NAMES)).toEqual([["A"], ["C"]]);
    expect(reconcileSecondaryPanes(layout, D)).toBe(layout);
  });
});

describe("pane fractions", () => {
  it("splits evenly when nothing is stored", () => {
    expect(normalizePaneFractions(null, 2)).toEqual([0.5, 0.5]);
    expect(normalizePaneFractions([], 0)).toEqual([]);
  });

  it("discards a stored split that does not describe the current sibling count", () => {
    expect(normalizePaneFractions([0.5, 0.5], 1)).toEqual([1]);
  });

  it("discards a stored split containing a collapsed or invalid pane", () => {
    expect(normalizePaneFractions([0.5, 0], 2)).toEqual([0.5, 0.5]);
    expect(normalizePaneFractions([Number.NaN, 0.5], 2)).toEqual([0.5, 0.5]);
    expect(normalizePaneFractions([-1, 2], 2)).toEqual([0.5, 0.5]);
  });

  it("renormalizes a stored split that does not sum to one", () => {
    const [first, second] = normalizePaneFractions([3, 1], 2);
    expect(first).toBeCloseTo(0.75);
    expect(second).toBeCloseTo(0.25);
  });

  it("holds both neighbours at the floor", () => {
    const next = resizePaneFractions([0.5, 0.5], 0, 0.9, 0.2);
    expect(next[0]).toBeCloseTo(0.8);
    expect(next[1]).toBeCloseTo(0.2);
    const back = resizePaneFractions([0.5, 0.5], 0, -0.9, 0.2);
    expect(back[0]).toBeCloseTo(0.2);
    expect(back[1]).toBeCloseTo(0.8);
  });

  // The guard is the floor, not the size a fresh split hands out, so a pane
  // that was split narrow can still be dragged.
  it("lets a pane narrower than a fresh split still be resized", () => {
    const floor = PANE_FLOOR_WIDTH / 1200;
    const next = resizePaneFractions([0.6, 0.4], 0, 0.05, floor);
    expect(next[0]).toBeCloseTo(0.65);
    expect(next[1]).toBeCloseTo(0.35);
  });

  it("refuses a drag when the pair cannot satisfy both guards", () => {
    const fractions = [0.1, 0.1];
    expect(resizePaneFractions(fractions, 0, 0.05, 0.2)).toBe(fractions);
  });

  it("ignores a boundary that does not exist", () => {
    const fractions = [0.5, 0.5];
    expect(resizePaneFractions(fractions, 1, 0.1, 0.1)).toBe(fractions);
    expect(resizePaneFractions(fractions, -1, 0.1, 0.1)).toBe(fractions);
  });
});

describe("resolvePaneSplit", () => {
  const lone = [["A"]];

  it("lets a lone pane choose the root axis from the edge", () => {
    expect(
      resolvePaneSplit({
        grid: lone,
        axis: "row",
        anchorPaneId: "A",
        edge: "bottom",
        anchorExtent: 900,
      }),
    ).toMatchObject({ kind: "ok", axis: "column", placement: { kind: "group", index: 1 } });
    expect(
      resolvePaneSplit({
        grid: lone,
        axis: "column",
        anchorPaneId: "A",
        edge: "left",
        anchorExtent: 1600,
      }),
    ).toMatchObject({ kind: "ok", axis: "row", placement: { kind: "group", index: 0 } });
  });

  it("splits along the root axis into a new group and across it into the group", () => {
    const grid = [["A"], ["B"]];
    expect(
      resolvePaneSplit({ grid, axis: "row", anchorPaneId: "B", edge: "right", anchorExtent: 1600 }),
    ).toMatchObject({ kind: "full" });
    expect(
      resolvePaneSplit({ grid, axis: "row", anchorPaneId: "B", edge: "bottom", anchorExtent: 900 }),
    ).toMatchObject({ kind: "ok", placement: { kind: "pane", groupIndex: 1, index: 1 } });
  });

  it("gives the new pane the minimum when an even split would starve it", () => {
    const extent = PANE_MIN_WIDTH + PANE_FLOOR_WIDTH + 40;
    const outcome = resolvePaneSplit({
      grid: lone,
      axis: "row",
      anchorPaneId: "A",
      edge: "right",
      anchorExtent: extent,
    });
    expect(outcome).toMatchObject({ kind: "ok" });
    if (outcome?.kind !== "ok") throw new Error("expected a split");
    expect(outcome.newFraction * extent).toBeCloseTo(PANE_MIN_WIDTH);
    // The other pane keeps the remainder, which still clears the floor.
    expect((1 - outcome.newFraction) * extent).toBeGreaterThanOrEqual(PANE_FLOOR_WIDTH);
  });

  it("splits evenly once there is room for two full-width panes", () => {
    const outcome = resolvePaneSplit({
      grid: lone,
      axis: "row",
      anchorPaneId: "A",
      edge: "right",
      anchorExtent: PANE_MIN_WIDTH * 2,
    });
    expect(outcome).toMatchObject({ kind: "ok", newFraction: 0.5 });
  });

  it("refuses only once the remainder would fall below the floor", () => {
    const refuses = (anchorExtent: number, edge: "right" | "bottom") =>
      resolvePaneSplit({ grid: lone, axis: "row", anchorPaneId: "A", edge, anchorExtent })?.kind;
    expect(refuses(PANE_MIN_WIDTH + PANE_FLOOR_WIDTH, "right")).toBe("ok");
    expect(refuses(PANE_MIN_WIDTH + PANE_FLOOR_WIDTH - 1, "right")).toBe("no-room");
    expect(refuses(PANE_MIN_HEIGHT + PANE_FLOOR_HEIGHT, "bottom")).toBe("ok");
    expect(refuses(PANE_MIN_HEIGHT + PANE_FLOOR_HEIGHT - 1, "bottom")).toBe("no-room");
  });

  it("assumes an even split when the container could not be measured", () => {
    expect(
      resolvePaneSplit({
        grid: lone,
        axis: "row",
        anchorPaneId: "A",
        edge: "right",
        anchorExtent: 0,
      }),
    ).toMatchObject({ kind: "ok", newFraction: 0.5 });
  });

  it("stops at every cap", () => {
    const full = [
      ["A", "B"],
      ["C", "D"],
    ];
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      expect(
        resolvePaneSplit({ grid: full, axis: "row", anchorPaneId: "A", edge, anchorExtent: 2000 }),
      ).toEqual({ kind: "full" });
    }
    // Two groups is the cap even with panes to spare.
    expect(
      resolvePaneSplit({
        grid: [["A", "B"], ["C"]],
        axis: "row",
        anchorPaneId: "C",
        edge: "right",
        anchorExtent: 2000,
      }),
    ).toEqual({ kind: "full" });
    // Two panes per group likewise.
    expect(
      resolvePaneSplit({
        grid: [["A", "B"], ["C"]],
        axis: "row",
        anchorPaneId: "A",
        edge: "bottom",
        anchorExtent: 2000,
      }),
    ).toEqual({ kind: "full" });
  });

  it("returns null for an anchor that is not on screen", () => {
    expect(
      resolvePaneSplit({
        grid: lone,
        axis: "row",
        anchorPaneId: "Z",
        edge: "right",
        anchorExtent: 0,
      }),
    ).toBeNull();
  });

  it("treats both boundaries of a pane's own slot as a no-op", () => {
    const grid = [["A"], ["B"]];
    for (const edge of ["left", "right"] as const) {
      expect(
        resolvePaneSplit({
          grid,
          axis: "row",
          anchorPaneId: "B",
          edge,
          anchorExtent: 1600,
          movingPaneId: "B",
        }),
      ).toEqual({ kind: "noop" });
    }
    expect(
      resolvePaneSplit({
        grid,
        axis: "row",
        anchorPaneId: "A",
        edge: "right",
        anchorExtent: 1600,
        movingPaneId: "B",
      }),
    ).toEqual({ kind: "noop" });
  });

  it("allows a move that would not fit as a new pane", () => {
    const grid = [["A"], ["B"]];
    // Moving B under A is legal even though a third pane could not join the row.
    expect(
      resolvePaneSplit({
        grid,
        axis: "row",
        anchorPaneId: "A",
        edge: "bottom",
        anchorExtent: 900,
        movingPaneId: "B",
      }),
    ).toMatchObject({ kind: "ok", placement: { kind: "pane", groupIndex: 0, index: 1 } });
  });
});

describe("planPaneDrop", () => {
  const plan = (input: {
    layout: SecondaryPaneLayout;
    target: ThreadRouteTarget;
    anchorPaneId: string;
    edge: "left" | "right" | "top" | "bottom";
    anchorExtent?: number;
  }) =>
    planPaneDrop({
      primaryTarget: A,
      layout: input.layout,
      target: input.target,
      anchorPaneId: input.anchorPaneId,
      edge: input.edge,
      anchorExtent: input.anchorExtent ?? 2000,
    });

  it("splits a lone pane in the direction it was dropped", () => {
    const right = plan({
      layout: EMPTY_PANE_LAYOUT,
      target: B,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "right",
    });
    expect(right.kind).toBe("secondary");
    if (right.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(right.layout.axis).toBe("row");
    expect(shapeOf(right.layout, NAMES)).toEqual([["A"], ["B"]]);

    const below = plan({
      layout: EMPTY_PANE_LAYOUT,
      target: B,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "bottom",
    });
    if (below.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(below.layout.axis).toBe("column");
    expect(shapeOf(below.layout, NAMES)).toEqual([["A"], ["B"]]);
  });

  it("reaches the pair-on-top, single-below layout", () => {
    const stacked = plan({
      layout: EMPTY_PANE_LAYOUT,
      target: B,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "bottom",
    });
    if (stacked.kind !== "secondary") throw new Error("expected a secondary plan");
    const beside = plan({
      layout: stacked.layout,
      target: C,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "right",
    });
    if (beside.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(beside.layout.axis).toBe("column");
    expect(shapeOf(beside.layout, NAMES)).toEqual([["A", "C"], ["B"]]);
  });

  it("promotes onto the route when the drop lands ahead of the primary pane", () => {
    const result = plan({
      layout: layoutOf("row", [], [B]),
      target: C,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "top",
    });
    expect(result.kind).toBe("promote");
    if (result.kind !== "promote") throw new Error("expected a promote plan");
    expect(result.primary).toEqual(C);
    expect(shapeOf(result.layout, { ...NAMES, [PRIMARY_PANE_ID]: "C" })).toEqual([
      ["C", "A"],
      ["B"],
    ]);
  });

  it("moves a thread that is already on screen instead of opening it twice", () => {
    const result = plan({
      layout: layoutOf("row", [], [B, C]),
      target: C,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "bottom",
    });
    if (result.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(shapeOf(result.layout, NAMES)).toEqual([["A", "C"], ["B"]]);
  });

  it("does nothing when the drop lands on either edge of the slot it came from", () => {
    const layout = layoutOf("row", [], [B]);
    for (const edge of ["left", "right"] as const) {
      expect(plan({ layout, target: B, anchorPaneId: paneTargetToken(B), edge })).toEqual({
        kind: "noop",
      });
    }
    // The primary pane's right edge is the same boundary as B's left edge.
    expect(plan({ layout, target: B, anchorPaneId: PRIMARY_PANE_ID, edge: "right" })).toEqual({
      kind: "noop",
    });
  });

  it("moves a pane across the primary when dropped on its far edge", () => {
    const result = plan({
      layout: layoutOf("row", [], [B]),
      target: B,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "left",
    });
    expect(result.kind).toBe("promote");
    if (result.kind !== "promote") throw new Error("expected a promote plan");
    expect(result.primary).toEqual(B);
    expect(shapeOf(result.layout, { ...NAMES, [PRIMARY_PANE_ID]: "B" })).toEqual([["B"], ["A"]]);
  });

  it("refuses a fifth pane", () => {
    const result = plan({
      layout: layoutOf("row", [B], [C, D]),
      target: serverTarget("env-1", "e"),
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "right",
    });
    expect(result).toEqual({ kind: "full" });
  });

  it("reports the fraction the new pane should be persisted at", () => {
    const extent = PANE_MIN_WIDTH + PANE_FLOOR_WIDTH + 40;
    const result = plan({
      layout: EMPTY_PANE_LAYOUT,
      target: B,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "right",
      anchorExtent: extent,
    });
    if (result.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(result.sizing?.axis).toBe("row");
    expect(result.sizing?.groupIndex).toBeNull();
    // The new pane is to the right, so it is the second fraction.
    expect((result.sizing?.fractions[1] ?? 0) * extent).toBeCloseTo(PANE_MIN_WIDTH);
  });

  it("persists a stacking split under the group it happened in", () => {
    const result = plan({
      layout: layoutOf("row", [], [B]),
      target: C,
      anchorPaneId: PRIMARY_PANE_ID,
      edge: "bottom",
      anchorExtent: PANE_MIN_HEIGHT * 4,
    });
    if (result.kind !== "secondary") throw new Error("expected a secondary plan");
    expect(result.sizing).toEqual({ axis: "row", groupIndex: 0, fractions: [0.5, 0.5] });
  });
});

describe("buildPaneLayout", () => {
  it("puts the route target first with a stable primary id", () => {
    const layout = buildPaneLayout({
      primaryTarget: A,
      layout: layoutOf("row", [], [B]),
      groupFractions: [0.6, 0.4],
      paneFractions: [],
    });
    expect(layout.groups.map((group) => group.panes.map((pane) => pane.paneId))).toEqual([
      [PRIMARY_PANE_ID],
      [paneTargetToken(B)],
    ]);
    expect(layout.groups.map((group) => group.sizeFraction)).toEqual([0.6, 0.4]);
  });

  it("gives a lone pane the whole surface", () => {
    const layout = buildPaneLayout({
      primaryTarget: A,
      layout: EMPTY_PANE_LAYOUT,
      groupFractions: null,
      paneFractions: [],
    });
    expect(layout.paneCount).toBe(1);
    expect(layout.groups[0]?.sizeFraction).toBe(1);
    expect(layout.groups[0]?.panes[0]?.sizeFraction).toBe(1);
  });

  // With three panes the lone one fills a whole column, so it matches the
  // column holding the stacked pair rather than taking two thirds.
  it("makes the single pane the same size as the pair beside it", () => {
    const layout = buildPaneLayout({
      primaryTarget: A,
      layout: layoutOf("row", [], [B, C]),
      groupFractions: null,
      paneFractions: [],
    });
    expect(layout.paneCount).toBe(3);
    expect(layout.groups.map((group) => group.sizeFraction)).toEqual([0.5, 0.5]);
    expect(layout.groups[1]?.panes.map((pane) => pane.sizeFraction)).toEqual([0.5, 0.5]);
  });

  it("keeps a positive minimum and a smaller floor on both axes", () => {
    expect(PANE_FLOOR_WIDTH).toBeGreaterThan(0);
    expect(PANE_FLOOR_WIDTH).toBeLessThan(PANE_MIN_WIDTH);
    expect(PANE_FLOOR_HEIGHT).toBeGreaterThan(0);
    expect(PANE_FLOOR_HEIGHT).toBeLessThan(PANE_MIN_HEIGHT);
  });
});
