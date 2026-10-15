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

export type WidgetBox = {
  xTrack: number;
  yTrack: number;
  xSpan: number;
  ySpan: number;
};

/** Studio's widgetLayout for the given layout. */
export function widgetLayout(kind: LayoutKind): Record<WidgetId, WidgetBox> {
  const layout = kind === "phone" ? PHONE : WIDE;
  return Object.fromEntries(
    Object.entries(layout).map(([id, [xTrack, yTrack, xSpan, ySpan]]) => [
      id,
      { xTrack, yTrack, xSpan, ySpan },
    ]),
  ) as Record<WidgetId, WidgetBox>;
}

/** Studio fills its parent, so the parent gets the height of the tallest column of tiles. */
export function canvasHeight(kind: LayoutKind): number {
  const layout = kind === "phone" ? PHONE : WIDE;
  const rows = Math.max(...Object.values(layout).map(([, y, , h]) => y + h));
  return rows * ROW_HEIGHT + PAGE_PADDING * 2;
}

/** Nudge's chat panel width on Insights (the theme's studioAiPanelWidth), in px. */
export const NUDGE_PANEL_WIDTH = 340;
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
  const track = (canvasWidth - 2 * PAGE_PADDING) / COLUMNS;
  const [x, , w] = (kind === "phone" ? PHONE : WIDE).tabs;
  return Math.floor((x + w) * track) - Math.floor(x * track);
}

/** Room inside the "Every tab" tile for the grid itself. */
export function tabsGridRoom(canvasWidth: number, kind: LayoutKind): number {
  return tabsTileWidth(canvasWidth, kind) - 2 * WIDGET_PADDING;
}

/**
 * How many columns the "Every tab" grid shows and how wide: all five at 96px when they fit
 * beside a scrollbar, otherwise customer, amount and days late at the widest step that fits.
 */
export function tabsGridFor(canvasWidth: number, kind: LayoutKind): TabsGrid {
  const room = tabsGridRoom(canvasWidth, kind) - GRID_SCROLLBAR;
  if (room >= 5 * TABS_COLUMN_WIDTH) return { columns: 5, columnWidth: TABS_COLUMN_WIDTH, cellPadding: GRID_CELL_PADDING };
  const step = TABS_NARROW_STEPS.find(({ columnWidth }) => 3 * columnWidth <= room);
  return { columns: 3, ...(step ?? TABS_NARROW_STEPS[TABS_NARROW_STEPS.length - 1]) };
}
