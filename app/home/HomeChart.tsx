"use client";

// Home's month chart on a laptop: the same AG Studio chart as Insights, in a single tile.

import { useMemo } from "react";
import { todayLocal, type Debt } from "@/lib/debts";
import { toInsightRows } from "@/lib/insights";
import { AgStudio, FILL, VIEW_PANELS, manropeFamily } from "../insights/studio-loader";
import { HOME_CHART_ROWS, dataFor, homeChartState, themeFor, widgets } from "../insights/studio-config";
import { ROW_HEIGHT } from "../insights/tiles";

export default function HomeChart({ debts }: { debts: Debt[] }) {
  const today = todayLocal();
  const data = useMemo(() => dataFor(toInsightRows(debts, today)), [debts, today]);
  const initialState = useMemo(() => homeChartState(), []);
  const theme = useMemo(() => themeFor(manropeFamily(), "#ffffff"), []);
  // Studio reads data once, so it's remounted when any tab changes.
  const version = useMemo(() => debts.map((d) => [d.id, d.amountSen, d.date, d.status].join(":")).join("|"), [debts]);
  return (
    <div className="home-studio" style={{ height: HOME_CHART_ROWS * ROW_HEIGHT }}>
      <AgStudio
        key={`${today}-${version}`}
        data={data}
        mode="view"
        theme={theme}
        widgets={widgets}
        panels={VIEW_PANELS}
        style={FILL}
        initialState={initialState}
      />
    </div>
  );
}
