import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import type { Debt, DebtStatus } from "./debts";
import { invoiceView, invoicesToCheck, invoicesToRead, standingsFromStored, invoicesToRemind, moneyToSen, noReminderReason, reconcileDebts, settlementOf, standingFrom, type InvoiceStanding, type Settlement } from "./payments";

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

describe("noReminderReason", () => {
  it("allows a reminder only for money still owed and waiting on the customer", () => {
    expect(noReminderReason({ status: "SENT", dueSen: 1000 })).toBeNull();
    expect(noReminderReason({ status: "UNPAID" })).toBeNull();
    expect(noReminderReason({ status: "PARTIALLY_PAID", dueSen: 400 })).toBeNull();
    expect(noReminderReason({ status: "SENT", dueSen: 0 })).toBe("paid");
    expect(noReminderReason({ status: "PAID" })).toBe("paid");
    expect(noReminderReason({ status: "CANCELLED" })).toBe("closed");
    expect(noReminderReason({ status: "PAYMENT_PENDING" })).toBe("pending");
    expect(noReminderReason({ status: "PARTIALLY_REFUNDED" })).toBe("unknown");
  });
});

describe("invoicesToRemind", () => {
  it("picks the customer's open invoice for a debt that's out", () => {
    const open = rec("INV-1", ["D1"], standing("open"));
    expect(invoicesToRemind([debt("D1", "sent")], [open])).toEqual({ "mr-raj": [open] });
  });

  it("counts an invoice PayPal hasn't been asked about yet", () => {
    const fresh = rec("INV-1", ["D1"]);
    expect(invoicesToRemind([debt("D1", "sent")], [fresh])).toEqual({ "mr-raj": [fresh] });
  });

  it.each(["paid", "closed", "check"] as Settlement[])("skips a %s invoice", (settlement) => {
    expect(invoicesToRemind([debt("D1", "sent")], [rec("INV-1", ["D1"], standing(settlement))])).toEqual({});
  });

  it("only counts debts that are out on an invoice", () => {
    const open = rec("INV-1", ["D1"], standing("open"));
    expect(invoicesToRemind([debt("D1", "paid")], [open])).toEqual({});
    expect(invoicesToRemind([debt("D1", "unpaid")], [open])).toEqual({});
    // A reset sample tab is "overdue" with an id an old invoice still holds.
    expect(invoicesToRemind([debt("D1", "overdue")], [open])).toEqual({});
  });

  it("only counts a debt's newest invoice, so a cancelled-and-resent tab reminds about the new one", () => {
    const old = rec("INV-OLD", ["D1"], standing("open"), "2026-10-01T10:00:00Z");
    const resent = rec("INV-NEW", ["D1"], standing("open"), "2026-10-10T10:00:00Z");
    expect(invoicesToRemind([debt("D1", "sent")], [old, resent])).toEqual({ "mr-raj": [resent] });
    const paidNew = rec("INV-NEW", ["D1"], standing("paid"), "2026-10-10T10:00:00Z");
    expect(invoicesToRemind([debt("D1", "sent")], [old, paidNew])).toEqual({});
  });

  it("returns every open invoice a customer has, newest first, each once", () => {
    const a = rec("INV-A", ["D1", "D2"], standing("open"), "2026-10-01T10:00:00Z");
    const b = rec("INV-B", ["D3"], standing("open"), "2026-10-05T10:00:00Z");
    const debts = [debt("D1", "sent"), debt("D2", "sent"), debt("D3", "sent")];
    expect(invoicesToRemind(debts, [a, b])).toEqual({ "mr-raj": [b, a] });
  });
});

describe("PayPal's newer statuses", () => {
  it("counts paid-outside-PayPal as paid, refunded-outside as closed, and a shared link as open", () => {
    const facts = { currency: "MYR", totalSen: 1000, dueSen: 0 };
    expect(settlementOf({ ...facts, status: "PAID_EXTERNAL" }, 1000, "MYR")).toBe("paid");
    expect(settlementOf({ ...facts, status: "REFUNDED_EXTERNAL" }, 1000, "MYR")).toBe("closed");
    expect(settlementOf({ ...facts, status: "SHARED", dueSen: 1000 }, 1000, "MYR")).toBe("open");
    expect(noReminderReason({ status: "REFUNDED_EXTERNAL" })).toBe("closed");
  });

  it("never counts paid-outside-PayPal as paid when the total changed or money is still due", () => {
    expect(settlementOf({ status: "PAID_EXTERNAL", currency: "MYR", totalSen: 800, dueSen: 0 }, 1000, "MYR")).toBe("check");
    expect(settlementOf({ status: "PAID_EXTERNAL", currency: "MYR", totalSen: 1000, dueSen: 300 }, 1000, "MYR")).toBe("open");
  });

  it("doesn't remind about a shared-link invoice", () => {
    expect(noReminderReason({ status: "SHARED", dueSen: 1000 })).toBe("unknown");
  });
});

