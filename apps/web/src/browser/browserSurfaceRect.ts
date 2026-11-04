import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export interface MeasuredBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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

export function browserSurfaceOwnerYields(input: {
  readonly owner: BrowserSurfaceClaim;
  readonly challenger: BrowserSurfaceClaim;
}): boolean {
  if (!input.challenger.visible) return false;
  if (!input.owner.visible) return true;
  return input.challenger.zIndex > input.owner.zIndex;
}
