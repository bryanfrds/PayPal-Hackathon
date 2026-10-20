import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { daysLate, invoiceState, isInvoiced, isNotInvoiced, isOverdue, notInvoicedTally, overdueTally } from "./tab-status";

const d = (status: Debt["status"], date = "2026-10-01", customerName = "Ali", amountSen = 1000): Debt => ({
  id: `${customerName}-${status}-${date}`,
  customerName,
  item: "",
  amountSen,
  date,
  status,
  source: "manual",
  createdAt: `${date}T00:00:00.000Z`,
});

describe("tab status rules", () => {
  it("splits tabs by where the invoice stands; marked overdue still means no invoice", () => {
    expect(["unpaid", "overdue", "sent", "paid"].map((s) => invoiceState(d(s as Debt["status"])))).toEqual(["unpaid", "unpaid", "sent", "paid"]);
    expect(isNotInvoiced(d("overdue"))).toBe(true);
    expect(isInvoiced(d("overdue"))).toBe(false);
    expect(isInvoiced(d("sent"))).toBe(true);
  });

  it("is late after the 10th of the next month, or when marked, but never once paid", () => {
    // October tabs fall due on 10 November.
    expect(isOverdue(d("sent"), "2026-11-10")).toBe(false);
    expect(isOverdue(d("sent"), "2026-11-11")).toBe(true);
    expect(daysLate(d("sent"), "2026-11-11")).toBe(1);
    expect(isOverdue(d("overdue"), "2026-10-02")).toBe(true);
    expect(daysLate(d("overdue"), "2026-10-02")).toBe(0);
    expect(isOverdue(d("paid", "2026-01-01"), "2026-11-11")).toBe(false);
  });

  it("tallies tabs, sen and distinct customers (by slug)", () => {
    const debts = [d("unpaid", "2026-10-01", "Kak Lina", 480), d("overdue", "2026-08-01", "kak lina.", 500), d("sent", "2026-09-01", "Tan", 200)];
    expect(notInvoicedTally(debts)).toEqual({ tabs: 2, sen: 980, customers: 1, names: ["Kak Lina"] });
    expect(overdueTally(debts, "2026-10-20")).toEqual({ tabs: 2, sen: 700, customers: 2, names: ["kak lina.", "Tan"] });
  });
});
