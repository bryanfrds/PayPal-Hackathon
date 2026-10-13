// AG Studio setup for Insights: data fields, our Soft Premium theme, the custom scoreboard
// widget and the starting dashboard. Kept out of the component so every object keeps one
// reference (Studio treats a new reference as a change).

import {
  studioTheme,
  type AgDataSourcesDefinition,
  type AgDefaultWidgetDefinition,
  type AgFieldDefinition,
  type AgReportState,
  type AgWidgetFieldReference,
} from "ag-studio";
import {
  createWidgets,
  type AgRegistry,
  type AgWidgetDefinition,
} from "ag-studio-react";
import { monthLabel, type InsightRow } from "@/lib/insights";
import Scoreboard, { type ScoreboardWidget } from "./Scoreboard";
type ScoreboardDefinition = AgWidgetDefinition<"scoreboard", ScoreboardWidget>;

export interface BukuRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | ScoreboardDefinition)[];
}

const ringgit = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

const TABS_FIELDS: AgFieldDefinition<BukuRegistry>[] = [
  { id: "customer", name: "Customer", format: "textFormat" },
  { id: "item", name: "Item", format: "textFormat" },
  // Stored as "2026-08" so months sort in order; shown as "Aug 2026".
  {
    id: "month",
    name: "Month",
    format: "textFormat",
    createValueFormatter: () => (value) =>
      value == null ? "" : monthLabel(String(value)),
  },
  { id: "status", name: "Status", format: "textFormat" },
  { id: "lateBucket", name: "How late", format: "textFormat" },
  {
    id: "amount",
    name: "Amount",
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  {
    id: "owed",
    name: "Still owed",
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  {
    id: "collected",
    name: "Collected",
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  { id: "daysLate", name: "Days late", format: "integerFormat" },
  { id: "overdue", name: "Overdue tabs", format: "integerFormat" },
];

export function dataFor(
  rows: InsightRow[],
): AgDataSourcesDefinition<BukuRegistry> {
  return {
    sources: [{ id: "tabs", name: "Tabs", data: rows, fields: TABS_FIELDS }],
  };
}

const SCOREBOARD: ScoreboardDefinition = {
  id: "scoreboard",
  label: "Who owes you",
  icon: "leaderboard",
  dataMapping: {
    customer: {
      type: "field",
      supportedRoles: ["category"],
      requires: { cardinality: "one" },
      required: true,
    },
    owed: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { cardinality: "one" },
      required: true,
    },
  },
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "customer", label: "Customer" },
        { key: "owed", label: "Amount owed" },
      ],
    }),
  comp: Scoreboard,
  defaultSize: { width: 360, height: 300 },
  minSize: { width: 240, height: 160 },
};

export const widgets = createWidgets<BukuRegistry>({
  additionalTypes: [SCOREBOARD],
  menu: [{ label: "555 Buku", widgetIds: ["scoreboard"] }],
} as never);

// Soft Premium: warm paper canvas, white rounded tiles, ink accents (see globals.css).
// Takes the font family next/font gave Manrope, since Studio can't read our CSS variable.
export const themeFor = (fontFamily: string) =>
  studioTheme.withParams({
    fontFamily,
    // Titles, charts and grids read this one, not fontFamily.
    studioCanvasFontFamily: fontFamily,
    // No frame or inner scroll: the dashboard sits straight on the page.
    studioWrapperBorder: false,
    studioWrapperSpacing: 0,
    studioWrapperBackgroundColor: "#f3f1ec",
    studioCanvasShadow: "none",
    studioWidgetBorder: false,
    studioWidgetTitleFontSize: 13,
    foregroundColor: "#141414",
    textColor: "#141414",
    accentColor: "#141414",
    backgroundColor: "#ffffff",
    borderColor: "#ebe7df",
    studioCanvasBackgroundColor: "#f3f1ec",
    studioWidgetBackgroundColor: "#ffffff",
    studioWidgetBorderRadius: 20,
    studioWidgetTitleFontWeight: 800,
    studioWidgetPadding: 10,
    studioWidgetTitleTextColor: "#6f6b64",
    chartPaletteFills1Color: "#141414",
    chartPaletteFills2Color: "#d8d3c8",
    chartPaletteFills3Color: "#c23b22",
    chartPaletteFills4Color: "#2f55c4",
    chartPaletteFills5Color: "#8c6512",
    chartPaletteFills6Color: "#2b7a46",
  });

