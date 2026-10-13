"use client";

import { useEffect, useState } from "react";
import type { AgWidgetFieldReference, AgWidgetParams } from "ag-studio";
import { formatSen } from "@/lib/debts";
import { colourIndex, initials } from "@/lib/home";
import { rankOwed, type ScoreRow } from "@/lib/insights";

// "Who owes you" as a friendly scoreboard, not a collections report: a custom AG Studio widget.
// It asks Studio's data engine for the owed total per customer, so page filters and
// cross-filters from the other widgets apply to it too.

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

export default function Scoreboard({ widgetApi, dataMapping }: Props) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const customerField = dataMapping.customer?.[0];
  const owedField = dataMapping.owed?.[0];

  useEffect(() => {
    if (!customerField || !owedField) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields: [customerField, owedField] })
      .then((response) => {
        if (!live) return;
        const ranked = rankOwed(
          response.results.rows.map((row) => ({
            customer: String(row[customerField.key] ?? ""),
            owed: Number(row[owedField.key] ?? 0),
          })),
        );
        setRows(ranked);
        widgetApi.setDisplayState(ranked.length === 0 ? "noData" : "displayed");
      })
      .catch(() => {
        if (live) widgetApi.setDisplayState("noData");
      });
    return () => {
      live = false;
    };
  }, [widgetApi, customerField, owedField]);

  const top = rows[0]?.owed ?? 0;
  const shown = rows.slice(0, SHOWN);
  const more = rows.length - shown.length;

  return (
    <ol className="scoreboard" aria-label="Who owes you, biggest first">
      {shown.map((row, index) => {
        const [bg, fg] =
          AVATAR_COLOURS[colourIndex(row.customer, AVATAR_COLOURS.length)];
        const sen = Math.round(row.owed * 100);
        return (
          <li key={row.customer} className="score-row">
            <span className="score-rank" aria-hidden="true">
              {index + 1}
            </span>
            <span
              className="score-avatar"
              style={{ background: bg, color: fg }}
              aria-hidden="true"
            >
              {initials(row.customer)}
            </span>
            <span className="score-main">
              <span className="score-name">{row.customer}</span>
              <span className="score-track" aria-hidden="true">
                <span
                  style={{
                    width: `${top > 0 ? Math.max(6, (row.owed / top) * 100) : 0}%`,
                    background: fg,
                  }}
                />
              </span>
            </span>
            <span className="score-amount">RM {formatSen(sen)}</span>
          </li>
        );
      })}
      {more > 0 && <li className="score-more">and {more} more</li>}
    </ol>
  );
}
