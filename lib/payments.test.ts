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
  it("counts an invoice paid only when PayPal's total is what we billed and nothing is due", () => {
    expect(settlementOf({ status: "PAID", totalSen: 1000, paidSen: 1000, dueSen: 0 }, 1000)).toBe("paid");
    expect(settlementOf({ status: "MARKED_AS_PAID", totalSen: 1000 }, 1000)).toBe("paid");
  });

  it("never calls it paid while money is still due", () => {
    expect(settlementOf({ status: "PAID", totalSen: 1000, paidSen: 600, dueSen: 400 }, 1000)).toBe("open");
    expect(settlementOf({ status: "PARTIALLY_PAID", totalSen: 1000, paidSen: 600, dueSen: 400 }, 1000)).toBe("open");
  });

  it("flags a paid invoice whose total doesn't match the bill, or that has no total", () => {
    expect(settlementOf({ status: "PAID", totalSen: 900, dueSen: 0 }, 1000)).toBe("check");
    expect(settlementOf({ status: "PAID" }, 1000)).toBe("check");
  });

  it("sorts the other PayPal statuses", () => {
    for (const s of ["DRAFT", "SCHEDULED", "SENT", "UNPAID", "PAYMENT_PENDING"]) expect(settlementOf({ status: s }, 1000)).toBe("open");
    for (const s of ["CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"]) expect(settlementOf({ status: s }, 1000)).toBe("closed");
    expect(settlementOf({ status: "PARTIALLY_REFUNDED" }, 1000)).toBe("check");
    expect(settlementOf({ status: "SOMETHING_NEW" }, 1000)).toBe("check");
  });
});

describe("reconcileDebts", () => {
  it("marks every debt on a paid invoice paid", () => {
    const debts = [debt("D1", "sent"), debt("D2", "sent"), debt("D3", "sent")];
    expect(reconcileDebts(debts, [rec("INV1", ["D1", "D2"], standing("paid"))])).toEqual({ toPaid: ["D1", "D2"], toUnpaid: [] });
  });

  it("returns nothing once the changes are made, so running it again is harmless", () => {
    const debts = [debt("D1", "paid")];
    expect(reconcileDebts(debts, [rec("INV1", ["D1"], standing("paid"))])).toEqual({ toPaid: [], toUnpaid: [] });
  });

  it("leaves debts owed while the invoice is open, partly paid, doubtful or not checked yet", () => {
    const debts = [debt("D1", "sent"), debt("D2", "sent"), debt("D3", "sent")];
    const records = [rec("INV1", ["D1"], standing("open")), rec("INV2", ["D2"], standing("check")), rec("INV3", ["D3"])];
    expect(reconcileDebts(debts, records)).toEqual({ toPaid: [], toUnpaid: [] });
  });

  it("puts sent debts back on the Collect list when their invoice is cancelled", () => {
    expect(reconcileDebts([debt("D1", "sent")], [rec("INV1", ["D1"], standing("closed"))])).toEqual({ toPaid: [], toUnpaid: ["D1"] });
  });

  it("doesn't undo a resend: a cancelled invoice with a newer one still waiting changes nothing", () => {
    const records = [rec("INV1", ["D1"], standing("closed")), rec("INV2", ["D1"], undefined, "2026-10-14T09:00:00Z")];
    expect(reconcileDebts([debt("D1", "sent")], records)).toEqual({ toPaid: [], toUnpaid: [] });
  });

  it("marks a debt paid if any of its invoices was paid, even after another was cancelled", () => {
    const records = [rec("INV1", ["D1"], standing("closed")), rec("INV2", ["D1"], standing("paid"))];
    expect(reconcileDebts([debt("D1", "unpaid")], records)).toEqual({ toPaid: ["D1"], toUnpaid: [] });
  });

  it("ignores debts with no invoice and invoices for deleted debts", () => {
    expect(reconcileDebts([debt("D1", "unpaid")], [rec("INV1", ["GONE"], standing("paid"))])).toEqual({ toPaid: [], toUnpaid: [] });
  });
});

describe("invoicesToCheck", () => {
  it("skips settled invoices and asks about the least recently checked first", () => {
    const records = [
      rec("PAID", ["D1"], standing("paid", "2026-10-01T00:00:00Z")),
      rec("GONE", ["D2"], standing("closed", "2026-10-01T00:00:00Z")),
      rec("RECENT", ["D3"], standing("open", "2026-10-14T10:00:00Z")),
      rec("OLDER", ["D4"], standing("open", "2026-10-14T09:00:00Z")),
      rec("NEW", ["D5"]),
    ];
    expect(invoicesToCheck(records, 10).map((r) => r.id)).toEqual(["NEW", "OLDER", "RECENT"]);
    expect(invoicesToCheck(records, 2).map((r) => r.id)).toEqual(["NEW", "OLDER"]);
  });

  it("moves invoices that just failed to the back, so they don't hold up the rest", () => {
    const records = [rec("A", ["D1"]), rec("B", ["D2"]), rec("C", ["D3"])];
    expect(invoicesToCheck(records, 2, { A: "2026-10-14T11:00:00Z", B: "2026-10-14T11:00:00Z" }).map((r) => r.id)).toEqual(["C", "A"]);
  });
});
