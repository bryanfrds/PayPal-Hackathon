import { describe, expect, it, vi } from "vitest";
import type { AgWidgetField } from "ag-studio";
import { fetchScoreRows } from "./scoreboard-data";

const customer = { key: "c" } as AgWidgetField;
const owed = { key: "o" } as AgWidgetField;

function stubApi(rows: Record<string, unknown>[]) {
  return { getData: vi.fn().mockResolvedValue({ results: { rows } }) };
}

describe("fetchScoreRows", () => {
  it("asks for the cross-filtered data and passes the abort signal on", async () => {
    const api = stubApi([]);
    const signal = new AbortController().signal;
    await fetchScoreRows(api, customer, owed, signal);
    expect(api.getData).toHaveBeenCalledWith(
      { fields: [customer, owed] },
      { crossFilter: "filter", signal },
    );
  });

  it("reads rows by each field's key and ranks them biggest first", async () => {
    const api = stubApi([
      { c: "Ah Seng", o: 39.9 },
      { c: "Abang Din", o: 0 },
      { c: "Mak Cik Siti", o: 48.5 },
    ]);
    const rows = await fetchScoreRows(api, customer, owed);
    expect(rows).toEqual([
      { customer: "Mak Cik Siti", owed: 48.5 },
      { customer: "Ah Seng", owed: 39.9 },
    ]);
  });

  it("treats a missing total as nothing owed", async () => {
    const rows = await fetchScoreRows(
      stubApi([{ c: "Nurul" }]),
      customer,
      owed,
    );
    expect(rows).toEqual([]);
  });
});