const f = (
  id: string,
  aggregation?: AgWidgetFieldReference["aggregation"],
): AgWidgetFieldReference =>
  aggregation ? { id: `tabs.${id}`, aggregation } : { id: `tabs.${id}` };
const title = (text: string) => ({ title: { enabled: true, text } });
const kpi = (text: string) => ({
  ...title(text),
  style: {
    typography: { fontSize: 28, fontWeight: 800 },
    textAlign: "left",
    verticalAlign: "top",
  },
});
const legend = {
  style: {
    theme: { common: { legend: { enabled: true, position: "bottom" } } },
  },
};

const WIDGETS = {
  owed: {
    type: "value",
    dataMapping: { value: [f("owed", "sum")] },
    format: kpi("Still owed to you"),
  },
  collected: {
    type: "value",
    dataMapping: { value: [f("collected", "sum")] },
    format: kpi("Collected"),
  },
  overdue: {
    type: "value",
    dataMapping: { value: [f("overdue", "sum")] },
    format: kpi("Overdue tabs"),
  },
  board: {
    type: "scoreboard",
    dataMapping: { customer: [f("customer")], owed: [f("owed", "sum")] },
    format: title("Who owes you"),
  },
  trend: {
    type: "column-chart-grouped",
    dataMapping: {
      categoryKey: [f("month")],
      valueKey: [f("collected", "sum"), f("owed", "sum")],
    },
    sort: [{ field: f("month"), direction: "asc" }],
    format: { ...title("Owed vs collected"), ...legend },
  },
  late: {
    type: "bar-chart-grouped",
    dataMapping: {
      categoryKey: [f("lateBucket")],
      valueKey: [f("owed", "sum")],
    },
    format: title("How late are the tabs"),
  },
  tabs: {
    type: "grid",
    dataMapping: {
      cols: [f("customer"), f("item"), f("status"), f("amount"), f("daysLate")],
    },
    format: title("Every tab"),
  },
} as const;

type Box = [x: number, y: number, w: number, h: number];
type Layout = Record<keyof typeof WIDGETS, Box>;

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

export const PHONE_MAX = 640;

const ROW_HEIGHT = 16;
const PAGE_PADDING = 8;

/** Studio fills its parent, so the parent gets the height of the tallest column of tiles. */
export function canvasHeight(width: number): number {
  const layout = width <= PHONE_MAX ? PHONE : WIDE;
  const rows = Math.max(...Object.values(layout).map(([, y, , h]) => y + h));
  return rows * ROW_HEIGHT + PAGE_PADDING * 2;
}

export function initialStateFor(width: number): AgReportState<BukuRegistry> {
  const layout = width <= PHONE_MAX ? PHONE : WIDE;
  const widgetLayout = Object.fromEntries(
    Object.entries(layout).map(([id, [xTrack, yTrack, xSpan, ySpan]]) => [
      id,
      { xTrack, yTrack, xSpan, ySpan },
    ]),
  );
  return {
    selectedPageId: "insights",
    pages: [
      {
        id: "insights",
        widgets: WIDGETS,
        widgetLayout,
        layout: {
          columns: 12,
          minWidth: 300,
          rowHeight: ROW_HEIGHT,
          pagePadding: PAGE_PADDING,
        },
      },
    ],
  } as unknown as AgReportState<BukuRegistry>;
}
