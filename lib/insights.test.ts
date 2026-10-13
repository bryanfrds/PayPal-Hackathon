import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { lateBucket, monthLabel, rankOwed, toInsightRows } from "./insights";

function debt(over: Partial<Debt>): Debt {
  return {
    id: "T-1",
    customerName: "Mak Cik Siti",
    item: "Beras 10kg",
    amountSen: 4850,
    date: "2026-08-02",
    status: "overdue",
    source: "manual",
    createdAt: "2026-08-02T09:00:00.000Z",
    ...over,
  };
}

describe("toInsightRows", () => {
  it("splits an unpaid debt into owed, in ringgit", () => {
    const [row] = toInsightRows([debt({})], "2026-10-13");
    expect(row).toMatchObject({
      amount: 48.5,
      owed: 48.5,
      collected: 0,
      month: "2026-08",
      overdue: 1,
    });
  });

  it("counts days late from the 10th of the next month", () => {
    // August's bill is due 10 Sep; 13 Oct is 33 days after.
    const [row] = toInsightRows([debt({})], "2026-10-13");
    expect(row.daysLate).toBe(33);
    expect(row.lateBucket).toBe("31+ days late");
  });

  it("is not late before the due date", () => {
    const [row] = toInsightRows(
      [debt({ date: "2026-10-01", status: "unpaid" })],
      "2026-10-13",
    );
    expect(row).toMatchObject({
      daysLate: 0,
      lateBucket: "Not due yet",
      overdue: 0,
    });
  });

  it("counts an invoiced tab past its due date as overdue", () => {
    // Sent on 28 Sep, due 10 Oct: three days late on the 13th, even though no one marked it overdue.
    const [row] = toInsightRows(
      [debt({ date: "2026-09-28", status: "sent" })],
      "2026-10-13",
    );
    expect(row).toMatchObject({
      daysLate: 3,
      lateBucket: "1–30 days late",
      overdue: 1,
    });
  });

  it("moves a paid debt to collected", () => {
    const [row] = toInsightRows([debt({ status: "paid" })], "2026-10-13");
    expect(row).toMatchObject({
      owed: 0,
      collected: 48.5,
      daysLate: 0,
      lateBucket: "Paid",
      status: "Paid",
    });
  });

  it("rolls December over to the next year", () => {
    const [row] = toInsightRows(
      [debt({ date: "2025-12-20", status: "unpaid" })],
      "2026-01-11",
    );
    expect(row).toMatchObject({ month: "2025-12", daysLate: 1 });
  });
});

describe("monthLabel", () => {
  it("shows the short month and year", () => {
    expect(monthLabel("2026-08")).toBe("Aug 2026");
    expect(monthLabel("2025-12")).toBe("Dec 2025");
  });

  it("leaves anything unexpected as it is", () => {
    expect(monthLabel("soon")).toBe("soon");
  });
});

describe("lateBucket", () => {
  it("counts a tab marked overdue as late even before the due date", () => {
    expect(lateBucket("overdue", 0)).toBe("1–30 days late");
  });

  it("puts exactly 30 days in the first bucket", () => {
    expect(lateBucket("overdue", 30)).toBe("1–30 days late");
    expect(lateBucket("overdue", 31)).toBe("31+ days late");
  });
});

describe("rankOwed", () => {
  it("puts the biggest balance first and drops people who owe nothing", () => {
    const ranked = rankOwed([
      { customer: "Ah Seng", owed: 39.9 },
      { customer: "Abang Din", owed: 0 },
      { customer: "Mak Cik Siti", owed: 48.5 },
    ]);
    expect(ranked.map((r) => r.customer)).toEqual(["Mak Cik Siti", "Ah Seng"]);
  });
});
