// Payment reconciliation: what PayPal says about each sent invoice, and which debts that
// makes paid. Pure functions; the /api/invoices/status route and usePaymentSync use them.
//
// The rule that matters: a debt is only marked paid when PayPal reports its invoice paid in
// full, for the amount we billed. Anything partial, odd or unknown leaves the debt owed.

import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";
import type { PayPalInvoice } from "./paypal";

/** What PayPal reported about one invoice, amounts in whole sen (cents for USD). */
export type InvoiceFacts = {
  status: string;
  currency?: string;
  totalSen?: number;
  paidSen?: number;
  dueSen?: number;
};

/** One invoice in the /api/invoices/status answer. */
export type StatusResult = ({ ok: true } & InvoiceFacts) | { ok: false; error: string };

/**
 * paid: settled in full for the billed amount. open: still waiting, or partly paid.
 * closed: cancelled or refunded, so its debts need billing again.
 * check: PayPal's answer doesn't add up (wrong total or currency, partial refund, unknown
 * status); the debts stay owed until the owner looks.
 */
export type Settlement = "paid" | "open" | "closed" | "check";

/** How an invoice is shown to the owner. Derived from the same standing the ledger uses, so they agree. */
export type InvoiceView = "waiting" | "processing" | "paid" | "cancelled" | "refunded" | "check";

export function invoiceView(standing: Pick<InvoiceStanding, "status" | "settlement">): InvoiceView {
  switch (standing.settlement) {
    case "paid":
      return "paid";
    case "closed":
      return standing.status.includes("REFUND") ? "refunded" : "cancelled";
    case "check":
      return "check";
    case "open":
      return standing.status === "PAYMENT_PENDING" ? "processing" : "waiting";
  }
}

/** What one /api/invoices/status answer means for an invoice we billed, or undefined if PayPal didn't say. */
export function standingFrom(result: StatusResult | undefined, billedSen: number, currency: string, checkedAt: string): InvoiceStanding | undefined {
  if (!result?.ok) return undefined;
  const { ok: _ok, ...facts } = result;
  return { ...facts, settlement: settlementOf(facts, billedSen, currency), checkedAt };
}

/** What the device last learned from PayPal about an invoice. */
export type InvoiceStanding = InvoiceFacts & {
  settlement: Settlement;
  /** ISO timestamp of the check. */
  checkedAt: string;
};

