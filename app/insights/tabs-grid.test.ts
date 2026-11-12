import { describe, expect, it } from "vitest";
import { initialStateFor } from "./studio-config";
import {
  GRID_SCROLLBAR,
  NUDGE_PANEL_WIDTH,
  TABS_COLUMN_WIDTH,
  GRID_CELL_PADDING,
  TABS_NARROW_STEPS,
  TABS_FILL_STEP,
  studioCanvasWidth,
  layoutKind,
  tabsGridFor,
  tabsGridRoom,
  type LayoutKind,
  type TabsGrid,
} from "./tiles";

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
const NARROWEST = TABS_NARROW_STEPS[TABS_NARROW_STEPS.length - 1];
const five = (columnWidth: number) => ({ columns: 5 as const, columnWidth, cellPadding: GRID_CELL_PADDING });
const wide96 = five(96);
const three = (columnWidth: number, cellPadding: number = GRID_CELL_PADDING) => ({ columns: 3 as const, columnWidth, cellPadding });

describe("studioCanvasWidth", () => {
  it("uses our own box when Studio's measurement reads too wide before it has laid out", () => {
    // A hidden tab at 390px: our box is 358px, Studio's canvas read 1000 before layout.
    expect(studioCanvasWidth(358, false, 1000)).toBe(358);
    expect(tabsGridFor(studioCanvasWidth(358, false, 1000), "phone")).toEqual(three(96));
  });

  it("takes Nudge's docked panel and divider off our box on a laptop", () => {
    expect(studioCanvasWidth(764, true, null)).toBe(764 - NUDGE_PANEL_WIDTH - 1);
  });

  it("follows Studio's measurement when it's narrower, e.g. a panel dragged wider", () => {
    expect(studioCanvasWidth(1020, true, 600)).toBe(600);
  });
});

describe("tabsGridFor", () => {
  // Grid widths measured in a browser: 292, 322 and 448px at a2d06f7, 251px at 1024 with Nudge
  // docked at d2c59c3 (canvas 422).
  it.each([
    [328, "phone", 292, three(90)],
    [358, "phone", 322, three(96)],
    [718, "wide", 448, three(144)],
    [422, "wide", 251, three(78, 4)],
  ] as const)("measured canvas %ipx (%s): grid %ipx", (canvas, kind, room, expected) => {
    expect(tabsGridRoom(canvas, kind)).toBe(room);
    const grid = tabsGridFor(canvas, kind);
    expect(grid).toEqual(expected);
    expect(fits(grid, room)).toBe(true);
  });

  it.each([
    // screen, layout, estimated grid room, grid
    [360, "phone", 292, three(90)],
    [375, "phone", 307, three(96)],
    [390, "phone", 322, three(96)],
    [681, "wide", 397, three(120)],
    [768, "wide", 455, three(144)],
    [900, "wide", 543, five(104)],
    [1024, "wide", 265, three(78, 4)],
    [1280, "wide", 436, three(136)],
    [1366, "wide", 493, three(152)],
    [1600, "wide", 516, wide96],
  ] as const)("%ipx screen (%s, about %ipx of room): every column fits", (screen, kind, room, expected) => {
    const estimate = estimatedCanvas(screen);
    expect(estimate.kind).toBe(kind);
    expect(tabsGridRoom(estimate.canvas, kind)).toBe(room);
    const grid = tabsGridFor(estimate.canvas, kind);
    expect(grid).toEqual(expected);
    expect(fits(grid, room)).toBe(true);
  });

  it("shows five columns only with room for all five at full width and a scrollbar", () => {
    const need = 5 * TABS_COLUMN_WIDTH + GRID_SCROLLBAR;
    // Find the narrowest wide canvas whose grid gets that room.
    let canvas = 600;
    while (tabsGridRoom(canvas, "wide") < need) canvas++;
    expect(tabsGridFor(canvas, "wide").columns).toBe(5);
    expect(tabsGridFor(canvas - 1, "wide").columns).toBe(3);
  });

  it("never goes below 78px with 4px padding, scrolling instead", () => {
    expect(NARROWEST).toEqual({ columnWidth: 78, cellPadding: 4 });
    expect(tabsGridFor(200, "phone")).toEqual(three(78, 4));
  });

  it("changes only at coarse steps, so neighbouring widths give the same grid", () => {
    const narrow = TABS_NARROW_STEPS.map((step) => step.columnWidth as number);
    for (const kind of ["phone", "wide"] as const) {
      for (let canvas = 300; canvas <= 1200; canvas++) {
        const here = tabsGridFor(canvas, kind);
        // A narrow step, or 96px and up in TABS_FILL_STEP steps: never a 1px nudge.
        const allowed = narrow.includes(here.columnWidth) || (here.columnWidth - TABS_COLUMN_WIDTH) % TABS_FILL_STEP === 0;
        expect(allowed, `${kind} ${canvas}: ${here.columnWidth}`).toBe(true);
      }
    }
    expect(tabsGridFor(330, "phone")).toEqual(tabsGridFor(331, "phone"));
    expect(tabsGridFor(700, "wide")).toEqual(tabsGridFor(701, "wide"));
  });

  it("grows the columns to fill the tile, leaving less than one fill step per column unused", () => {
    for (const kind of ["phone", "wide"] as const) {
      for (let canvas = 300; canvas <= 1200; canvas++) {
        const grid = tabsGridFor(canvas, kind);
        if (grid.columnWidth < TABS_COLUMN_WIDTH) continue;
        const spare = tabsGridRoom(canvas, kind) - GRID_SCROLLBAR - grid.columns * grid.columnWidth;
        expect(spare).toBeGreaterThanOrEqual(0);
        if (grid.columnWidth > TABS_COLUMN_WIDTH) expect(spare).toBeLessThan(grid.columns * TABS_FILL_STEP);
      }
    }
  });

  it.each(TABS_NARROW_STEPS.map((step) => [step.columnWidth, step.cellPadding]))(
    "a %ipx column with %ipx padding still leaves room for RM 1,250.00",
    (columnWidth, cellPadding) => {
      expect(columnWidth - 2 * cellPadding).toBeGreaterThanOrEqual(AMOUNT_WIDTH);
    },
  );

  it("leaves room for an amount like RM 1,250.00 at full width", () => {
    expect(TABS_COLUMN_WIDTH - 2 * GRID_CELL_PADDING).toBeGreaterThanOrEqual(AMOUNT_WIDTH);
  });
});

type GridState = { dataMapping: { cols: unknown[] }; format: { style: { columnWidth: number; headerRow?: { wrapText?: boolean } } } };
const tabsState = (kind: LayoutKind, grid: TabsGrid) =>
  (initialStateFor(kind, grid).pages[0].widgets as unknown as Record<string, GridState>).tabs;

describe("Every tab grid state", () => {
  it("shows customer, amount and days late with three columns, all five with five", () => {
    expect(tabsState("phone", three(90)).dataMapping.cols).toEqual([
      { id: "tabs.customer" },
      { id: "tabs.amount" },
      { id: "tabs.daysLate" },
    ]);
    expect(tabsState("wide", wide96).dataMapping.cols).toHaveLength(5);
  });

  it("uses the width it is given", () => {
    expect(tabsState("wide", three(78, 4)).format.style.columnWidth).toBe(78);
  });

  it("lets long headers wrap instead of cutting them", () => {
    expect(tabsState("phone", three(96)).format.style.headerRow?.wrapText).toBe(true);
  });
});
