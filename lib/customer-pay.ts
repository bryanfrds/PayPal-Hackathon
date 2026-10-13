// Which PayPal invoices a customer can pay for the bills they ticked. Payment happens on
// PayPal's page for each invoice (its pay link); tabs not invoiced yet can't be paid online.

import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";

export type PayPlan = {
  /** Invoices covering at least one of the ticked unpaid tabs, oldest first. */
  invoices: { record: InvoiceRecord; amountSen: number }[];
  /** Ticked unpaid tabs with no invoice yet. */
  notInvoiced: Debt[];
  notInvoicedSen: number;
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
    const record = records.find((r) => r.debtIds.includes(debt.id));
    if (record) used.set(record.id, record);
    else notInvoiced.push(debt);
  }
  const invoices = [...used.values()]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((record) => ({ record, amountSen: record.amountSen }));
  return { invoices, notInvoiced, notInvoicedSen: notInvoiced.reduce((sum, d) => sum + d.amountSen, 0) };
}
