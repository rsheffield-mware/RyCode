import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  acquireBrowserSurface,
  acquireBrowserSurfaceActivity,
  useBrowserSurfaceStore,
} from "./browserSurfaceStore";

describe("browserSurfaceStore", () => {
  beforeEach(() => {
    useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  });

  it("keeps concurrent background work active until every lease is released", () => {
    const first = acquireBrowserSurfaceActivity("background-browser");
    const second = acquireBrowserSurfaceActivity("background-browser");

    first();
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-browser"]).toBe(1);

    second();
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-browser"]).toBeUndefined();
  });

  it("freezes the source content dimensions for a fitted presentation", () => {
    const tabId = "fitted-browser-surface";
    const sourceOwner = Symbol("source");
    const sourceContent = {
      x: 10,
      y: 20,
      width: 1_280,
      height: 720,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    useBrowserSurfaceStore.getState().claim(tabId, sourceOwner, false);
    useBrowserSurfaceStore.getState().presentContent(tabId, sourceContent);

    const fittedLease = acquireBrowserSurface(tabId, true);
    useBrowserSurfaceStore.getState().presentContent(tabId, {
      ...sourceContent,
      width: 360,
      height: 203,
      scale: 0.28125,
    });

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]?.fittedSourceContent).toEqual(
      sourceContent,
    );
    fittedLease.release();
  });

  it("keeps a visible surface with its holder when a second slot offers the same layer", () => {
    const tabId = "leased-browser-surface";
    const heldRect = { x: 0, y: 0, width: 500, height: 700 };
    const rivalRect = { x: 10, y: 20, width: 900, height: 640 };
    const holder = acquireBrowserSurface(tabId);
    holder.present(heldRect, true);

    const rival = acquireBrowserSurface(tabId);
    expect(rival.present(rivalRect, true)).toBe(false);
    expect(holder.present(heldRect, true)).toBe(true);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      rect: heldRect,
      visible: true,
    });
  });

  it("hands a visible surface to a slot that would draw it on top", () => {
    const tabId = "layered-lease-browser-surface";
    const panelRect = { x: 0, y: 0, width: 500, height: 700 };
    const miniPlayerRect = { x: 10, y: 20, width: 320, height: 200 };
    const panel = acquireBrowserSurface(tabId);
    panel.present(panelRect, true, 0, 30);

    const miniPlayer = acquireBrowserSurface(tabId);
    expect(miniPlayer.present(miniPlayerRect, true, 12, 48)).toBe(true);
    expect(panel.present(panelRect, true, 0, 30)).toBe(false);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      rect: miniPlayerRect,
      visible: true,
      zIndex: 48,
    });
  });

  it("hands a surface on as soon as its holder stops showing the guest", () => {
    const tabId = "yielded-browser-surface";
    const waitingRect = { x: 4, y: 8, width: 640, height: 480 };
    const holder = acquireBrowserSurface(tabId);
    holder.present({ x: 0, y: 0, width: 500, height: 700 }, true);

    const waiting = acquireBrowserSurface(tabId);
    expect(waiting.present(waitingRect, true)).toBe(false);
    holder.present({ x: 0, y: 0, width: 500, height: 700 }, false);
    expect(waiting.present(waitingRect, true)).toBe(true);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      rect: waitingRect,
      visible: true,
    });
  });

  it("ignores a release from a slot that no longer holds the surface", () => {
    const tabId = "released-rival-browser-surface";
    const liveRect = { x: 10, y: 20, width: 900, height: 640 };
    const displaced = acquireBrowserSurface(tabId);
    const live = acquireBrowserSurface(tabId);
    live.present(liveRect, true);

    displaced.release();

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      rect: liveRect,
      visible: true,
    });
  });

  it("hides a surface when its current lease is released", () => {
    const tabId = "released-browser-surface";
    const lease = acquireBrowserSurface(tabId);
    lease.present({ x: 10, y: 20, width: 900, height: 640 }, true);

    lease.release();
    lease.present({ x: 0, y: 0, width: 1, height: 1 }, true);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      visible: false,
      owner: null,
    });
  });

  it("keeps the requested layer with the active surface lease", () => {
    const tabId = "layered-browser-surface";
    const lease = acquireBrowserSurface(tabId);
    lease.present({ x: 10, y: 20, width: 320, height: 200 }, true, 12, 48);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      visible: true,
      zIndex: 48,
    });
  });

  it("clears fitted presentation state when its lease is released", () => {
    const tabId = "released-fitted-browser-surface";
    const fittedLease = acquireBrowserSurface(tabId, true);
    useBrowserSurfaceStore.getState().presentContent(tabId, {
      x: 0,
      y: 0,
      width: 1_280,
      height: 800,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    });

    fittedLease.release();

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      fittedSourceContent: null,
      fitSourceContent: false,
      owner: null,
      visible: false,
    });
  });
});
