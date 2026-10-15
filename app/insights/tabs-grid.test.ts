import { describe, expect, it } from "vitest";
import { initialStateFor } from "./studio-config";
import { COLUMNS, PAGE_PADDING, WIDGET_PADDING, layoutKind, widgetLayout, type LayoutKind } from "./tiles";

// globals.css: .site-main is at most 1180px wide, padded 1rem a side up to 600px wide, 1.25rem above.
const sitePadding = (screen: number) => (screen <= 600 ? 16 : 20);
// On wide screens Nudge's panel (studioAiPanelWidth) and its 1px divider sit beside the dashboard.
const NUDGE_PANEL = 340 + 1;
// Studio's grid cells use its 8px spacing as padding on each side.
const CELL_PADDING = 2 * 8;
// "RM 1,250.00" (Intl en-MY) in 13px Manrope, from the font's own advance widths.
const AMOUNT_WIDTH = 69;

/** Inner width of the "Every tab" grid on a screen this wide. */
function tabsGridWidth(screen: number) {
  const page = Math.min(screen, 1180) - 2 * sitePadding(screen);
  const kind = layoutKind(page);
  const canvas = page - (kind === "wide" ? NUDGE_PANEL : 0);
  const track = (canvas - 2 * PAGE_PADDING) / COLUMNS;
  const { xTrack, xSpan } = widgetLayout(kind).tabs;
  const tile = Math.floor((xTrack + xSpan) * track) - Math.floor(xTrack * track);
  return { kind, room: tile - 2 * WIDGET_PADDING };
}

type GridState = { dataMapping: { cols: unknown[] }; format: { style: { columnWidth: number; headerRow?: { wrapText?: boolean } } } };
const tabs = (kind: LayoutKind) =>
  (initialStateFor(kind).pages[0].widgets as unknown as Record<string, GridState>).tabs;
const used = (kind: LayoutKind) => tabs(kind).dataMapping.cols.length * tabs(kind).format.style.columnWidth;

describe("Every tab grid", () => {
  it.each([
    [360, "phone", 292],
    [375, "phone", 307],
    [390, "phone", 322],
    [1280, "wide", 502],
    [1600, "wide", 502],
  ] as const)("fits every column at %ipx (%s, %ipx of room)", (screen, kind, room) => {
    expect(tabsGridWidth(screen)).toEqual({ kind, room });
    expect(used(kind)).toBeLessThanOrEqual(room);
  });

  it("shows customer, amount and days late on a phone, all five columns on wider screens", () => {
    expect(tabs("phone").dataMapping.cols).toEqual([{ id: "tabs.customer" }, { id: "tabs.amount" }, { id: "tabs.daysLate" }]);
    expect(tabs("wide").dataMapping.cols).toHaveLength(5);
  });

  it.each(["phone", "wide"] as const)("leaves room for an amount like RM 1,250.00 (%s)", (kind) => {
    expect(tabs(kind).format.style.columnWidth - CELL_PADDING).toBeGreaterThanOrEqual(AMOUNT_WIDTH);
  });


  it.each(["phone", "wide"] as const)("lets long %s headers wrap instead of cutting them", (kind) => {
    expect(tabs(kind).format.style.headerRow?.wrapText).toBe(true);
  });
});
