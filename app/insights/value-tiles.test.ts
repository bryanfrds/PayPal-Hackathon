import { describe, expect, it } from "vitest";
import { initialStateFor } from "./studio-config";
import {
  GRID_CELL_PADDING,
  NUDGE_PANEL_WIDTH,
  TABS_COLUMN_WIDTH,
  VALUE_AMOUNT_WIDTH,
  VALUE_FONT_SIZE,
  canvasHeight,
  layoutKind,
  tabsTileWidth,
  valueTileRoom,
  valueTilesFor,
  widgetLayout,
  type LayoutKind,
  type ValueTilesPerRow,
} from "./tiles";

// "RM 12,345.60" in 28px Manrope ExtraBold, from the advance widths of the Manrope file
// next/font serves (variable font, weight 800).
const AMOUNT_AT_28 = 182.4;

// As in tabs-grid.test.ts: the app measures Studio's canvas; these mirror globals.css only to
// estimate it per screen width.
const SIDEBAR = 220;
const PAGE_MAX = 1180;
const pagePadding = (screen: number) => (screen <= 600 ? 16 : 20);
const DOCKS = 1024;
function estimatedCanvas(screen: number) {
  const box = Math.min(screen - (screen >= DOCKS ? SIDEBAR : 0), PAGE_MAX) - 2 * pagePadding(screen);
  return { kind: layoutKind(box), canvas: box - (screen >= DOCKS ? NUDGE_PANEL_WIDTH + 1 : 0) };
}

const grid = { columns: 3, columnWidth: TABS_COLUMN_WIDTH, cellPadding: GRID_CELL_PADDING } as const;

describe("value tile room", () => {
  it("needs room for RM 12,345.60 at the tiles' font size", () => {
    expect(VALUE_FONT_SIZE).toBe(28);
    expect(VALUE_AMOUNT_WIDTH).toBeGreaterThanOrEqual(Math.ceil(AMOUNT_AT_28));
  });

  // The bug: the old fixed layouts left less room than the amount, so Studio cut it.
  it.each([
    // canvas, layout, value tiles a row, room
    [328, "phone", 2, 120], // 360px phone: "RM 197…"
    [422, "wide", 3, 99], // 1024px laptop with Nudge docked: "…"
  ] as const)("a %ipx %s canvas with %i tiles a row leaves only %ipx", (canvas, kind, values, room) => {
    expect(valueTileRoom(canvas, kind, values)).toBe(room);
    expect(room).toBeLessThan(VALUE_AMOUNT_WIDTH);
  });

  it.each([
    // screen, layout, value tiles a row, room for the amount
    [360, "phone", 1, 276],
    [390, "phone", 1, 306],
    [1024, "wide", 1, 391],
    [1280, "wide", 3, 191],
    [1600, "wide", 3, 231],
  ] as const)("%ipx screen (%s): %i value tiles a row, %ipx for the amount", (screen, kind, values, room) => {
    const estimate = estimatedCanvas(screen);
    expect(estimate.kind).toBe(kind);
    expect(valueTilesFor(estimate.canvas, kind)).toBe(values);
    expect(valueTileRoom(estimate.canvas, kind, values)).toBe(room);
    expect(room).toBeGreaterThanOrEqual(VALUE_AMOUNT_WIDTH);
  });

  it("keeps three value tiles a row at 1280px even with a classic 15px scrollbar", () => {
    const { canvas } = estimatedCanvas(1280);
    expect(valueTilesFor(canvas - 15, "wide")).toBe(3);
  });

  it("stacks the value tiles on the measured 1024px-with-Nudge canvas too", () => {
    expect(valueTilesFor(422, "wide")).toBe(1);
  });

  it("always picks a row whose tiles fit the amount, from 300px up", () => {
    for (const kind of ["phone", "wide"] as const) {
      for (let canvas = 300; canvas <= 1200; canvas++) {
        expect(valueTileRoom(canvas, kind, valueTilesFor(canvas, kind))).toBeGreaterThanOrEqual(VALUE_AMOUNT_WIDTH);
      }
    }
  });

  it("changes only at a couple of widths, so Studio rarely remounts", () => {
    for (const kind of ["phone", "wide"] as const) {
      let changes = 0;
      for (let canvas = 300; canvas < 1200; canvas++) {
        const here = valueTilesFor(canvas, kind);
        const next = valueTilesFor(canvas + 1, kind);
        if (here !== next) changes++;
        // Wider never means fewer to a row.
        expect(next).toBeGreaterThanOrEqual(here);
      }
      expect(changes).toBe(kind === "phone" ? 1 : 2);
    }
  });
});

