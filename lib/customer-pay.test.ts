import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import { invoicePayState, isPayPalUrl, payPlan } from "./customer-pay";
import type { Debt } from "./debts";

function debt(id: string, amountSen: number, status: Debt["status"] = "sent"): Debt {
  return { id, customerName: "Kak Lina", item: "x", amountSen, date: "2026-10-01", status, source: "manual", createdAt: "2026-10-01T00:00:00Z" };
}

function rec(id: string, debtIds: string[], amountSen: number, sentAt: string): InvoiceRecord {
  return { id, customerName: "Kak Lina", slug: "kak-lina", email: "l@x.co", debtIds, amountSen, sentAt, payerLink: `https://pay/${id}` };
}

describe("payPlan", () => {
  it("lists each invoice once, oldest first, for the ticked tabs", () => {
    const plan = payPlan(
      [debt("a", 1000), debt("b", 500), debt("c", 200)],
      [rec("INV2", ["c"], 200, "2026-10-12T00:00:00Z"), rec("INV1", ["a", "b"], 1500, "2026-10-01T00:00:00Z")],
    );
    expect(plan.invoices.map((i) => [i.record.id, i.amountSen])).toEqual([
      ["INV1", 1500],
      ["INV2", 200],
    ]);
    expect(plan.notInvoiced).toEqual([]);
  });

  it("counts a whole invoice even when only some of its tabs are ticked", () => {
    const plan = payPlan([debt("a", 1000)], [rec("INV1", ["a", "b"], 1500, "2026-10-01T00:00:00Z")]);
    expect(plan.invoices[0].amountSen).toBe(1500);
  });

  it("separates tabs the shop hasn't invoiced and skips paid ones", () => {
    const plan = payPlan([debt("a", 1000, "unpaid"), debt("b", 300, "paid"), debt("c", 200)], [rec("INV1", ["c"], 200, "2026-10-01T00:00:00Z")]);
    expect(plan.notInvoiced.map((d) => d.id)).toEqual(["a"]);
    expect(plan.notInvoicedSen).toBe(1000);
    expect(plan.invoices.map((i) => i.record.id)).toEqual(["INV1"]);
  });
});

describe("payPlan totals", () => {
  it("charges a whole invoice that spans unticked bills, and says so", () => {
    const plan = payPlan([debt("aug", 1000)], [rec("INV1", ["aug", "sep", "oct"], 3000, "2026-10-01T00:00:00Z")]);
    expect(plan.totalSen).toBe(3000);
    expect(plan.invoices[0].coversMore).toBe(true);
  });

  it("adds tabs not invoiced to the total", () => {
    const plan = payPlan([debt("a", 1000), debt("b", 250, "unpaid")], [rec("INV1", ["a"], 1000, "2026-10-01T00:00:00Z")]);
    expect(plan.totalSen).toBe(1250);
    expect(plan.invoices[0].coversMore).toBe(false);
  });

  it("uses the newest invoice when a tab was invoiced twice", () => {
    const plan = payPlan([debt("a", 1000)], [rec("OLD", ["a"], 1000, "2026-09-01T00:00:00Z"), rec("NEW", ["a"], 1000, "2026-10-01T00:00:00Z")]);
    expect(plan.invoices.map((i) => i.record.id)).toEqual(["NEW"]);
  });
});

describe("invoicePayState", () => {
  it.each([
    ["SENT", "open"],
    ["UNPAID", "open"],
    ["PAYMENT_PENDING", "processing"],
    ["PAID", "paid"],
    ["MARKED_AS_PAID", "paid"],
    ["CANCELLED", "closed"],
    ["REFUNDED", "closed"],
    ["SHARED", "open"],
    ["PAID_EXTERNAL", "paid"],
    ["AUTO_CANCELLED", "closed"],
    ["REFUNDED_EXTERNAL", "closed"],
    [undefined, "unknown"],
    ["SOMETHING_NEW", "unknown"],
  ])("%s → %s", (status, state) => {
    expect(invoicePayState(status)).toBe(state);
  });
});

describe("isPayPalUrl", () => {
  it.each([
    ["https://www.sandbox.paypal.com/invoice/p/#INV2-1", true],
    ["https://paypal.com/x", true],
    ["http://www.paypal.com/x", false],
    ["https://paypal.com.evil.io/x", false],
    ["https://evilpaypal.com/x", false],
    ["javascript:alert(1)", false],
    ["data:text/html,hi", false],
    [undefined, false],
  ])("%s → %s", (url, ok) => {
    expect(isPayPalUrl(url)).toBe(ok);
  });
});
