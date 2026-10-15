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

// The "Every tab" grid. Studio gives every grid column one width (no per-column width or flex).
// Its cells are padded by Studio's 8px spacing a side, so a 96px column leaves 80px for a value;
// "RM 1,250.00" is about 69px in Studio's 13px Manrope.
export const TABS_COLUMN_WIDTH = 96;
/** Narrowest column still shown; below it the grid scrolls sideways rather than shrink further. */
export const TABS_MIN_COLUMN_WIDTH = 72;
/** Room kept for the grid's own vertical scrollbar where the system draws one. */
export const GRID_SCROLLBAR = 16;

export type TabsGrid = { columns: 3 | 5; columnWidth: number };

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
 * beside a scrollbar, otherwise customer, amount and days late, narrowed only if 96px won't fit.
 */
export function tabsGridFor(canvasWidth: number, kind: LayoutKind): TabsGrid {
  const room = tabsGridRoom(canvasWidth, kind) - GRID_SCROLLBAR;
  if (room >= 5 * TABS_COLUMN_WIDTH) return { columns: 5, columnWidth: TABS_COLUMN_WIDTH };
  const fitted = Math.floor(room / 3);
  return { columns: 3, columnWidth: Math.max(TABS_MIN_COLUMN_WIDTH, Math.min(TABS_COLUMN_WIDTH, fitted)) };
}