// PAID_EXTERNAL and REFUNDED_EXTERNAL: the owner recorded on PayPal that it was paid or refunded
// some other way (cash, bank transfer). SHARED: sent as a link rather than by PayPal's email.
const PAID = new Set(["PAID", "MARKED_AS_PAID", "PAID_EXTERNAL"]);
const OPEN = new Set(["DRAFT", "SCHEDULED", "SENT", "SHARED", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"]);
const CLOSED = new Set(["CANCELLED", "AUTO_CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED", "REFUNDED_EXTERNAL"]);

/** A paid invoice can still be refunded, so it's asked about again, but only this often. */
export const PAID_RECHECK_MS = 60 * 60 * 1000;

/** Reads PayPal's "12.50" into 1250 sen. Undefined for anything that isn't a plain amount. */
export function moneyToSen(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** The facts that matter about a PayPal invoice, amounts in sen. */
export function invoiceFacts(invoice: PayPalInvoice): InvoiceFacts {
  return {
    status: invoice.status ?? "UNKNOWN",
    currency: invoice.amount?.currency_code ?? invoice.detail?.currency_code,
    totalSen: moneyToSen(invoice.amount?.value),
    paidSen: moneyToSen(invoice.payments?.paid_amount?.value),
    dueSen: moneyToSen(invoice.due_amount?.value),
  };
}

/** Classifies an invoice against the amount and currency we billed it in. */
export function settlementOf(facts: InvoiceFacts, billedSen: number, currency: string): Settlement {
  if (PAID.has(facts.status)) {
    // PayPal's total must be what we billed, in our currency, with nothing still due.
    if (facts.currency !== currency || facts.totalSen !== billedSen) return "check";
    if (facts.dueSen !== undefined && facts.dueSen > 0) return "open";
    if (facts.paidSen !== undefined && facts.paidSen < billedSen) return "open";
    return "paid";
  }
  if (OPEN.has(facts.status)) return "open";
  if (CLOSED.has(facts.status)) return "closed";
  return "check";
}

/** Why an invoice can't be reminded about, or null when it can. */
export type NoReminder = "paid" | "closed" | "pending" | "unknown";

// Still owed and waiting on the customer. PAYMENT_PENDING is excluded: their payment is on its way.
// SHARED is left out: we never make shared-link invoices, and PayPal's remind may not apply to them.
const REMINDABLE = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);

/** Whether PayPal should email this invoice's customer a reminder now. */
export function noReminderReason(facts: InvoiceFacts): NoReminder | null {
  if (PAID.has(facts.status)) return "paid";
  if (CLOSED.has(facts.status)) return "closed";
  if (facts.status === "PAYMENT_PENDING") return "pending";
  if (!REMINDABLE.has(facts.status)) return "unknown";
  if (facts.dueSen === 0) return "paid";
  return null;
}

/**
 * Invoices worth asking PayPal about, least recently tried first: everything not cancelled
 * or refunded, with paid ones only once PAID_RECHECK_MS has passed. `triedAt` (ISO
 * timestamps by id) counts failed tries too, so invoices PayPal keeps failing on don't
 * hold up the rest.
 */
export function invoicesToCheck(records: InvoiceRecord[], limit: number, now: Date, triedAt: Record<string, string> = {}): InvoiceRecord[] {
  const last = (r: InvoiceRecord) => {
    const checked = r.standing?.checkedAt ?? "";
    const tried = triedAt[r.id] ?? "";
    return tried > checked ? tried : checked;
  };
  const recheckPaidBefore = new Date(now.getTime() - PAID_RECHECK_MS).toISOString();
  return records
    .filter((r) => {
      const settlement = r.standing?.settlement;
      if (settlement === "closed") return false;
      return settlement !== "paid" || last(r) < recheckPaidBefore;
    })
    .sort((a, b) => last(a).localeCompare(last(b)))
    .slice(0, limit);
}

/**
 * Invoices worth reading from the payments database, newest first: those still waiting or in
 * doubt. Paid and cancelled ones are left to the app's own PayPal check (paid ones hourly, for
 * refunds), so with nothing outstanding the app stops asking and the database can sleep.
 */
export function invoicesToRead(records: InvoiceRecord[], limit: number): InvoiceRecord[] {
  return records
    .filter((r) => r.standing?.settlement !== "closed" && r.standing?.settlement !== "paid")
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, limit);
}

/** One answer the payments database holds (see /api/invoices/standings). */
export type StoredAnswer = InvoiceFacts & { id: string; billedCurrency: string; checkedAt: string };

/**
 * The database's answers as standings for the device's own invoices, judged against what the
 * device billed, exactly like its own PayPal check. Unknown ids and malformed rows are skipped.
 */
export function standingsFromStored(answers: StoredAnswer[], records: InvoiceRecord[]): Record<string, InvoiceStanding> {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out: Record<string, InvoiceStanding> = {};
  for (const a of answers) {
    const record = byId.get(a.id);
    if (!record || typeof a.status !== "string" || typeof a.checkedAt !== "string" || Number.isNaN(Date.parse(a.checkedAt))) continue;
    const { id: _id, checkedAt, billedCurrency, ...facts } = a;
    const standing = standingFrom({ ok: true, ...facts }, record.amountSen, billedCurrency, checkedAt);
    // Only answers newer than what the device has: an unchanged one isn't saved again.
    if (standing && (!record.standing || checkedAt > record.standing.checkedAt)) out[a.id] = standing;
  }
  return out;
}

export type DebtChanges = {
  /** Sent debts whose invoice PayPal reports paid in full. */
  toPaid: string[];
  /** Debts whose invoice was cancelled or refunded: owed, and back on the Collect list. */
  toUnpaid: string[];
  /** Paid debts whose invoice is owed again (a partial refund, a payment taken back). */
  toSent: string[];
};

/**
 * The debt status changes PayPal's answers call for. Only each debt's newest invoice
 * counts: older ones were cancelled or come from before a reset of the sample tabs. Safe to
 * run any number of times: it only returns changes that aren't made yet.
 */
export function reconcileDebts(debts: Debt[], records: InvoiceRecord[]): DebtChanges {
  const newest = new Map<string, InvoiceRecord>();
  for (const record of records) {
    for (const id of record.debtIds) {
      const current = newest.get(id);
      if (!current || record.sentAt > current.sentAt) newest.set(id, record);
    }
  }

  const changes: DebtChanges = { toPaid: [], toUnpaid: [], toSent: [] };
  for (const debt of debts) {
    const settlement = newest.get(debt.id)?.standing?.settlement;
    if (settlement === undefined) continue;
    if (settlement === "paid") {
      // Only a debt that's out on this invoice: a reset tab with the same id waits for its own.
      if (debt.status === "sent") changes.toPaid.push(debt.id);
    } else if (settlement === "closed") {
      if (debt.status === "sent" || debt.status === "paid") changes.toUnpaid.push(debt.id);
    } else if (debt.status === "paid") {
      changes.toSent.push(debt.id);
    }
  }
  return changes;
}

/**
 * The invoices to have PayPal remind each customer about, by customer slug, newest first:
 * for each debt that's out on an invoice, its newest invoice, unless that's known to be paid,
 * cancelled or in doubt. Same rule as reconcileDebts: only a debt's newest invoice counts, and
 * only "sent" debts (a reset sample tab with an old id isn't on any invoice of its own yet).
 */
export function invoicesToRemind(debts: Debt[], records: InvoiceRecord[]): Record<string, InvoiceRecord[]> {
  const newest = new Map<string, InvoiceRecord>();
  for (const record of records) {
    for (const id of record.debtIds) {
      const current = newest.get(id);
      if (!current || record.sentAt > current.sentAt) newest.set(id, record);
    }
  }
  const out: Record<string, InvoiceRecord[]> = {};
  for (const debt of debts) {
    if (debt.status !== "sent") continue;
    const record = newest.get(debt.id);
    const settlement = record?.standing?.settlement;
    if (!record || (settlement !== undefined && settlement !== "open")) continue;
    const list = (out[record.slug] ??= []);
    if (!list.includes(record)) list.push(record);
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return out;
}
