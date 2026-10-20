// Where each Insights tile sits: one layout for phones, one for wider screens.
// No AG Studio imports, so it can be tested in Node.

export type WidgetId =
  "owed" | "collected" | "overdue" | "board" | "trend" | "late" | "tabs";

type Box = [x: number, y: number, w: number, h: number];
type Layout = Record<WidgetId, Box>;

export const COLUMNS = 12;
export const ROW_HEIGHT = 16;
export const PAGE_PADDING = 8;
/** Room Studio leaves around each tile (the theme's studioWidgetPadding), in px. */
export const WIDGET_PADDING = 10;
/** Widest container that still gets the stacked phone layout, in px. */
export const PHONE_MAX = 640;

// 12 columns, 16px rows.
const PHONE: Layout = {
  owed: [0, 0, 6, 7],
  collected: [6, 0, 6, 7],
  overdue: [0, 7, 12, 6],
  board: [0, 13, 12, 18],
  trend: [0, 31, 12, 16],
  late: [0, 47, 12, 13],
  tabs: [0, 60, 12, 20],
};

const WIDE: Layout = {
  owed: [0, 0, 4, 7],
  collected: [4, 0, 4, 7],
  overdue: [8, 0, 4, 7],
  board: [0, 7, 6, 19],
  trend: [6, 7, 6, 19],
  late: [0, 26, 4, 16],
  // How many grid columns fit depends on the measured width (see tabsGridFor).
  tabs: [4, 26, 8, 16],
};

export type LayoutKind = "phone" | "wide";

export function layoutKind(width: number): LayoutKind {
  return width <= PHONE_MAX ? "phone" : "wide";
}

// The three value tiles ("Still owed to you", "Collected", "Overdue") across the top. How many
// share a row depends on the measured canvas width (see valueTilesFor): side by side as in PHONE
// and WIDE when the amounts fit, otherwise two to a row or one per row, with every tile below
// moved down to make room.
export type ValueTilesPerRow = 1 | 2 | 3;
type ValueTileId = "owed" | "collected" | "overdue";
const VALUE_ROWS: Record<1 | 2, Record<ValueTileId, Box>> = {
  2: { owed: [0, 0, 6, 7], collected: [6, 0, 6, 7], overdue: [0, 7, 12, 6] },
  1: { owed: [0, 0, 12, 7], collected: [0, 7, 12, 7], overdue: [0, 14, 12, 6] },
};
/** Most value tiles to a row in each layout, widest first: what PHONE and WIDE use. */
const VALUE_STEPS: Record<LayoutKind, readonly ValueTilesPerRow[]> = { phone: [2, 1], wide: [3, 2, 1] };

const bottomOf = (boxes: Box[]) => Math.max(...boxes.map(([, y, , h]) => y + h));

function layoutFor(kind: LayoutKind, values: ValueTilesPerRow): Layout {
  const base = kind === "phone" ? PHONE : WIDE;
  if (values === VALUE_STEPS[kind][0]) return base;
  const top = VALUE_ROWS[values as 1 | 2];
  const { owed, collected, overdue, ...rest } = base;
  const shift = bottomOf(Object.values(top)) - bottomOf([owed, collected, overdue]);
  const moved = Object.fromEntries(
    Object.entries(rest).map(([id, [x, y, w, h]]) => [id, [x, y + shift, w, h]]),
  ) as Record<Exclude<WidgetId, ValueTileId>, Box>;
  return { ...top, ...moved };
}

export type WidgetBox = {
  xTrack: number;
  yTrack: number;
  xSpan: number;
  ySpan: number;
};

/** Studio's widgetLayout for the given layout, with `values` value tiles to a row. */
export function widgetLayout(kind: LayoutKind, values: ValueTilesPerRow = VALUE_STEPS[kind][0]): Record<WidgetId, WidgetBox> {
  const layout = layoutFor(kind, values);
  return Object.fromEntries(
    Object.entries(layout).map(([id, [xTrack, yTrack, xSpan, ySpan]]) => [
      id,
      { xTrack, yTrack, xSpan, ySpan },
    ]),
  ) as Record<WidgetId, WidgetBox>;
}

/** Studio fills its parent, so the parent gets the height of the tallest column of tiles. */
export function canvasHeight(kind: LayoutKind, values: ValueTilesPerRow = VALUE_STEPS[kind][0]): number {
  return bottomOf(Object.values(layoutFor(kind, values))) * ROW_HEIGHT + PAGE_PADDING * 2;
}

/** Width of a tile at column `x`, `w` columns wide, on a Studio canvas this wide, by Studio's own track sums. */
function tileWidth(canvasWidth: number, x: number, w: number): number {
  const track = (canvasWidth - 2 * PAGE_PADDING) / COLUMNS;
  return Math.floor((x + w) * track) - Math.floor(x * track);
}

/** The value tiles' amount size (their typography.fontSize), in px. */
export const VALUE_FONT_SIZE = 28;
/** Studio's value widget keeps its own spacing (8px) clear on each side, inside the tile padding. */
export const VALUE_SIDE_MARGIN = 8;
/**
 * Room "RM 12,345.60" needs at VALUE_FONT_SIZE: 182.4px in Manrope ExtraBold (the value tiles use
 * the theme's Manrope at weight 800), from the advance widths of the Manrope file next/font serves.
 * Studio cuts a value that's wider than its tile ("RM 197…", or just "…").
 */
export const VALUE_AMOUNT_WIDTH = 183;

