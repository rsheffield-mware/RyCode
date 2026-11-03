import { describe, expect, it } from "vite-plus/test";

import {
  browserSurfaceBoxIsPresentable,
  browserSurfaceOwnerYields,
  measureBrowserSurfaceRect,
} from "./browserSurfaceRect";

describe("measureBrowserSurfaceRect", () => {
  it("keeps adjacent panes seamless by rounding both edges", () => {
    const left = measureBrowserSurfaceRect({ x: 0, y: 0, width: 640.4, height: 900 });
    const right = measureBrowserSurfaceRect({ x: 640.4, y: 0, width: 639.6, height: 900 });

    expect(left.x + left.width).toBe(right.x);
    expect(right.x + right.width).toBe(1_280);
  });

  it("reports at least one pixel for a collapsed box", () => {
    expect(measureBrowserSurfaceRect({ x: 12.2, y: 40.9, width: 0, height: 0 })).toEqual({
      x: 12,
      y: 41,
      width: 1,
      height: 1,
    });
  });

  it("treats a collapsed box as unpresentable whatever it rounds to", () => {
    expect(browserSurfaceBoxIsPresentable({ x: 0, y: 0, width: 0, height: 400 })).toBe(false);
    expect(browserSurfaceBoxIsPresentable({ x: 0, y: 0, width: 0.4, height: 400 })).toBe(true);
  });
});

describe("browserSurfaceOwnerYields", () => {
  const claim = (visible: boolean, zIndex: number) => ({ visible, zIndex });

  it("never hands the guest to a slot that does not want to show it", () => {
    expect(
      browserSurfaceOwnerYields({ owner: claim(false, 30), challenger: claim(false, 48) }),
    ).toBe(false);
  });

  it("hands the guest on when its holder is not showing it", () => {
    expect(
      browserSurfaceOwnerYields({ owner: claim(false, 48), challenger: claim(true, 30) }),
    ).toBe(true);
  });

  it("gives two visible slots the guest to whichever draws on top", () => {
    expect(browserSurfaceOwnerYields({ owner: claim(true, 30), challenger: claim(true, 48) })).toBe(
      true,
    );
    expect(browserSurfaceOwnerYields({ owner: claim(true, 48), challenger: claim(true, 30) })).toBe(
      false,
    );
  });

  it("keeps a tie with the incumbent, so equal slots cannot trade the guest", () => {
    expect(browserSurfaceOwnerYields({ owner: claim(true, 30), challenger: claim(true, 30) })).toBe(
      false,
    );
  });
});
