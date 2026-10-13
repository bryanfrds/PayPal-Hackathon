// Where each Insights tile sits: one layout for phones, one for wider screens.
// No AG Studio imports, so it can be tested in Node.

export type WidgetId =
  "owed" | "collected" | "overdue" | "board" | "trend" | "late" | "tabs";

type Box = [x: number, y: number, w: number, h: number];
type Layout = Record<WidgetId, Box>;

export const COLUMNS = 12;
export const ROW_HEIGHT = 16;
export const PAGE_PADDING = 8;
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
  late: [0, 26, 5, 16],
  tabs: [5, 26, 7, 16],
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
