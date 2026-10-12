import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import {
  customerSlug,
  customerTab,
  daysBetween,
  DEFAULT_CREDIT_LIMIT_SEN,
  dueDateFor,
  formatDay,
  formatMonth,
  groupBills,
  payableSen,
  toggleBill,
} from "./customer-tab";

let n = 0;
function debt(customerName: string, date: string, amountSen: number, status: Debt["status"]): Debt {
  n += 1;
  return { id: `T-${n}`, customerName, item: `item ${n}`, amountSen, date, status, source: "manual", createdAt: `${date}T09:00:00.000Z` };
}

const TODAY = "2026-10-12";

describe("customerSlug", () => {
  it.each([
    ["Kak Lina", "kak-lina"],
    ["Pak Ali (Bengkel)", "pak-ali-bengkel"],
    ["Mr. Raj", "mr-raj"],
    ["  Ah   Hock ", "ah-hock"],
    ["Café Zoë", "cafe-zoe"],
  ])("%j → %s", (name, slug) => {
    expect(customerSlug(name)).toBe(slug);
  });
});

describe("dueDateFor", () => {
  it("is the 10th of the next month", () => {
    expect(dueDateFor("2026-09")).toBe("2026-10-10");
  });
  it("rolls over the year", () => {
    expect(dueDateFor("2026-12")).toBe("2027-01-10");
  });
});

describe("groupBills", () => {
  it("makes one bill per month with paid and unpaid sums", () => {
    const { toPay, paid } = groupBills(
      [
        debt("A", "2026-10-06", 480, "unpaid"),
        debt("A", "2026-10-01", 1000, "paid"),
        debt("A", "2026-08-03", 1990, "paid"),
      ],
      TODAY,
    );
    expect(toPay).toHaveLength(1);
    expect(toPay[0]).toMatchObject({ month: "2026-10", dueDate: "2026-11-10", status: "due", totalSen: 1480, unpaidSen: 480, paidSen: 1000 });
    expect(toPay[0].debts.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-06"]);
    expect(paid.map((b) => b.month)).toEqual(["2026-08"]);
  });

  it("marks an unpaid bill overdue once its due date has passed", () => {
    const { toPay } = groupBills([debt("A", "2026-09-28", 2240, "sent")], TODAY);
    expect(toPay[0]).toMatchObject({ dueDate: "2026-10-10", status: "overdue" });
  });

  it("is not overdue on the due date itself", () => {
    const { toPay } = groupBills([debt("A", "2026-09-28", 2240, "sent")], "2026-10-10");
    expect(toPay[0].status).toBe("due");
  });

  it("marks a bill overdue when the ledger already says a debt is overdue", () => {
    const { toPay } = groupBills([debt("A", "2026-10-02", 500, "overdue")], TODAY);
    expect(toPay[0].status).toBe("overdue");
  });

  it("orders unpaid bills oldest first and paid bills newest first", () => {
    const { toPay, paid } = groupBills(
      [
        debt("A", "2026-10-01", 100, "unpaid"),
        debt("A", "2026-08-01", 100, "unpaid"),
        debt("A", "2026-06-01", 100, "paid"),
        debt("A", "2026-07-01", 100, "paid"),
      ],
      TODAY,
    );
    expect(toPay.map((b) => b.month)).toEqual(["2026-08", "2026-10"]);
    expect(paid.map((b) => b.month)).toEqual(["2026-07", "2026-06"]);
  });
});

describe("customerTab", () => {
  const debts = [
    debt("Kak Lina", "2026-09-28", 2240, "sent"),
    debt("Kak Lina", "2026-10-06", 480, "unpaid"),
    debt("Kak Lina", "2026-08-01", 3150, "paid"),
    debt("Uncle Tan", "2026-10-05", 1780, "unpaid"),
  ];

  it("only includes the matching customer", () => {
    const tab = customerTab(debts, "kak-lina", TODAY)!;
    expect(tab.customerName).toBe("Kak Lina");
    expect(tab.history).toHaveLength(3);
    expect(tab.history.map((d) => d.date)).toEqual(["2026-10-06", "2026-09-28", "2026-08-01"]);
  });

  it("works out what's owed and what's left of the limit", () => {
    const tab = customerTab(debts, "kak-lina", TODAY)!;
    expect(tab.owedSen).toBe(2720);
    expect(tab.limitSen).toBe(DEFAULT_CREDIT_LIMIT_SEN);
    expect(tab.leftSen).toBe(DEFAULT_CREDIT_LIMIT_SEN - 2720);
  });

  it("never shows a negative amount left", () => {
    const tab = customerTab([debt("Big", "2026-10-01", DEFAULT_CREDIT_LIMIT_SEN + 1, "unpaid")], "big", TODAY)!;
    expect(tab.leftSen).toBe(0);
  });

  it("is null for an unknown link", () => {
    expect(customerTab(debts, "nobody", TODAY)).toBeNull();
  });
});

describe("toggleBill and payableSen", () => {
  const { toPay } = groupBills(
    [debt("A", "2026-07-01", 1800, "unpaid"), debt("A", "2026-09-01", 2240, "unpaid"), debt("A", "2026-10-01", 480, "unpaid")],
    TODAY,
  );

  it("ticking a newer bill ticks every older one", () => {
    expect(toggleBill(0, 2)).toBe(3);
  });

  it("unticking a bill unticks every newer one", () => {
    expect(toggleBill(3, 1)).toBe(1);
    expect(toggleBill(3, 0)).toBe(0);
  });

  it("adds up the ticked bills", () => {
    expect(payableSen(toPay, 0)).toBe(0);
    expect(payableSen(toPay, 2)).toBe(4040);
    expect(payableSen(toPay, 3)).toBe(4520);
  });
});

describe("dates", () => {
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-12", "2026-10-15")).toBe(3);
    expect(daysBetween("2026-10-12", "2026-10-10")).toBe(-2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("formats days and months", () => {
    expect(formatDay("2026-10-05")).toBe("5 Oct 2026");
    expect(formatMonth("2026-10", 2026)).toBe("October");
    expect(formatMonth("2025-12", 2026)).toBe("December 2025");
  });
});