/** Room for the amount inside the narrower of the two money tiles, with `values` value tiles to a row. */
export function valueTileRoom(canvasWidth: number, kind: LayoutKind, values: ValueTilesPerRow): number {
  const { owed, collected } = layoutFor(kind, values);
  const narrowest = Math.min(...[owed, collected].map(([x, , w]) => tileWidth(canvasWidth, x, w)));
  return narrowest - 2 * WIDGET_PADDING - 2 * VALUE_SIDE_MARGIN;
}

/**
 * How many value tiles share a row: as many as the layout allows while "RM 12,345.60" still fits
 * at full size, else one per row. Only a few steps, so Studio (which reads the layout once and is
 * remounted when it changes) remounts at two or three widths at most.
 */
export function valueTilesFor(canvasWidth: number, kind: LayoutKind): ValueTilesPerRow {
  return VALUE_STEPS[kind].find((values) => valueTileRoom(canvasWidth, kind, values) >= VALUE_AMOUNT_WIDTH) ?? 1;
}

/**
 * Nudge's chat panel width on Insights (the theme's studioAiPanelWidth), in px. 320 leaves the
 * three value tiles side by side at 1280px with room to spare for a classic 15px scrollbar (at
 * 340 they had 2px to spare, and "Overdue tabs" dropped to its own row).
 */
export const NUDGE_PANEL_WIDTH = 320;
/** The 1px divider Studio draws beside a docked panel (its borderWidth). */
export const PANEL_DIVIDER = 1;

/**
 * Width of Studio's canvas, at most. Our own box around Studio is laid out by our CSS, so its
 * width is right even in a hidden tab; with Nudge docked beside the dashboard (laptops) the panel
 * and divider come off it. Studio's own measured canvas, when there is one, can only lower that:
 * it reads too wide before Studio has laid out (a hidden tab gets no resize events to correct
 * it), but is the only way to see a panel dragged wider.
 */
export function studioCanvasWidth(boxWidth: number, nudgeDocked: boolean, measuredCanvas: number | null): number {
  const bound = boxWidth - (nudgeDocked ? NUDGE_PANEL_WIDTH + PANEL_DIVIDER : 0);
  return measuredCanvas === null ? bound : Math.min(measuredCanvas, bound);
}

// The "Every tab" grid. Studio gives every grid column one width (no per-column width or flex).
// Its cells are padded by Studio's 8px spacing a side, so a 96px column leaves 80px for a value;
// "RM 1,250.00" is about 69px in Studio's 13px Manrope.
export const TABS_COLUMN_WIDTH = 96;
/** Studio's own grid cell padding, each side (its 8px spacing). */
export const GRID_CELL_PADDING = 8;
/**
 * Column widths (and cell padding a side) the three-column grid may use, widest first. Coarse
 * steps, so dragging a window or Nudge's divider only changes the grid (and remounts Studio) at a
 * few points. Each leaves at least 69px for "RM 1,250.00": the last one, for a laptop at 1024px
 * with Nudge docked (251px of room), trims the cell padding to 4px to fit 3 x 78 + 16 = 250px.
 * With even less room the grid scrolls sideways rather than cut amounts.
 */
export const TABS_NARROW_STEPS = [
  { columnWidth: TABS_COLUMN_WIDTH, cellPadding: GRID_CELL_PADDING },
  { columnWidth: 90, cellPadding: GRID_CELL_PADDING },
  { columnWidth: 85, cellPadding: GRID_CELL_PADDING },
  { columnWidth: 78, cellPadding: 4 },
] as const;
/** Room kept for the grid's own vertical scrollbar where the system draws one. */
export const GRID_SCROLLBAR = 16;

export type TabsGrid = { columns: 3 | 5; columnWidth: number; cellPadding: number };

/** Width of the "Every tab" tile on a Studio canvas this wide, by Studio's own track sums. */
export function tabsTileWidth(canvasWidth: number, kind: LayoutKind): number {
  // Moving the value tiles only shifts this tile down, never sideways.
  const [x, , w] = (kind === "phone" ? PHONE : WIDE).tabs;
  return tileWidth(canvasWidth, x, w);
}

/** Room inside the "Every tab" tile for the grid itself. */
export function tabsGridRoom(canvasWidth: number, kind: LayoutKind): number {
  return tabsTileWidth(canvasWidth, kind) - 2 * WIDGET_PADDING;
}

/** Columns wider than 96px grow in steps this size, so the grid fills its tile but a window drag only remounts Studio every few px. */
export const TABS_FILL_STEP = 8;

/** The widest column, in TABS_FILL_STEP steps, that lets `columns` columns fill `room`, never under 96px. */
function fillWidth(room: number, columns: number): number {
  return Math.max(TABS_COLUMN_WIDTH, Math.floor(room / columns / TABS_FILL_STEP) * TABS_FILL_STEP);
}

/**
 * How many columns the "Every tab" grid shows and how wide: all five when they fit at 96px
 * beside a scrollbar, otherwise customer, amount and days late at the widest step that fits.
 * With room to spare the columns grow to fill the tile (Studio gives every column one width),
 * instead of leaving the right of the card empty.
 */
export function tabsGridFor(canvasWidth: number, kind: LayoutKind): TabsGrid {
  const room = tabsGridRoom(canvasWidth, kind) - GRID_SCROLLBAR;
  if (room >= 5 * TABS_COLUMN_WIDTH) return { columns: 5, columnWidth: fillWidth(room, 5), cellPadding: GRID_CELL_PADDING };
  const step = TABS_NARROW_STEPS.find(({ columnWidth }) => 3 * columnWidth <= room);
  if (step?.columnWidth === TABS_COLUMN_WIDTH) return { columns: 3, columnWidth: fillWidth(room, 3), cellPadding: GRID_CELL_PADDING };
  return { columns: 3, ...(step ?? TABS_NARROW_STEPS[TABS_NARROW_STEPS.length - 1]) };
}
