import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import type { Debt, DebtStatus } from "./debts";
import { invoicesToCheck, moneyToSen, reconcileDebts, settlementOf, type InvoiceStanding, type Settlement } from "./payments";

function debt(id: string, status: DebtStatus): Debt {
  return { id, customerName: "Mr Raj", item: "", amountSen: 500, date: "2026-10-01", status, source: "manual", createdAt: "2026-10-01T00:00:00Z" };
}

function standing(settlement: Settlement, checkedAt = "2026-10-14T10:00:00Z"): InvoiceStanding {
  return { status: "X", settlement, checkedAt };
}

function rec(id: string, debtIds: string[], s?: InvoiceStanding, sentAt = "2026-10-13T10:00:00Z"): InvoiceRecord {
  return { id, customerName: "Mr Raj", slug: "mr-raj", email: "raj@x.co", debtIds, amountSen: 1000, sentAt, standing: s };
}

const NONE = { toPaid: [], toUnpaid: [], toSent: [] };

describe("moneyToSen", () => {
  it("reads PayPal amounts into whole sen", () => {
    expect(moneyToSen("12.50")).toBe(1250);
    expect(moneyToSen("12.5")).toBe(1250);
    expect(moneyToSen("7")).toBe(700);
    expect(moneyToSen("0.00")).toBe(0);
  });

  it("refuses anything that isn't a plain amount", () => {
    for (const bad of [undefined, "", "-1.00", "1.234", "1e3", "abc", "1,000.00"]) expect(moneyToSen(bad)).toBeUndefined();
  });
});

describe("settlementOf", () => {
  const paid = { status: "PAID", currency: "MYR", totalSen: 1000 };

  it("counts an invoice paid only when PayPal's total and currency are what we billed and nothing is due", () => {
    expect(settlementOf({ ...paid, paidSen: 1000, dueSen: 0 }, 1000, "MYR")).toBe("paid");
    expect(settlementOf({ ...paid, status: "MARKED_AS_PAID" }, 1000, "MYR")).toBe("paid");
  });

  it("never calls it paid while money is still due", () => {
    expect(settlementOf({ ...paid, paidSen: 600, dueSen: 400 }, 1000, "MYR")).toBe("open");
    expect(settlementOf({ ...paid, paidSen: 600 }, 1000, "MYR")).toBe("open");
    expect(settlementOf({ ...paid, status: "PARTIALLY_PAID", paidSen: 600, dueSen: 400 }, 1000, "MYR")).toBe("open");
  });

  it("flags a paid invoice whose total or currency doesn't match the bill, or that has neither", () => {
    expect(settlementOf({ ...paid, totalSen: 900 }, 1000, "MYR")).toBe("check");
    expect(settlementOf({ ...paid, currency: "USD" }, 1000, "MYR")).toBe("check");
    expect(settlementOf({ status: "PAID" }, 1000, "MYR")).toBe("check");
  });

  it("sorts the other PayPal statuses", () => {
    for (const s of ["DRAFT", "SCHEDULED", "SENT", "UNPAID", "PAYMENT_PENDING"]) expect(settlementOf({ status: s }, 1000, "MYR")).toBe("open");
    for (const s of ["CANCELLED", "AUTO_CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"]) expect(settlementOf({ status: s }, 1000, "MYR")).toBe("closed");
    expect(settlementOf({ status: "PARTIALLY_REFUNDED" }, 1000, "MYR")).toBe("check");
    expect(settlementOf({ status: "SOMETHING_NEW" }, 1000, "MYR")).toBe("check");
  });
});

