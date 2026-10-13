import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  PAGE_PADDING,
  ROW_HEIGHT,
  canvasHeight,
  layoutKind,
  widgetLayout,
  type LayoutKind,
} from "./tiles";

const KINDS: LayoutKind[] = ["phone", "wide"];

describe("layoutKind", () => {
  it("stacks tiles up to 640px and spreads them out after", () => {
    expect(layoutKind(390)).toBe("phone");
    expect(layoutKind(640)).toBe("phone");
    expect(layoutKind(641)).toBe("wide");
  });
});

describe("widgetLayout", () => {
  it.each(KINDS)("keeps every %s tile inside the 12 columns", (kind) => {
    for (const box of Object.values(widgetLayout(kind))) {
      expect(box.xTrack).toBeGreaterThanOrEqual(0);
      expect(box.xTrack + box.xSpan).toBeLessThanOrEqual(COLUMNS);
    }
  });

  it.each(KINDS)("never overlaps two %s tiles", (kind) => {
    const boxes = Object.values(widgetLayout(kind));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.xTrack + a.xSpan <= b.xTrack ||
          b.xTrack + b.xSpan <= a.xTrack ||
          a.yTrack + a.ySpan <= b.yTrack ||
          b.yTrack + b.ySpan <= a.yTrack;
        expect(apart).toBe(true);
      }
    }
  });
});

describe("canvasHeight", () => {
  it.each(KINDS)("fits the lowest %s tile plus padding", (kind) => {
    const bottom = Math.max(
      ...Object.values(widgetLayout(kind)).map((b) => b.yTrack + b.ySpan),
    );
    expect(canvasHeight(kind)).toBe(bottom * ROW_HEIGHT + PAGE_PADDING * 2);
  });

  it("is taller on a phone, where tiles stack", () => {
    expect(canvasHeight("phone")).toBeGreaterThan(canvasHeight("wide"));
  });
});
