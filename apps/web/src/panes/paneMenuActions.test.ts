import { describe, expect, it } from "vite-plus/test";

import { resolvePaneMenuIntent } from "./paneMenuActions";

const PANES = ["pane:primary", "t:env:thread-2"] as const;

describe("resolvePaneMenuIntent", () => {
  it("ignores menu actions that are not pane actions", () => {
    expect(
      resolvePaneMenuIntent({
        action: "open-settings",
        paneIds: PANES,
        focusedPaneId: "pane:primary",
      }),
    ).toBeNull();
  });

  it("always offers the thread picker, since a split needs a thread to show", () => {
    expect(
      resolvePaneMenuIntent({ action: "split-right", paneIds: [], focusedPaneId: null }),
    ).toEqual({ kind: "pick-thread-for-new-pane", edge: "right" });
  });

  it("carries the direction the menu item asked for", () => {
    expect(
      resolvePaneMenuIntent({ action: "split-down", paneIds: PANES, focusedPaneId: null }),
    ).toEqual({ kind: "pick-thread-for-new-pane", edge: "bottom" });
  });

  it("closes the focused pane", () => {
    expect(
      resolvePaneMenuIntent({
        action: "close-pane",
        paneIds: PANES,
        focusedPaneId: "t:env:thread-2",
      }),
    ).toEqual({ kind: "close-pane", paneId: "t:env:thread-2" });
  });

  it("leaves a single-pane layout alone", () => {
    expect(
      resolvePaneMenuIntent({
        action: "close-pane",
        paneIds: ["pane:primary"],
        focusedPaneId: "pane:primary",
      }),
    ).toBeNull();
  });

  it("falls back to the first pane when focus has not settled yet", () => {
    expect(
      resolvePaneMenuIntent({ action: "close-pane", paneIds: PANES, focusedPaneId: null }),
    ).toEqual({ kind: "close-pane", paneId: "pane:primary" });
  });

  it("ignores a focused pane that has already been closed", () => {
    expect(
      resolvePaneMenuIntent({
        action: "close-pane",
        paneIds: PANES,
        focusedPaneId: "t:env:gone",
      }),
    ).toEqual({ kind: "close-pane", paneId: "pane:primary" });
  });
});