describe("invoiceView", () => {
  const view = (status: string, settlement: Settlement) => invoiceView({ status, settlement });

  it("shows what the ledger decided, named for the owner", () => {
    expect(view("PAID", "paid")).toBe("paid");
    expect(view("SENT", "open")).toBe("waiting");
    expect(view("PAYMENT_PENDING", "open")).toBe("processing");
    expect(view("CANCELLED", "closed")).toBe("cancelled");
    expect(view("AUTO_CANCELLED", "closed")).toBe("cancelled");
    expect(view("REFUNDED", "closed")).toBe("refunded");
    expect(view("REFUNDED_EXTERNAL", "closed")).toBe("refunded");
    // The ledger keeps the debt owed, so the tracker mustn't call it cancelled.
    expect(view("PARTIALLY_REFUNDED", "check")).toBe("check");
    // Paid with the wrong total: not shown as paid.
    expect(view("PAID", "check")).toBe("check");
  });

});

describe("standingFrom", () => {
  it("applies the billed amount and currency to PayPal's answer", () => {
    const at = "2026-10-15T00:00:00Z";
    expect(standingFrom({ ok: true, status: "PAID", currency: "MYR", totalSen: 1000, dueSen: 0 }, 1000, "MYR", at)).toMatchObject({ settlement: "paid", checkedAt: at });
    expect(standingFrom({ ok: true, status: "PAID", currency: "MYR", totalSen: 900, dueSen: 0 }, 1000, "MYR", at)).toMatchObject({ settlement: "check" });
    expect(standingFrom({ ok: false, error: "x" }, 1000, "MYR", at)).toBeUndefined();
    expect(standingFrom(undefined, 1000, "MYR", at)).toBeUndefined();
  });
});

describe("invoicesToRead", () => {
  it("reads only invoices still waiting or in doubt, newest first, up to the limit", () => {
    const a = rec("A", ["D1"], standing("open"), "2026-10-01T00:00:00Z");
    const b = rec("B", ["D2"], standing("paid"), "2026-10-03T00:00:00Z");
    const c = rec("C", ["D3"], standing("closed"), "2026-10-04T00:00:00Z");
    const d = rec("D", ["D4"], undefined, "2026-10-02T00:00:00Z");
    const e = rec("E", ["D5"], standing("check"), "2026-10-05T00:00:00Z");
    expect(invoicesToRead([a, b, c, d, e], 10).map((r) => r.id)).toEqual(["E", "D", "A"]);
    expect(invoicesToRead([a, b, c, d, e], 1).map((r) => r.id)).toEqual(["E"]);
    expect(invoicesToRead([b, c], 10)).toEqual([]);
  });
});

describe("standingsFromStored", () => {
  const at = "2026-10-15T11:00:00.000Z";
  const paid = { id: "INV-1", status: "PAID", currency: "MYR", billedCurrency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0, checkedAt: at };

  it("judges the database's answer against what this device billed", () => {
    const record = rec("INV-1", ["D1"]); // billed 1000
    expect(standingsFromStored([paid], [record])).toEqual({ "INV-1": { status: "PAID", currency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0, settlement: "paid", checkedAt: at } });
    expect(standingsFromStored([{ ...paid, totalSen: 900 }], [record])["INV-1"].settlement).toBe("check");
  });

  it("never counts a payment in another currency as paid", () => {
    const record = rec("INV-1", ["D1"]);
    expect(standingsFromStored([{ ...paid, currency: "USD" }], [record])["INV-1"].settlement).toBe("check");
    // PayPal's currency unknown (an older row): not proof of payment either.
    expect(standingsFromStored([{ ...paid, currency: undefined }], [record])["INV-1"].settlement).toBe("check");
  });

  it("skips answers the device already has or that are older", () => {
    const record = rec("INV-1", ["D1"], standing("open", at));
    expect(standingsFromStored([paid], [record])).toEqual({});
    expect(standingsFromStored([{ ...paid, checkedAt: "2026-10-15T10:00:00.000Z" }], [record])).toEqual({});
    expect(Object.keys(standingsFromStored([{ ...paid, checkedAt: "2026-10-15T12:00:00.000Z" }], [record]))).toEqual(["INV-1"]);
  });

  it("skips invoices this device doesn't have and malformed answers", () => {
    const record = rec("INV-1", ["D1"]);
    expect(standingsFromStored([{ ...paid, id: "OTHER" }], [record])).toEqual({});
    expect(standingsFromStored([{ ...paid, checkedAt: "soon" }], [record])).toEqual({});
  });
});