describe("reconcileDebts", () => {
  it("marks every sent debt on a paid invoice paid", () => {
    const debts = [debt("D1", "sent"), debt("D2", "sent"), debt("D3", "sent")];
    expect(reconcileDebts(debts, [rec("INV1", ["D1", "D2"], standing("paid"))])).toEqual({ ...NONE, toPaid: ["D1", "D2"] });
  });

  it("returns nothing once the changes are made, so running it again is harmless", () => {
    expect(reconcileDebts([debt("D1", "paid")], [rec("INV1", ["D1"], standing("paid"))])).toEqual(NONE);
    expect(reconcileDebts([debt("D1", "unpaid")], [rec("INV1", ["D1"], standing("closed"))])).toEqual(NONE);
  });

  it("leaves debts owed while the invoice is open, partly paid, doubtful or not checked yet", () => {
    const debts = [debt("D1", "sent"), debt("D2", "sent"), debt("D3", "sent")];
    const records = [rec("INV1", ["D1"], standing("open")), rec("INV2", ["D2"], standing("check")), rec("INV3", ["D3"])];
    expect(reconcileDebts(debts, records)).toEqual(NONE);
  });

  it("puts sent debts back on the Collect list when their invoice is cancelled", () => {
    expect(reconcileDebts([debt("D1", "sent")], [rec("INV1", ["D1"], standing("closed"))])).toEqual({ ...NONE, toUnpaid: ["D1"] });
  });

  it("reopens a paid debt when PayPal refunds it in full", () => {
    expect(reconcileDebts([debt("D1", "paid")], [rec("INV1", ["D1"], standing("closed"))])).toEqual({ ...NONE, toUnpaid: ["D1"] });
  });

  it("shows a paid debt as owed again after a partial refund or a taken-back payment", () => {
    const debts = [debt("D1", "paid"), debt("D2", "paid")];
    const records = [rec("INV1", ["D1"], standing("check")), rec("INV2", ["D2"], standing("open"))];
    expect(reconcileDebts(debts, records)).toEqual({ ...NONE, toSent: ["D1", "D2"] });
  });

  it("only counts the newest invoice: a cancelled one doesn't undo a resend that's still waiting", () => {
    const records = [rec("INV1", ["D1"], standing("closed")), rec("INV2", ["D1"], undefined, "2026-10-14T09:00:00Z")];
    expect(reconcileDebts([debt("D1", "sent")], records)).toEqual(NONE);
  });

  it("doesn't let an old paid invoice pay a sample tab reset with the same id", () => {
    // Reset puts T-1 back as not sent; the old invoice must not touch it...
    expect(reconcileDebts([debt("T-1", "unpaid")], [rec("OLD", ["T-1"], standing("paid"))])).toEqual(NONE);
    // ...and once it's invoiced again, only the new invoice counts.
    const records = [rec("OLD", ["T-1"], standing("paid")), rec("NEW", ["T-1"], standing("open"), "2026-10-14T09:00:00Z")];
    expect(reconcileDebts([debt("T-1", "sent")], records)).toEqual(NONE);
  });

  it("ignores debts with no invoice and invoices for deleted debts", () => {
    expect(reconcileDebts([debt("D1", "paid")], [rec("INV1", ["GONE"], standing("open"))])).toEqual(NONE);
  });
});

describe("invoicesToCheck", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("skips closed invoices, re-checks paid ones hourly, and asks about the least recently checked first", () => {
    const records = [
      rec("PAID-RECENT", ["D1"], standing("paid", "2026-10-14T11:30:00Z")),
      rec("PAID-OLD", ["D6"], standing("paid", "2026-10-14T10:00:00Z")),
      rec("GONE", ["D2"], standing("closed", "2026-10-01T00:00:00Z")),
      rec("RECENT", ["D3"], standing("open", "2026-10-14T11:59:00Z")),
      rec("OLDER", ["D4"], standing("open", "2026-10-14T11:00:00Z")),
      rec("NEW", ["D5"]),
    ];
    expect(invoicesToCheck(records, 10, now).map((r) => r.id)).toEqual(["NEW", "PAID-OLD", "OLDER", "RECENT"]);
    expect(invoicesToCheck(records, 2, now).map((r) => r.id)).toEqual(["NEW", "PAID-OLD"]);
  });

  it("moves invoices that just failed to the back, so they don't hold up the rest", () => {
    const records = [rec("A", ["D1"]), rec("B", ["D2"]), rec("C", ["D3"])];
    expect(invoicesToCheck(records, 2, now, { A: "2026-10-14T11:00:00Z", B: "2026-10-14T11:00:00Z" }).map((r) => r.id)).toEqual(["C", "A"]);
  });
});
