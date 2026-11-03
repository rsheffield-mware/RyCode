import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export interface MeasuredBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Snaps a measured DOM box onto the integer rect the guest is positioned with.
 *
 * Both edges are rounded and the size derived from them, rather than rounding
 * the origin and the size independently: with panes side by side a fractional
 * split puts a slot's right edge at x + width, and rounding the two separately
 * moves that edge by up to a pixel, which shows as a seam or an overlap at the
 * splitter. A degenerate box still reports at least one pixel, since a guest
 * cannot be sized to nothing.
 */
export function measureBrowserSurfaceRect(box: MeasuredBox): BrowserSurfaceRect {
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const right = Math.round(box.x + box.width);
  const bottom = Math.round(box.y + box.height);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** A box with no area cannot show a guest, however its rounded rect reads. */
export function browserSurfaceBoxIsPresentable(box: MeasuredBox): boolean {
  return box.width > 0 && box.height > 0;
}

export interface BrowserSurfaceClaim {
  readonly visible: boolean;
  readonly zIndex: number;
}

/**
 * Decides whether a slot holding a tab's guest hands it to another slot.
 *
 * One runtime tab can be slotted twice — the preview panel and the mini player
 * overlap across a commit, and an automation host can sit under either. The
 * answer depends only on what the two slots are asking for, never on which of
 * them measured first, so a layout pass reaches the same owner whatever order
 * its listeners run in. A slot that does not want to show the guest never takes
 * it, an idle owner always yields, and between two visible slots the one that
 * would be drawn on top wins. A tie keeps the incumbent, which is what stops
 * two equal claimants trading the guest back and forth.
 */
export function browserSurfaceOwnerYields(input: {
  readonly owner: BrowserSurfaceClaim;
  readonly challenger: BrowserSurfaceClaim;
}): boolean {
  if (!input.challenger.visible) return false;
  if (!input.owner.visible) return true;
  return input.challenger.zIndex > input.owner.zIndex;
}
