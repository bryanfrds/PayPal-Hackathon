import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { colourIndex, greeting, initials, summariseHome } from "./home";

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
