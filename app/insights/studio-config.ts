// AG Studio setup for Insights: data fields, our Soft Premium theme, the custom scoreboard
// widget and the starting dashboard. Kept out of the component so every object keeps one
// reference (Studio treats a new reference as a change).

import {
  _WIDGET_MENU,
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
import {
  COLUMNS,
  PAGE_PADDING,
  ROW_HEIGHT,
  widgetLayout,
  type LayoutKind,
  type WidgetId,
} from "./tiles";
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
  // Lets Studio's AI agents (via Nudge) place a scoreboard too.
  ai: {
    description: "A friendly leaderboard of customers by how much they still owe, biggest first, with a bar for each.",
    usage: "Use for \"who owes the most\". Map a customer field and a summed owed amount.",
  },
  defaultSize: { width: 360, height: 300 },
  minSize: { width: 240, height: 160 },
};

// Cast: createWidgets' params type is a conditional type that TypeScript can't resolve for a
// registry declared as an interface; the definition above is typed as ScoreboardDefinition.
export const widgets = createWidgets<BukuRegistry>({
  additionalTypes: [SCOREBOARD],
  // Studio's own widgets plus ours. Studio's AI agents can only add widgets listed here.
  menu: [..._WIDGET_MENU, { label: "555 Buku", widgetIds: ["scoreboard"] }],
} as never);

// Soft Premium: warm paper canvas, white rounded tiles, ink accents (see globals.css).
// Takes the font family next/font gave Manrope, since Studio can't read our CSS variable.
export const themeFor = (fontFamily: string, canvas = "#f3f1ec") =>
  studioTheme.withParams({
    fontFamily,
    // Titles, charts and grids read this one, not fontFamily.
    studioCanvasFontFamily: fontFamily,
    // Studio defaults to at least 600px wide, wider than a phone: the page then zooms out sideways.
    studioMinWidth: 0,
    studioMinHeight: 0,
    // No frame or inner scroll: the dashboard sits straight on the page.
    studioWrapperBorder: false,
    studioWrapperSpacing: 0,
    studioWrapperBackgroundColor: canvas,
    studioCanvasShadow: "none",
    studioWidgetBorder: false,
    studioWidgetTitleFontSize: 13,
    foregroundColor: "#141414",
    textColor: "#141414",
    accentColor: "#141414",
    backgroundColor: "#ffffff",
    borderColor: "#ebe7df",
    studioCanvasBackgroundColor: canvas,
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
    // Nudge's chat panel on Insights.
    studioAiPanelWidth: 340,
    // Not studioAiPanelInputMessageBackgroundColor: Studio paints error replies with it too, so
    // the owner's ink bubbles are set in globals.css instead.
    studioAiPanelRichTextAccentBackgroundColor: canvas,
    studioAiPanelButtonHoverBackgroundColor: "#efece6",
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
      // Amounts and days late come before the long item text, so a narrow tile cuts the items, not the money.
      cols: [f("customer"), f("amount"), f("daysLate"), f("status"), f("item")],
    },
    // Studio's auto-size (on unless turned off) came out header-wide and cut amounts off
    // ("RM 48…"), so every column gets room for its values; the grid scrolls sideways if it must.
    format: { ...title("Every tab"), style: { columnAutoSize: false, columnWidth: 112 } },
  },
} as const satisfies Record<WidgetId, unknown>;

export function initialStateFor(kind: LayoutKind): AgReportState<BukuRegistry> {
  // Cast: AgReportState's widget union is keyed by the registry's widget ids and can't check
  // our "scoreboard" widget state. The shapes were checked against AG Studio's .d.ts files.
  return {
    selectedPageId: "insights",
    pages: [
      {
        id: "insights",
        widgets: WIDGETS,
        widgetLayout: widgetLayout(kind),
        layout: {
          columns: COLUMNS,
          minWidth: 300,
          rowHeight: ROW_HEIGHT,
          pagePadding: PAGE_PADDING,
        },
      },
    ],
  } as unknown as AgReportState<BukuRegistry>;
}

/** Rows of 16px in Home's single-chart tile. */
export const HOME_CHART_ROWS = 13;

/** Home's chart tile: just the owed-vs-collected chart from Insights, filling the tile. */
export function homeChartState(): AgReportState<BukuRegistry> {
  // Cast: see initialStateFor.
  return {
    selectedPageId: "home",
    pages: [
      {
        id: "home",
        widgets: { trend: { ...WIDGETS.trend, format: { ...WIDGETS.trend.format, title: { enabled: false } } } },
        widgetLayout: { trend: { xTrack: 0, yTrack: 0, xSpan: COLUMNS, ySpan: HOME_CHART_ROWS } },
        layout: { columns: COLUMNS, minWidth: 200, rowHeight: ROW_HEIGHT, pagePadding: 0 },
      },
    ],
  } as unknown as AgReportState<BukuRegistry>;
}
