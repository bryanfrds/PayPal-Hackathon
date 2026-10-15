import { describe, expect, it } from "vitest";
import { initialStateFor } from "./studio-config";
import {
  GRID_SCROLLBAR,
  NUDGE_PANEL_WIDTH,
  TABS_COLUMN_WIDTH,
  TABS_NARROW_WIDTHS,
  layoutKind,
  tabsGridFor,
  tabsGridRoom,
  type LayoutKind,
  type TabsGrid,
} from "./tiles";

// Studio's grid cells use its 8px spacing as padding on each side.
const CELL_PADDING = 2 * 8;
// "RM 1,250.00" (Intl en-MY) in 13px Manrope, from the font's own advance widths.
const AMOUNT_WIDTH = 69;

// The app measures Studio's canvas; these mirror globals.css only to estimate it per screen width.
const SIDEBAR = 220; // the laptop menu column, from 1024px (globals.css, "Laptop: sidebar menu")
const PAGE_MAX = 1180; // .site-main:has(.insights)
const pagePadding = (screen: number) => (screen <= 600 ? 16 : 20); // .site-main, 1rem / 1.25rem
const DOCKS = 1024; // useIsWide: Nudge's panel (plus its 1px divider) sits beside the dashboard

/** Estimated Studio canvas width on a screen this wide. */
function estimatedCanvas(screen: number) {
  const box = Math.min(screen - (screen >= DOCKS ? SIDEBAR : 0), PAGE_MAX) - 2 * pagePadding(screen);
  return { kind: layoutKind(box), canvas: box - (screen >= DOCKS ? NUDGE_PANEL_WIDTH + 1 : 0) };
}

const fits = (grid: TabsGrid, room: number) => grid.columns * grid.columnWidth + GRID_SCROLLBAR <= room;
const NARROWEST = TABS_NARROW_WIDTHS[TABS_NARROW_WIDTHS.length - 1];
/** Fits, or is already at the narrowest width and scrolls sideways rather than cut amounts. */
const fitsOrScrolls = (grid: TabsGrid, room: number) => fits(grid, room) || grid.columnWidth === NARROWEST;

describe("tabsGridFor", () => {
  // Canvas widths measured in a browser at a2d06f7: the grid was 292, 322 and 448px wide.
  it.each([
    [328, "phone", 292, 3, 90],
    [358, "phone", 322, 3, 96],
    [718, "wide", 448, 3, 96],
  ] as const)("measured canvas %ipx (%s): grid %ipx, %i columns of %ipx", (canvas, kind, room, columns, columnWidth) => {
    expect(tabsGridRoom(canvas, kind)).toBe(room);
    const grid = tabsGridFor(canvas, kind);
    expect(grid).toEqual({ columns, columnWidth });
    expect(fits(grid, room)).toBe(true);
  });

  it.each([
    // screen, layout, estimated grid room, columns, column width
    [360, "phone", 292, 3, 90],
    [375, "phone", 307, 3, 96],
    [390, "phone", 322, 3, 96],
    [681, "wide", 397, 3, 96],
    [768, "wide", 455, 3, 96],
    [900, "wide", 543, 5, 96],
    [1024, "wide", 252, 3, 85], // scrolls 19px sideways if the room really is this small
    [1280, "wide", 422, 3, 96],
    [1366, "wide", 480, 3, 96],
    [1600, "wide", 502, 5, 96],
  ] as const)("%ipx screen (%s, about %ipx): %i columns of %ipx that fit", (screen, kind, room, columns, columnWidth) => {
    const estimate = estimatedCanvas(screen);
    expect(estimate.kind).toBe(kind);
    expect(tabsGridRoom(estimate.canvas, kind)).toBe(room);
    const grid = tabsGridFor(estimate.canvas, kind);
    expect(grid).toEqual({ columns, columnWidth });
    expect(fitsOrScrolls(grid, room)).toBe(true);
  });

  it("shows five columns only with room for all five at full width and a scrollbar", () => {
    const need = 5 * TABS_COLUMN_WIDTH + GRID_SCROLLBAR;
    // Find the narrowest wide canvas whose grid gets that room.
    let canvas = 600;
    while (tabsGridRoom(canvas, "wide") < need) canvas++;
    expect(tabsGridFor(canvas, "wide").columns).toBe(5);
    expect(tabsGridFor(canvas - 1, "wide").columns).toBe(3);
  });

  it("never goes below 85px, scrolling instead", () => {
    expect(NARROWEST).toBe(85);
    expect(tabsGridFor(200, "phone")).toEqual({ columns: 3, columnWidth: 85 });
  });

  it("changes only at a few coarse steps, so neighbouring widths give the same grid", () => {
    const seen = new Set<string>();
    for (const kind of ["phone", "wide"] as const) {
      for (let canvas = 300; canvas <= 1200; canvas++) {
        const here = tabsGridFor(canvas, kind);
        seen.add(`${here.columns}x${here.columnWidth}`);
        const next = tabsGridFor(canvas + 1, kind);
        // Any change is a step to the next allowed width or to five columns, never a 1px nudge.
        if (here.columnWidth !== next.columnWidth) expect([...TABS_NARROW_WIDTHS]).toContain(next.columnWidth);
      }
    }
    expect([...seen].sort()).toEqual(["3x85", "3x90", "3x96", "5x96"]);
    expect(tabsGridFor(330, "phone")).toEqual(tabsGridFor(331, "phone"));
    expect(tabsGridFor(700, "wide")).toEqual(tabsGridFor(701, "wide"));
  });

  it("85px still leaves room for an amount like RM 1,250.00", () => {
    expect(NARROWEST - CELL_PADDING).toBeGreaterThanOrEqual(AMOUNT_WIDTH);
  });

  it("leaves room for an amount like RM 1,250.00 at full width", () => {
    expect(TABS_COLUMN_WIDTH - CELL_PADDING).toBeGreaterThanOrEqual(AMOUNT_WIDTH);
  });
});

type GridState = { dataMapping: { cols: unknown[] }; format: { style: { columnWidth: number; headerRow?: { wrapText?: boolean } } } };
const tabsState = (kind: LayoutKind, grid: TabsGrid) =>
  (initialStateFor(kind, grid).pages[0].widgets as unknown as Record<string, GridState>).tabs;

describe("Every tab grid state", () => {
  it("shows customer, amount and days late with three columns, all five with five", () => {
    expect(tabsState("phone", { columns: 3, columnWidth: 90 }).dataMapping.cols).toEqual([
      { id: "tabs.customer" },
      { id: "tabs.amount" },
      { id: "tabs.daysLate" },
    ]);
    expect(tabsState("wide", { columns: 5, columnWidth: 96 }).dataMapping.cols).toHaveLength(5);
  });

  it("uses the width it is given", () => {
    expect(tabsState("wide", { columns: 3, columnWidth: 85 }).format.style.columnWidth).toBe(85);
  });

  it("lets long headers wrap instead of cutting them", () => {
    expect(tabsState("phone", { columns: 3, columnWidth: 96 }).format.style.headerRow?.wrapText).toBe(true);
  });
});
