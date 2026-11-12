// The one place that decides what "overdue" and "not invoiced" mean, so Home, the ledger,
// Collect, Customers, Insights, Reminders and the customer's own page always agree.
// Pure functions so they can be tested in Node.
//
// A tab answers two separate questions:
// - Where is the invoice? Paid, Invoice sent (a PayPal invoice is out), or Not sent (no
//   invoice yet, so Collect bills it). A stored status of "overdue" is a tab marked late
//   before any invoice went out: it is still Not sent.
// - Is it late? Unpaid and past its bill's due date (the 10th of the next month), or marked
//   overdue by hand. A tab can be "Invoice sent" and late at the same time.

import { customerSlug, daysBetween, dueDateFor } from "./customer-tab";
import type { Debt } from "./debts";

/** Where the invoice stands: what the status badge says. */
export type InvoiceState = "paid" | "sent" | "unpaid";

export function invoiceState(debt: Debt): InvoiceState {
  if (debt.status === "paid") return "paid";
  if (debt.status === "sent") return "sent";
  return "unpaid";
}

/** A PayPal invoice is out for this tab and it isn't paid yet. Reminders chase only these. */
export function isInvoiced(debt: Debt): boolean {
  return debt.status === "sent";
}

/** Unpaid with no PayPal invoice yet: what Collect bills ("Not sent", or marked overdue before invoicing). */
export function isNotInvoiced(debt: Debt): boolean {
  return debt.status === "unpaid" || debt.status === "overdue";
}

/** Whole days an unpaid tab is past its bill's due date; 0 when paid or not due yet. `today` is YYYY-MM-DD. */
export function daysLate(debt: Debt, today: string): number {
  if (debt.status === "paid") return 0;
  return Math.max(0, daysBetween(dueDateFor(debt.date.slice(0, 7)), today));
}

/** Unpaid and past the due date, or marked overdue by hand. Invoiced or not. */
export function isOverdue(debt: Debt, today: string): boolean {
  return debt.status !== "paid" && (debt.status === "overdue" || daysLate(debt, today) > 0);
}

export type Tally = {
  tabs: number;
  sen: number;
  /** Distinct customers (grouped by customerSlug), in the order first seen. */
  customers: number;
  names: string[];
};

function tally(debts: Debt[], pick: (debt: Debt) => boolean): Tally {
  const out: Tally = { tabs: 0, sen: 0, customers: 0, names: [] };
  const seen = new Set<string>();
  for (const debt of debts) {
    if (!pick(debt)) continue;
    out.tabs += 1;
    out.sen += debt.amountSen;
    const slug = customerSlug(debt.customerName);
    if (!seen.has(slug)) {
      seen.add(slug);
      out.names.push(debt.customerName);
    }
  }
  out.customers = out.names.length;
  return out;
}

/** Every overdue tab (isOverdue): Home's Overdue tile, the ledger's Overdue filter, Insights. */
export function overdueTally(debts: Debt[], today: string): Tally {
  return tally(debts, (d) => isOverdue(d, today));
}

/** Every tab with no invoice yet (isNotInvoiced): Home's to-do, the ledger's Not sent filter, Collect. */
export function notInvoicedTally(debts: Debt[]): Tally {
  return tally(debts, isNotInvoiced);
}