const COMBOS: [LayoutKind, ValueTilesPerRow][] = [
  ["phone", 2],
  ["phone", 1],
  ["wide", 3],
  ["wide", 2],
  ["wide", 1],
];

describe("layouts with the value tiles moved", () => {
  it.each(COMBOS)("%s with %i a row: every tile inside 12 columns, none overlapping", (kind, values) => {
    const boxes = Object.values(widgetLayout(kind, values));
    for (const box of boxes) {
      expect(box.xTrack).toBeGreaterThanOrEqual(0);
      expect(box.xTrack + box.xSpan).toBeLessThanOrEqual(12);
    }
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

  it.each(COMBOS)("%s with %i a row: the tiles below sit straight under the value tiles", (kind, values) => {
    const layout = widgetLayout(kind, values);
    const valuesBottom = Math.max(...[layout.owed, layout.collected, layout.overdue].map((b) => b.yTrack + b.ySpan));
    expect(Math.min(layout.board.yTrack, layout.trend.yTrack)).toBe(valuesBottom);
  });

  it("keeps the default layouts as they were", () => {
    expect(widgetLayout("phone", 2)).toEqual(widgetLayout("phone"));
    expect(widgetLayout("wide", 3)).toEqual(widgetLayout("wide"));
    expect(widgetLayout("phone").owed).toEqual({ xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 7 });
    expect(widgetLayout("wide").owed).toEqual({ xTrack: 0, yTrack: 0, xSpan: 4, ySpan: 7 });
  });

  it("gives each money tile the full width when one a row", () => {
    const layout = widgetLayout("phone", 1);
    expect(layout.owed.xSpan).toBe(12);
    expect(layout.collected.xSpan).toBe(12);
  });

  it("grows the phone page by the rows the stacked tiles add", () => {
    expect(canvasHeight("phone", 1) - canvasHeight("phone", 2)).toBe(7 * 16);
  });

  it("never moves the Every tab tile sideways, so its grid sizing still holds", () => {
    for (const [kind, values] of COMBOS) {
      const base = widgetLayout(kind).tabs;
      const moved = widgetLayout(kind, values).tabs;
      expect([moved.xTrack, moved.xSpan]).toEqual([base.xTrack, base.xSpan]);
    }
    expect(tabsTileWidth(422, "wide")).toBe(271);
  });
});

type ValueState = { format: { style: { typography: { fontSize: number }; textScaling?: { enabled?: boolean } } } };
type LayoutState = Record<string, { xSpan: number }>;
const page = (values: ValueTilesPerRow, kind: LayoutKind = "wide") => initialStateFor(kind, grid, undefined, values).pages[0];

describe("value tile state", () => {
  it("lays the tiles out for the row it's given", () => {
    expect((page(1).widgetLayout as unknown as LayoutState).owed.xSpan).toBe(12);
    expect((page(3).widgetLayout as unknown as LayoutState).owed.xSpan).toBe(4);
  });

  it.each(["owed", "collected", "overdue"])("%s uses the 28px amount and Studio's fit-to-tile scaling", (id) => {
    const widget = (page(3).widgets as unknown as Record<string, ValueState>)[id];
    expect(widget.format.style.typography.fontSize).toBe(VALUE_FONT_SIZE);
    expect(widget.format.style.textScaling?.enabled).toBe(true);
  });
});
