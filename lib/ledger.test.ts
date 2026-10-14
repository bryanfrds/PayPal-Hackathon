import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { filterByStatus, ledgerTotals } from "./ledger";

const d = (id: string, status: Debt["status"], amountSen: number): Debt => ({
  id,
  customerName: "X",
  item: "",
  amountSen,
  date: "2026-10-01",
  status,
  source: "manual",
  createdAt: "2026-10-01T00:00:00.000Z",
});

const DEBTS = [d("a", "overdue", 1000), d("b", "overdue", 500), d("c", "sent", 200), d("d", "unpaid", 300), d("e", "paid", 900)];

describe("ledgerTotals", () => {
  it("counts and sums each status, and leaves paid out of what's owed", () => {
    expect(ledgerTotals(DEBTS)).toEqual({
      counts: { all: 5, overdue: 2, sent: 1, unpaid: 1, paid: 1 },
      sen: { overdue: 1500, sent: 200, unpaid: 300, paid: 900 },
      owedSen: 2000,
    });
  });

  it("is all zeros with no tabs", () => {
    expect(ledgerTotals([]).owedSen).toBe(0);
  });
});

describe("filterByStatus", () => {
  it("keeps everything for All and only one status otherwise", () => {
    expect(filterByStatus(DEBTS, "all")).toHaveLength(5);
    expect(filterByStatus(DEBTS, "overdue").map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterByStatus(DEBTS, "paid").map((x) => x.id)).toEqual(["e"]);
  });
});
