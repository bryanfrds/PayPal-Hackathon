// Fetches the scoreboard's rows from AG Studio's data engine. Kept apart from the React
// component so it can be tested with a stub widget API.

import type { AgWidgetApi, AgWidgetField } from "ag-studio";
import { rankOwed, type ScoreRow } from "@/lib/insights";

type DataApi = Pick<AgWidgetApi, "getData">;

/**
 * Owed total per customer, biggest first. Page filters and cross-filters (clicking a bar in
 * another widget) apply, because the request asks for the filtered dataset.
 */
export async function fetchScoreRows(
  api: DataApi,
  customer: AgWidgetField,
  owed: AgWidgetField,
  signal?: AbortSignal,
): Promise<ScoreRow[]> {
  const response = await api.getData(
    { fields: [customer, owed] },
    { crossFilter: "filter", signal },
  );
  return rankOwed(
    response.results.rows.map((row) => ({
      customer: String(row[customer.key] ?? ""),
      owed: Number(row[owed.key] ?? 0),
    })),
  );
}
