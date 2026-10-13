import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { colourIndex, customerSummaries, greeting, initials, summariseHome } from "./home";

function debt(amountSen: number, status: Debt["status"]): Debt {
  return {
    id: `T-${amountSen}-${status}`,
    customerName: "Test",
    item: "",
    amountSen,
    date: "2026-10-01",
    status,
    source: "manual",
    createdAt: "2026-10-01T09:00:00.000Z",
  };
}

describe("summariseHome", () => {
  it("is all zeros with no debts", () => {
    expect(summariseHome([])).toEqual({ owedSen: 0, openCount: 0, overdueCount: 0, paidSen: 0, collectedPct: 0 });
  });

  it("is 100% collected when everything is paid", () => {
    const s = summariseHome([debt(1000, "paid"), debt(500, "paid")]);
    expect(s).toMatchObject({ owedSen: 0, openCount: 0, paidSen: 1500, collectedPct: 100 });
  });

  it("adds up owed, overdue and paid separately", () => {
    const s = summariseHome([debt(4850, "overdue"), debt(2240, "sent"), debt(500, "unpaid"), debt(1200, "paid")]);
    expect(s).toEqual({ owedSen: 7590, openCount: 3, overdueCount: 1, paidSen: 1200, collectedPct: 14 });
  });

  it("rounds the collected share", () => {
    // 1 of 3 sen paid = 33.33…%
    expect(summariseHome([debt(1, "paid"), debt(2, "unpaid")]).collectedPct).toBe(33);
  });
});

describe("initials", () => {
  it.each([
    ["Mak Cik Siti", "MS"],
    ["Pak Ali (Bengkel)", "PA"],
    ["Nurul", "N"],
    ["mr. raj", "MR"],
    ["  Ah   Hock  ", "AH"],
    ["", "?"],
    ["(Bengkel)", "?"],
  ])("%j → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("greeting", () => {
  it.each([
    [0, "Selamat pagi"],
    [11, "Selamat pagi"],
    [12, "Selamat petang"],
    [18, "Selamat petang"],
    [19, "Selamat malam"],
    [23, "Selamat malam"],
  ])("hour %i → %s", (hour, expected) => {
    expect(greeting(hour)).toBe(expected);
  });
});

describe("colourIndex", () => {
  it("is stable and inside the palette", () => {
    const i = colourIndex("Mak Cik Siti", 6);
    expect(colourIndex("Mak Cik Siti", 6)).toBe(i);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(6);
    expect(colourIndex("", 6)).toBe(0);
  });
});

describe("customerSummaries", () => {
  function d(customerName: string, amountSen: number, date: string, status: Debt["status"]): Debt {
    return { id: `${customerName}-${date}-${amountSen}`, customerName, item: "", amountSen, date, status, source: "manual", createdAt: `${date}T00:00:00.000Z` };
  }

  it("groups a customer's unpaid debts into one row and skips paid ones", () => {
    const rows = customerSummaries([
      d("Kak Lina", 2240, "2026-09-28", "sent"),
      d("kak  lina", 480, "2026-10-06", "unpaid"),
      d("Kak Lina", 1990, "2026-08-03", "paid"),
    ]);
    expect(rows).toEqual([{ customerName: "Kak Lina", owedSen: 2720, count: 2, since: "2026-09-28", status: "sent" }]);
  });

  it("takes the most urgent status and puts overdue customers first, oldest first", () => {
    const rows = customerSummaries([
      d("Uncle Tan", 1780, "2026-10-05", "unpaid"),
      d("Ah Seng", 3990, "2026-09-04", "overdue"),
      d("Mak Cik Siti", 4850, "2026-08-02", "overdue"),
      d("Uncle Tan", 500, "2026-10-01", "overdue"),
    ]);
    expect(rows.map((r) => [r.customerName, r.status])).toEqual([
      ["Mak Cik Siti", "overdue"],
      ["Ah Seng", "overdue"],
      ["Uncle Tan", "overdue"],
    ]);
    expect(rows[2]).toMatchObject({ owedSen: 2280, count: 2, since: "2026-10-01" });
  });

  it("is empty when everything is paid", () => {
    expect(customerSummaries([d("A", 100, "2026-10-01", "paid")])).toEqual([]);
  });
});
