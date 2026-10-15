import { describe, expect, it } from "vitest";
import { initialStateFor } from "./studio-config";
import { COLUMNS, PAGE_PADDING, WIDGET_PADDING, widgetLayout, type LayoutKind } from "./tiles";

// globals.css: .site-main has 1rem padding each side under 600px wide, 1.25rem above.
const sitePadding = (screen: number) => (screen <= 600 ? 16 : 20);
/** Inner width of the "Every tab" grid for a screen this wide (no Nudge panel beside it). */
function tabsGridWidth(screen: number, kind: LayoutKind) {
  const canvas = Math.min(screen, 1180) - 2 * sitePadding(screen) - 2 * PAGE_PADDING;
  const tile = Math.floor((canvas * widgetLayout(kind).tabs.xSpan) / COLUMNS);
  return tile - 2 * WIDGET_PADDING;
}

type GridState = { dataMapping: { cols: unknown[] }; format: { style: { columnWidth: number; headerRow?: { wrapText?: boolean } } } };
const tabs = (kind: LayoutKind) =>
  (initialStateFor(kind).pages[0].widgets as unknown as Record<string, GridState>).tabs;
const used = (kind: LayoutKind) => tabs(kind).dataMapping.cols.length * tabs(kind).format.style.columnWidth;

describe("Every tab grid", () => {
  it.each([375, 390])("shows every column without cutting one off on a %ipx phone", (screen) => {
    expect(used("phone")).toBeLessThanOrEqual(tabsGridWidth(screen, "phone"));
  });

  it("keeps all five columns on wider screens", () => {
    expect(tabs("wide").dataMapping.cols).toHaveLength(5);
  });

  it("leaves room for an amount like RM 128.00 in each column", () => {
    // AG Grid pads each cell 16px a side; "RM 128.00" is about 69px in 14px Manrope.
    for (const kind of ["phone", "wide"] as const) {
      expect(tabs(kind).format.style.columnWidth - 32).toBeGreaterThanOrEqual(69);
    }
  });

  it.each(["phone", "wide"] as const)("lets long %s headers wrap instead of cutting them", (kind) => {
    expect(tabs(kind).format.style.headerRow?.wrapText).toBe(true);
  });
});
