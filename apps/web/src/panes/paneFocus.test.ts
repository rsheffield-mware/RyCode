import { describe, expect, it } from "vite-plus/test";

import { paneOwnsGlobalHandlers, resolveFocusedPaneId } from "./paneFocus";

describe("resolveFocusedPaneId", () => {
  it("has no focus when no pane is open", () => {
    expect(resolveFocusedPaneId({ current: "a", paneIds: [] })).toBeNull();
  });

  it("focuses the first pane before any interaction", () => {
    expect(resolveFocusedPaneId({ current: null, paneIds: ["a", "b"] })).toBe("a");
  });

  it("honours an explicit request for a visible pane", () => {
    expect(resolveFocusedPaneId({ current: "a", paneIds: ["a", "b"], requested: "b" })).toBe("b");
  });

  it("ignores a request for a pane that is not open", () => {
    expect(resolveFocusedPaneId({ current: "a", paneIds: ["a", "b"], requested: "z" })).toBe("a");
  });

  it("keeps focus put when the pane list only reorders around it", () => {
    expect(resolveFocusedPaneId({ current: "b", paneIds: ["b", "a", "c"] })).toBe("b");
  });

  it("falls back to the first pane when the focused pane closes", () => {
    expect(resolveFocusedPaneId({ current: "b", paneIds: ["a", "c"] })).toBe("a");
  });
});

describe("paneOwnsGlobalHandlers", () => {
  it("always grants the singletons to a lone pane", () => {
    expect(paneOwnsGlobalHandlers({ paneId: "a", paneCount: 1, focusedPaneId: null })).toBe(true);
    expect(paneOwnsGlobalHandlers({ paneId: "a", paneCount: 1, focusedPaneId: "b" })).toBe(true);
  });

  it("grants them to exactly one pane in a split layout", () => {
    expect(paneOwnsGlobalHandlers({ paneId: "a", paneCount: 2, focusedPaneId: "a" })).toBe(true);
    expect(paneOwnsGlobalHandlers({ paneId: "b", paneCount: 2, focusedPaneId: "a" })).toBe(false);
  });

  it("grants them to none while focus is unresolved", () => {
    expect(paneOwnsGlobalHandlers({ paneId: "a", paneCount: 2, focusedPaneId: null })).toBe(false);
  });
});
