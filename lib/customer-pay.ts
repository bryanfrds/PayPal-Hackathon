// Which PayPal invoices a customer can pay for the bills they ticked. Payment happens on
// PayPal's page for each invoice (its pay link); tabs not invoiced yet can't be paid online.

import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";

export type PayPlan = {
  /** Invoices covering at least one of the ticked unpaid tabs, oldest first. */
  invoices: { record: InvoiceRecord; amountSen: number; /** It also bills tabs that weren't ticked. */ coversMore: boolean }[];
  /** Ticked unpaid tabs with no invoice yet. */
  notInvoiced: Debt[];
  notInvoicedSen: number;
  /** What paying actually costs: whole invoices (PayPal takes an invoice in full) plus tabs not invoiced. */
  totalSen: number;
};

/**
 * Splits the ticked unpaid tabs into PayPal invoices to pay and tabs the shop hasn't
 * invoiced. An invoice is paid in full on PayPal, so its whole amount counts, even if only
 * some of its tabs were ticked.
 */
export function payPlan(ticked: Debt[], records: InvoiceRecord[]): PayPlan {
  const unpaid = ticked.filter((d) => d.status !== "paid");
  const used = new Map<string, InvoiceRecord>();
  const notInvoiced: Debt[] = [];
  for (const debt of unpaid) {
    // If a tab was invoiced more than once, the newest invoice is the live one.
    const record = records
      .filter((r) => r.debtIds.includes(debt.id))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (record) used.set(record.id, record);
    else notInvoiced.push(debt);
  }
  const tickedIds = new Set(ticked.map((d) => d.id));
  const invoices = [...used.values()]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((record) => ({ record, amountSen: record.amountSen, coversMore: record.debtIds.some((id) => !tickedIds.has(id)) }));
  const notInvoicedSen = notInvoiced.reduce((sum, d) => sum + d.amountSen, 0);
  return {
    invoices,
    notInvoiced,
    notInvoicedSen,
    totalSen: invoices.reduce((sum, i) => sum + i.amountSen, 0) + notInvoicedSen,
  };
}

export type InvoicePayState = "open" | "processing" | "paid" | "closed" | "unknown";

/** What the customer can do with an invoice, from PayPal's status. */
export function invoicePayState(status: string | undefined): InvoicePayState {
  switch (status) {
    case "SENT":
    case "SHARED":
    case "UNPAID":
    case "PARTIALLY_PAID":
      return "open";
    case "PAYMENT_PENDING":
      return "processing";
    case "PAID":
    case "MARKED_AS_PAID":
    case "PAID_EXTERNAL":
      return "paid";
    case "CANCELLED":
    case "AUTO_CANCELLED":
    case "REFUNDED_EXTERNAL":
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "MARKED_AS_REFUNDED":
      return "closed";
    default:
      return "unknown";
  }
}

/** Only PayPal's own https pages are used as pay links (they come back from our API and are stored on the device). */
export function isPayPalUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}
