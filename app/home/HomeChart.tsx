"use client";

// Home's month chart on a laptop: the same AG Studio chart as Insights, in a single tile.

import { useMemo } from "react";
import { todayLocal, type Debt } from "@/lib/debts";
import { toInsightRows } from "@/lib/insights";
import { AgStudio, FILL, VIEW_PANELS, manropeFamily } from "../insights/studio-loader";
import { HOME_CHART_ROWS, STUDIO_TILE, dataFor, homeChartState, themeFor, widgetRegistry } from "../insights/studio-config";
import { ROW_HEIGHT } from "../insights/tiles";
import { useResolvedTheme } from "../usePrefs";
import { useT } from "../useT";

export default function HomeChart({ debts }: { debts: Debt[] }) {
  const today = todayLocal();
  const { t, lang } = useT();
  const data = useMemo(() => dataFor(toInsightRows(debts, today), t, lang), [debts, today, t, lang]);
  const initialState = useMemo(() => homeChartState(t), [t]);
  const localWidgets = useMemo(() => widgetRegistry(t), [t]);
  const mode = useResolvedTheme();
  const theme = useMemo(() => themeFor(manropeFamily(), STUDIO_TILE[mode], mode === "dark"), [mode]);
  // Studio reads data once, so it's remounted when any tab changes.
  const version = useMemo(() => debts.map((d) => [d.id, d.amountSen, d.date, d.status].join(":")).join("|"), [debts]);
  return (
    <div className="home-studio" style={{ height: HOME_CHART_ROWS * ROW_HEIGHT }}>
      <AgStudio
        key={`${today}-${version}-${mode}-${lang}`}
        data={data}
        mode="view"
        theme={theme}
        widgets={localWidgets}
        panels={VIEW_PANELS}
        style={FILL}
        initialState={initialState}
      />
    </div>
  );
}
