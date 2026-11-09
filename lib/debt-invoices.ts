// Which debts already have an invoice, according to the payments database. This outlives the
// device's records and PayPal's retry window, so it is what stops a second invoice for a debt.

import "server-only";
import { paymentDb, within, type StoredInvoice } from "./payment-db";
import { invoiceFacts, settlementOf } from "./payments";
import { getInvoice } from "./paypal";

export type DebtInvoices = {
  /** The invoice standing for each debt. Anything not known to be closed counts. */
  live: Map<string, StoredInvoice>;
  /** Cancelled or refunded invoices for each debt, which needs billing again under a new request id. */
  closed: Map<string, string[]>;
};

/** Most invoices asked about on one screen load, so a long list can't hold up Collect. */
const REFRESH_LIMIT = 20;

/** Empty without a payments database. Throws if the database can't answer, so callers can refuse. */
export async function debtInvoices(ownerEmail: string): Promise<DebtInvoices> {
  const links: DebtInvoices = { live: new Map(), closed: new Map() };
  const db = paymentDb();
  if (!db) return links;
  for (const invoice of await within(db.listOwnerInvoices(ownerEmail))) {
    for (const debtId of invoice.debtIds ?? []) {
      if (invoice.settlement === "closed") links.closed.set(debtId, [...(links.closed.get(debtId) ?? []), invoice.id]);
      else links.live.set(debtId, invoice);
    }
  }
  return links;
}

/**
 * Asks PayPal about these debts' unpaid invoices and saves the answers, so a cancellation whose
 * webhook was missed still frees the debt on every device. Returns the links, reread if any
 * invoice turned out closed. A failure here only means the answer waits for the next load.
 */
export async function refreshDebtInvoices(ownerEmail: string, links: DebtInvoices, debtIds: string[]): Promise<DebtInvoices> {
  const db = paymentDb();
  if (!db) return links;
  const wanted = debtIds.map((id) => links.live.get(id)).filter((invoice): invoice is StoredInvoice => invoice !== undefined && invoice.settlement !== "paid");
  const checks = await Promise.allSettled(
    wanted.slice(-REFRESH_LIMIT).map(async (invoice) => {
      const facts = invoiceFacts(await within(getInvoice(invoice.id), 3000));
      await within(db.saveFacts(invoice.id, facts, new Date(), "app"));
      return settlementOf(facts, invoice.amountSen, invoice.currency) === "closed";
    }),
  );
  return checks.some((check) => check.status === "fulfilled" && check.value) ? debtInvoices(ownerEmail) : links;
}
