// Payment reconciliation: what PayPal says about each sent invoice, and which debts that
// makes paid. Pure functions; the /api/invoices/status route and usePaymentSync use them.
//
// The rule that matters: a debt is only marked paid when PayPal reports its invoice paid in
// full, for the amount we billed. Anything partial, odd or unknown leaves the debt owed.

import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";

/** What PayPal reported about one invoice, amounts in whole sen. */
export type InvoiceFacts = {
  status: string;
  totalSen?: number;
  paidSen?: number;
  dueSen?: number;
};

/** One invoice in the /api/invoices/status answer. */
export type StatusResult = ({ ok: true } & InvoiceFacts) | { ok: false; error: string };

/**
 * paid: settled in full for the billed amount. open: still waiting, or partly paid.
 * closed: cancelled or refunded, so its debts need billing again.
 * check: PayPal's answer doesn't add up (wrong total, partial refund, unknown status);
 * the debts stay owed until the owner looks.
 */
export type Settlement = "paid" | "open" | "closed" | "check";

/** What the device last learned from PayPal about an invoice. */
export type InvoiceStanding = InvoiceFacts & {
  settlement: Settlement;
  /** ISO timestamp of the check. */
  checkedAt: string;
};

const PAID = new Set(["PAID", "MARKED_AS_PAID"]);
const OPEN = new Set(["DRAFT", "SCHEDULED", "SENT", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"]);
const CLOSED = new Set(["CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"]);

/** Reads PayPal's "12.50" into 1250 sen. Undefined for anything that isn't a plain amount. */
export function moneyToSen(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Classifies an invoice against the amount we billed for it. */
export function settlementOf(facts: InvoiceFacts, billedSen: number): Settlement {
  if (PAID.has(facts.status)) {
    // PayPal's total must be what we billed, and nothing may still be due.
    if (facts.totalSen !== billedSen) return "check";
    if (facts.dueSen !== undefined && facts.dueSen > 0) return "open";
    return "paid";
  }
  if (OPEN.has(facts.status)) return "open";
  if (CLOSED.has(facts.status)) return "closed";
  return "check";
}

/** paid and closed don't change again on their own, so they aren't re-checked. */
export function isFinal(settlement: Settlement | undefined): boolean {
  return settlement === "paid" || settlement === "closed";
}

/**
 * Invoices worth asking PayPal about: not settled yet, least recently tried first.
 * `triedAt` (ISO timestamps by id) counts failed tries too, so invoices PayPal keeps
 * failing on don't hold up the rest.
 */
export function invoicesToCheck(records: InvoiceRecord[], limit: number, triedAt: Record<string, string> = {}): InvoiceRecord[] {
  const last = (r: InvoiceRecord) => {
    const checked = r.standing?.checkedAt ?? "";
    const tried = triedAt[r.id] ?? "";
    return tried > checked ? tried : checked;
  };
  return records
    .filter((r) => !isFinal(r.standing?.settlement))
    .sort((a, b) => last(a).localeCompare(last(b)))
    .slice(0, limit);
}

export type DebtChanges = {
  /** Debts whose invoice PayPal reports paid in full. */
  toPaid: string[];
  /** Sent debts whose every invoice was cancelled or refunded: owed and not invoiced again. */
  toUnpaid: string[];
};

/**
 * The debt status changes PayPal's answers call for. Safe to run any number of times: it
 * only returns changes that aren't made yet.
 */
export function reconcileDebts(debts: Debt[], records: InvoiceRecord[]): DebtChanges {
  const byDebt = new Map<string, InvoiceRecord[]>();
  for (const record of records) {
    for (const id of record.debtIds) {
      const list = byDebt.get(id);
      if (list) list.push(record);
      else byDebt.set(id, [record]);
    }
  }

  const toPaid: string[] = [];
  const toUnpaid: string[] = [];
  for (const debt of debts) {
    const linked = byDebt.get(debt.id);
    if (!linked) continue;
    // Money arrived on any invoice for this debt: it's paid.
    if (linked.some((r) => r.standing?.settlement === "paid")) {
      if (debt.status !== "paid") toPaid.push(debt.id);
      continue;
    }
    // Every invoice for it is dead, so it goes back to the Collect list.
    if (debt.status === "sent" && linked.every((r) => r.standing?.settlement === "closed")) {
      toUnpaid.push(debt.id);
    }
  }
  return { toPaid, toUnpaid };
}
