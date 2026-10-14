import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { colourIndex, customerSummaries, greeting, homeOverview, initials, monthTotals, owedBoard, summariseHome } from "./home";
import { DEFAULT_RULES, buildSchedule } from "./reminders";

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

  it("groups spellings the customer page treats as one (punctuation, accents)", () => {
    const rows = customerSummaries([d("Kak Lina", 2240, "2026-09-28", "sent"), d("Kak Lina.", 480, "2026-10-06", "unpaid"), d("Zoë", 100, "2026-10-01", "unpaid"), d("zoe", 200, "2026-10-02", "unpaid")]);
    expect(rows.map((r) => [r.customerName, r.owedSen])).toEqual([
      ["Kak Lina", 2720],
      ["Zoë", 300],
    ]);
  });

  it("is empty when everything is paid", () => {
    expect(customerSummaries([d("A", 100, "2026-10-01", "paid")])).toEqual([]);
  });
});

describe("Home redesign figures", () => {
  const TODAY = "2026-10-13";
  const d = (over: Partial<Debt>): Debt => ({
    id: Math.random().toString(36).slice(2),
    customerName: "Mak Cik Siti",
    item: "",
    amountSen: 4850,
    date: "2026-08-02",
    status: "overdue",
    source: "manual",
    createdAt: "2026-08-02T09:00:00.000Z",
    ...over,
  });

  it("owedBoard calls a never-invoiced tab past its due date overdue, but not invoiced", () => {
    const [row] = owedBoard([d({ customerName: "Uncle Tan", amountSen: 1780, date: "2026-08-05", status: "unpaid" })], TODAY);
    expect(row).toMatchObject({ status: "overdue", invoiced: false, daysLate: 33 });
  });

  it("owedBoard puts the biggest balance first, with days late and bar lengths", () => {
    const rows = owedBoard(
      [d({}), d({ customerName: "Kak Lina", amountSen: 2240, date: "2026-09-28", status: "sent" }), d({ customerName: "Uncle Tan", amountSen: 1780, date: "2026-10-05", status: "unpaid" })],
      TODAY,
    );
    expect(rows.map((r) => [r.customerName, r.status, r.daysLate, r.sharePct])).toEqual([
      ["Mak Cik Siti", "overdue", 33, 100],
      ["Kak Lina", "overdue", 3, 46],
      ["Uncle Tan", "unpaid", 0, 37],
    ]);
  });

  it("homeOverview counts overdue by date, tabs not invoiced and reminders due", () => {
    const debts = [
      d({}),
      d({ customerName: "Kak Lina", amountSen: 2240, date: "2026-09-28", status: "sent" }),
      d({ customerName: "Uncle Tan", amountSen: 1780, date: "2026-10-05", status: "unpaid" }),
      d({ customerName: "Ah Hock", amountSen: 1200, status: "paid" }),
    ];
    const schedule = buildSchedule(debts, [], DEFAULT_RULES, {}, TODAY);
    const o = homeOverview(debts, schedule, TODAY);
    expect(o).toMatchObject({
      overdueSen: 7090,
      overdueTabs: 2,
      oldestDaysLate: 33,
      customersOwing: 3,
      notInvoiced: { count: 1, sen: 1780, names: ["Uncle Tan"] },
      paidTabs: { count: 1, sen: 1200 },
    });
    // Kak Lina's bill fell due on the 10th, so her first reminder is due today too.
    expect(o.remindNow).toEqual(["Kak Lina", "Mak Cik Siti"]);
    expect(o.overduePct).toBe(Math.round((7090 / (8870 + 1200)) * 100));
  });

  it("monthTotals splits the last four months into owed and collected", () => {
    const totals = monthTotals([d({}), d({ date: "2026-10-01", status: "paid", amountSen: 500 }), d({ date: "2026-05-01" })], TODAY);
    expect(totals.map((t) => [t.label, t.owedSen, t.collectedSen])).toEqual([
      ["Jul", 0, 0],
      ["Aug", 4850, 0],
      ["Sep", 0, 0],
      ["Oct", 0, 500],
    ]);
  });

  it("monthTotals crosses into last year in January", () => {
    expect(monthTotals([], "2026-01-15").map((t) => t.month)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01"]);
  });
});
