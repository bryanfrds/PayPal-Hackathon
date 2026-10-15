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
import { STATUS_LABEL, type DebtStatus } from "@/lib/debts";
import { languageInfo, translator, type Language, type T, type TKey } from "@/lib/i18n";
import { monthLabel, type InsightRow, type LateBucket } from "@/lib/insights";
import Scoreboard, { type ScoreboardWidget } from "./Scoreboard";
import {
  COLUMNS,
  PAGE_PADDING,
  NUDGE_PANEL_WIDTH,
  ROW_HEIGHT,
  TABS_COLUMN_WIDTH,
  WIDGET_PADDING,
  widgetLayout,
  type LayoutKind,
  type TabsGrid,
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

// The rows keep lib/insights' English values (filters and Studio's agents work on those); the
// words shown for them follow the app's language.
const LATE_KEYS: Record<LateBucket, TKey> = {
  "Not due yet": "insights.late.notDue",
  "1–30 days late": "insights.late.upTo30",
  "31+ days late": "insights.late.over30",
  Paid: "status.paid",
};
const STATUS_KEYS = new Map<string, TKey>(
  (Object.entries(STATUS_LABEL) as [DebtStatus, string][]).map(([status, label]) => [label, `status.${status}`]),
);
const shownAs = (keys: { get(value: string): TKey | undefined }, t: T) => () => (value: unknown) => {
  if (value == null) return "";
  const key = keys.get(String(value));
  return key ? t(key) : String(value);
};
const lateKeys = { get: (value: string) => LATE_KEYS[value as LateBucket] };

/** "2026-08" → "Aug 2026" in English, the short local form elsewhere. */
function monthShown(lang: Language, monthKey: string): string {
  if (lang === "en") return monthLabel(monthKey);
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Intl.DateTimeFormat(languageInfo(lang).locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// Field names are shown as column headers, legends and axis titles, so they follow the app's
// language; the ids (what saved tiles and Studio's agents refer to) never change.
const tabsFields = (t: T, lang: Language): AgFieldDefinition<BukuRegistry>[] => [
  { id: "customer", name: t("insights.field.customer"), format: "textFormat" },
  { id: "item", name: t("insights.field.item"), format: "textFormat" },
  // Stored as "2026-08" so months sort in order; shown as "Aug 2026".
  {
    id: "month",
    name: t("insights.field.month"),
    format: "textFormat",
    createValueFormatter: () => (value) =>
      value == null ? "" : monthShown(lang, String(value)),
  },
  { id: "status", name: t("insights.field.status"), format: "textFormat", createValueFormatter: shownAs(STATUS_KEYS, t) },
  { id: "lateBucket", name: t("insights.field.lateBucket"), format: "textFormat", createValueFormatter: shownAs(lateKeys, t) },
  {
    id: "amount",
    name: t("insights.field.amount"),
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  {
    id: "owed",
    name: t("insights.field.owed"),
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  {
    id: "collected",
    name: t("insights.field.collected"),
    format: "currencyFormat",
    formatOptions: { format: ringgit },
  },
  { id: "daysLate", name: t("insights.field.daysLate"), format: "integerFormat" },
  { id: "overdue", name: t("insights.field.overdue"), format: "integerFormat" },
];

export function dataFor(
  rows: InsightRow[],
  t: T = translator(),
  lang: Language = "en",
): AgDataSourcesDefinition<BukuRegistry> {
  return {
    sources: [{ id: "tabs", name: t("insights.source.tabs"), data: rows, fields: tabsFields(t, lang) }],
  };
}

const scoreboardFor = (t: T): ScoreboardDefinition => ({
  id: "scoreboard",
  label: t("insights.scoreboard.label"),
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
        { key: "customer", label: t("insights.scoreboard.customer") },
        { key: "owed", label: t("insights.scoreboard.owed") },
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
});

// Cast: createWidgets' params type is a conditional type that TypeScript can't resolve for a
// registry declared as an interface; the definition above is typed as ScoreboardDefinition.
/** Studio's widgets plus our scoreboard, labelled in `t`'s language (Studio remounts on a language change). */
export const widgetRegistry = (t: T = translator()) =>
  createWidgets<BukuRegistry>({
    additionalTypes: [scoreboardFor(t)],
    // Studio's own widgets plus ours. Studio's AI agents can only add widgets listed here.
    menu: [..._WIDGET_MENU, { label: "555 Buku", widgetIds: ["scoreboard"] }],
  } as never);

export const widgets = widgetRegistry();

// Soft Premium: warm paper canvas, white rounded tiles, ink accents (see globals.css).
// Takes the font family next/font gave Manrope, since Studio can't read our CSS variable.
// `dark` swaps in the dark palette from globals.css; light values are unchanged.
export const themeFor = (fontFamily: string, canvas = "#f3f1ec", dark = false) => {
  const light = studioTheme.withParams({
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
    studioWidgetPadding: WIDGET_PADDING,
    studioWidgetTitleTextColor: "#6f6b64",
    chartPaletteFills1Color: "#141414",
    chartPaletteFills2Color: "#d8d3c8",
    chartPaletteFills3Color: "#c23b22",
    chartPaletteFills4Color: "#2f55c4",
    chartPaletteFills5Color: "#8c6512",
    chartPaletteFills6Color: "#2b7a46",
    // Nudge's chat panel on Insights.
    studioAiPanelWidth: NUDGE_PANEL_WIDTH,
    // Not studioAiPanelInputMessageBackgroundColor: Studio paints error replies with it too, so
    // the owner's ink bubbles are set in globals.css instead.
    studioAiPanelRichTextAccentBackgroundColor: canvas,
    studioAiPanelButtonHoverBackgroundColor: "#efece6",
  });
  if (!dark) return light;
  return light.withParams({
    browserColorScheme: "dark",
    foregroundColor: "#f2efe9",
    textColor: "#f2efe9",
    accentColor: "#f2efe9",
    backgroundColor: "#1d1d1c",
    borderColor: "#2c2b29",
    studioWidgetBackgroundColor: "#1d1d1c",
    studioWidgetTitleTextColor: "#a39e95",
    chartPaletteFills1Color: "#f2efe9",
    chartPaletteFills2Color: "#4a4843",
    chartPaletteFills3Color: "#ff8a73",
    chartPaletteFills4Color: "#9db4ff",
    chartPaletteFills5Color: "#e8c06a",
    chartPaletteFills6Color: "#7fd19b",
    studioAiPanelButtonHoverBackgroundColor: "#2c2b29",
  });
};

/** The page colour behind Studio on Insights, per theme (globals.css --paper). */
export const STUDIO_CANVAS = { light: "#f3f1ec", dark: "#121212" } as const;
/** The tile colour behind Home's chart, per theme (globals.css --card). */
export const STUDIO_TILE = { light: "#ffffff", dark: "#1d1d1c" } as const;

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

// Tile titles follow the app's language; Studio reads them once per mount (Insights remounts
// Studio when the language changes). The tile ids and layout never change.
const widgetsFor = (t: T, tabs: TabsGrid) => ({
  owed: {
    type: "value",
    dataMapping: { value: [f("owed", "sum")] },
    format: kpi(t("insights.tile.owed")),
  },
  collected: {
    type: "value",
    dataMapping: { value: [f("collected", "sum")] },
    format: kpi(t("insights.tile.collected")),
  },
  overdue: {
    type: "value",
    dataMapping: { value: [f("overdue", "sum")] },
    format: kpi(t("insights.tile.overdue")),
  },
  board: {
    type: "scoreboard",
    dataMapping: { customer: [f("customer")], owed: [f("owed", "sum")] },
    format: title(t("insights.tile.board")),
  },
  trend: {
    type: "column-chart-grouped",
    dataMapping: {
      categoryKey: [f("month")],
      valueKey: [f("collected", "sum"), f("owed", "sum")],
    },
    sort: [{ field: f("month"), direction: "asc" }],
    format: { ...title(t("insights.tile.trend")), ...legend },
  },
  late: {
    type: "bar-chart-grouped",
    dataMapping: {
      categoryKey: [f("lateBucket")],
      valueKey: [f("owed", "sum")],
    },
    format: title(t("insights.tile.late")),
  },
  tabs: {
    type: "grid",
    dataMapping: {
      // Amounts and days late come first. Where all five columns don't fit (tabsGridFor in
      // tiles.ts, from the measured canvas width) the grid drops status and item.
      cols: tabs.columns === 5
        ? [f("customer"), f("amount"), f("daysLate"), f("status"), f("item")]
        : [f("customer"), f("amount"), f("daysLate")],
    },
    // Studio's auto-size (on unless turned off) came out header-wide and cut amounts off
    // ("RM 48…"), so every column gets one fixed width (Studio has no per-column width or flex).
    // The width and column count are picked to fit the tile; see tabsGridFor.
    // Headers come from t() and run long in some languages, so they wrap rather than get cut.
    format: {
      ...title(t("insights.tile.tabs")),
      style: { columnAutoSize: false, columnWidth: tabs.columnWidth, headerRow: { wrapText: true } },
    },
  },
}) as const satisfies Record<WidgetId, unknown>;

/** Insights' starting dashboard; `tabs` sizes the "Every tab" grid for the tile it gets. */
export function initialStateFor(kind: LayoutKind, tabs: TabsGrid, t: T = translator()): AgReportState<BukuRegistry> {
  // Cast: AgReportState's widget union is keyed by the registry's widget ids and can't check
  // our "scoreboard" widget state. The shapes were checked against AG Studio's .d.ts files.
  return {
    selectedPageId: "insights",
    pages: [
      {
        id: "insights",
        widgets: widgetsFor(t, tabs),
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
export function homeChartState(t: T = translator()): AgReportState<BukuRegistry> {
  // Only the trend chart is used here, so the grid's sizing doesn't matter.
  const trend = widgetsFor(t, { columns: 5, columnWidth: TABS_COLUMN_WIDTH }).trend;
  // Cast: see initialStateFor.
  return {
    selectedPageId: "home",
    pages: [
      {
        id: "home",
        widgets: { trend: { ...trend, format: { ...trend.format, title: { enabled: false } } } },
        widgetLayout: { trend: { xTrack: 0, yTrack: 0, xSpan: COLUMNS, ySpan: HOME_CHART_ROWS } },
        layout: { columns: COLUMNS, minWidth: 200, rowHeight: ROW_HEIGHT, pagePadding: 0 },
      },
    ],
  } as unknown as AgReportState<BukuRegistry>;
}
