"use client";

import { useEffect, useState } from "react";
import type { AgWidgetFieldReference, AgWidgetParams } from "ag-studio";
import { formatSen } from "@/lib/debts";
import { colourIndex, initials } from "@/lib/home";
import type { ScoreRow } from "@/lib/insights";
import { fetchScoreRows } from "./scoreboard-data";
import { palette } from "../components/palette";
import { useT } from "../useT";

// "Who owes you" as a friendly scoreboard, not a collections report: a custom AG Studio widget.
// It asks Studio's data engine for the owed total per customer, so page filters and
// cross-filters from the other widgets apply to it too. Studio re-renders the widget with a
// new props object whenever filters or data change, so the fetch runs again on each one.

export type ScoreboardMapping = {
  customer: AgWidgetFieldReference[];
  owed: AgWidgetFieldReference[];
};
export type ScoreboardWidget = {
  type: "scoreboard";
  dataMapping: ScoreboardMapping;
};

type Props = AgWidgetParams<ScoreboardWidget>;

// Same pairs as the avatars on Home.
const AVATAR_COLOURS = [
  ["#f6efdc", "#8c6512"],
  ["#efe6f8", "#6b3fa0"],
  ["#e6f3ea", "#2b7a46"],
  ["#e0f2f1", "#1d6f69"],
  ["#e3ecfb", "#2f55c4"],
  ["#ffe9e4", "#c23b22"],
];

const SHOWN = 5;

export default function Scoreboard(props: Props) {
  const { widgetApi, dataMapping } = props;
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const { t } = useT();
  const customerField = dataMapping.customer?.[0];
  const owedField = dataMapping.owed?.[0];

  useEffect(() => {
    if (!customerField || !owedField) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    // A newer refresh aborts this one, so a slow answer can't overwrite a fresh one.
    const controller = new AbortController();
    widgetApi.setDisplayState("loading");
    fetchScoreRows(widgetApi, customerField, owedField, controller.signal)
      .then((ranked) => {
        if (controller.signal.aborted) return;
        setRows(ranked);
        widgetApi.setDisplayState(ranked.length === 0 ? "noData" : "displayed");
      })
      .catch(() => {
        if (!controller.signal.aborted) widgetApi.setDisplayState("noData");
      });
    return () => controller.abort();
    // `props` changes on every Studio refresh (filters, cross-filters, data); our own
    // setRows re-render keeps the same object, so this doesn't loop.
  }, [props, widgetApi, customerField, owedField]);

  const top = rows[0]?.owed ?? 0;
  const shown = rows.slice(0, SHOWN);
  const more = rows.length - shown.length;

  return (
    <ol className="scoreboard" aria-label={t("insights.scoreboardAria")}>
      {shown.map((row, index) => {
        const [bg, fg] =
          AVATAR_COLOURS[colourIndex(row.customer, AVATAR_COLOURS.length)];
        const sen = Math.round(row.owed * 100);
        return (
          <li key={row.customer} className="score-row">
            <span className="score-rank" aria-hidden="true">
              {index + 1}
            </span>
            <span className="score-avatar" {...palette(bg, fg)} aria-hidden="true">
              {initials(row.customer)}
            </span>
            <span className="score-main">
              <span className="score-name">{row.customer}</span>
              <span className="score-track" aria-hidden="true">
                <span
                  data-pal=""
                  style={{
                    ...palette(bg, fg).style,
                    width: `${top > 0 ? Math.max(6, (row.owed / top) * 100) : 0}%`,
                    background: "var(--pal-fg-now)",
                  }}
                />
              </span>
            </span>
            <span className="score-amount">RM {formatSen(sen)}</span>
          </li>
        );
      })}
      {more > 0 && <li className="score-more">{t("insights.scoreMore", { count: more })}</li>}
    </ol>
  );
}
