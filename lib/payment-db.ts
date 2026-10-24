// Payment records on the server: the invoices the app sent, what PayPal last said about each,
// the webhook events already handled, and reminder holds. Tables: db/migrations/001_payments.sql.
//
// Optional: without DATABASE_URL, paymentDb() is null and the app works device-only as before.
// Server-only (Neon's HTTP driver, one query per call).

import "server-only";
import { neon } from "@neondatabase/serverless";
import { settlementOf, type InvoiceFacts, type Settlement } from "./payments";

/** Runs one parameterised query and returns its rows. */
export type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export type NewInvoice = {
  id: string;
  ownerEmail: string;
  number?: string;
  customerName: string;
  slug: string;
  debtIds: string[];
  amountSen: number;
  currency: string;
  payerLink?: string;
  sentAt: string;
};

export type CheckedBy = "app" | "webhook";

/**
 * What the database last heard from PayPal about one invoice. `currency` is what PayPal
 * reported; `billedCurrency` is what we billed in, to judge it against.
 */
export type StoredFacts = InvoiceFacts & { id: string; billedCurrency: string; checkedAt: string; checkedBy: CheckedBy };
export type StoredInvoice = { id: string; ownerEmail: string; customerName: string; amountSen: number; currency: string; sentAt: string; status: string; settlement: Settlement; debtIds?: string[] };

export type PaymentDb = {
  /** Records a sent invoice. A retry of the same send changes nothing. */
  saveInvoice(invoice: NewInvoice): Promise<void>;
  /**
   * Saves what PayPal said about an invoice, judged against what we billed. Only moves
   * forward in time, so an older answer arriving late never overwrites a newer one.
   * Returns the settlement, or null if we have no such invoice (or a newer answer).
   */
  saveFacts(id: string, facts: InvoiceFacts, checkedAt: Date, by: CheckedBy): Promise<Settlement | null>;
  /** The latest PayPal answer for each of these invoices that has one and that this owner sent. */
  latestFacts(ownerEmail: string, ids: string[]): Promise<StoredFacts[]>;
  /** True if a webhook event was handled within `hours`: proof the webhook really works. */
  webhookSeenSince(hours: number): Promise<boolean>;
  /**
   * Notes a webhook event. False if it was already noted: PayPal delivered it again. An event
   * noted but never finished (the function died, or forgetting it failed) is taken over after
   * a few minutes, so PayPal's retry still gets handled; handling one twice is harmless.
   */
  recordEvent(id: string, type: string, invoiceId: string | null): Promise<boolean>;
  /** Marks a noted event done, with what came of it. */
  finishEvent(id: string, outcome: string): Promise<void>;
  /** Forgets a noted event that failed, so PayPal's retry is handled. */
  forgetEvent(id: string): Promise<void>;
  /** Holds an invoice for a reminder. False if one was held within `gapMs`. */
  claimReminder(invoiceId: string, gapMs: number): Promise<boolean>;
  /** Lets go of a hold when it's certain no reminder went out. */
  releaseReminder(invoiceId: string): Promise<void>;
  getOwnerInvoice(ownerEmail: string, invoiceId: string): Promise<StoredInvoice | null>;
  listOwnerInvoices(ownerEmail: string): Promise<StoredInvoice[]>;
  invoiceExists(invoiceId: string): Promise<boolean>;
};

export function createPaymentDb(query: Query): PaymentDb {
  return {
    async saveInvoice(i) {
      await query(
        `INSERT INTO invoices (id, owner_email, number, customer_name, slug, debt_ids, amount_sen, currency, payer_link, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [i.id, i.ownerEmail.trim().toLowerCase(), i.number ?? null, i.customerName, i.slug, i.debtIds, i.amountSen, i.currency, i.payerLink ?? null, i.sentAt],
      );
    },

    async saveFacts(id, facts, checkedAt, by) {
      const [row] = await query(`SELECT amount_sen, currency FROM invoices WHERE id = $1`, [id]);
      if (!row) return null;
      const settlement = settlementOf(facts, Number(row.amount_sen), String(row.currency));
      const updated = await query(
        `UPDATE invoices
         SET status = $2, settlement = $3, total_sen = $4, paid_sen = $5, due_sen = $6, checked_at = $7, checked_by = $8,
             reported_currency = $9
         WHERE id = $1 AND (checked_at IS NULL OR checked_at < $7)
         RETURNING id`,
        [id, facts.status, settlement, facts.totalSen ?? null, facts.paidSen ?? null, facts.dueSen ?? null, checkedAt.toISOString(), by, facts.currency ?? null],
      );
      return updated.length ? settlement : null;
    },

    async latestFacts(ownerEmail, ids) {
      if (ids.length === 0) return [];
      const rows = await query(
        `SELECT id, status, currency, reported_currency, total_sen, paid_sen, due_sen, checked_at, checked_by
         FROM invoices WHERE id = ANY($1) AND owner_email = $2 AND checked_at IS NOT NULL`,
        [ids, ownerEmail.trim().toLowerCase()],
      );
      const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
      return rows.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        currency: r.reported_currency === null || r.reported_currency === undefined ? undefined : String(r.reported_currency),
        billedCurrency: String(r.currency),
        totalSen: num(r.total_sen),
        paidSen: num(r.paid_sen),
        dueSen: num(r.due_sen),
        checkedAt: new Date(r.checked_at as string | Date).toISOString(),
        checkedBy: r.checked_by === "webhook" ? "webhook" : "app",
      }));
    },

    async webhookSeenSince(hours) {
      const rows = await query(`SELECT 1 FROM paypal_events WHERE processed_at > now() - make_interval(hours => $1) LIMIT 1`, [hours]);
      return rows.length > 0;
    },

    async recordEvent(id, type, invoiceId) {
      const rows = await query(
        `INSERT INTO paypal_events (id, event_type, invoice_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET received_at = now()
         WHERE paypal_events.processed_at IS NULL AND paypal_events.received_at < now() - interval '5 minutes'
         RETURNING id`,
        [id, type, invoiceId],
      );
      return rows.length > 0;
    },

    async finishEvent(id, outcome) {
      await query(`UPDATE paypal_events SET processed_at = now(), outcome = $2 WHERE id = $1`, [id, outcome]);
    },

    async forgetEvent(id) {
      await query(`DELETE FROM paypal_events WHERE id = $1 AND processed_at IS NULL`, [id]);
    },

    async claimReminder(invoiceId, gapMs) {
      // One statement, so two requests at once can't both win.
      const rows = await query(
        `INSERT INTO reminder_holds (invoice_id, held_at) VALUES ($1, now())
         ON CONFLICT (invoice_id) DO UPDATE SET held_at = now()
         WHERE reminder_holds.held_at < now() - make_interval(secs => $2)
         RETURNING invoice_id`,
        [invoiceId, gapMs / 1000],
      );
      return rows.length > 0;
    },

    async releaseReminder(invoiceId) {
      await query(`DELETE FROM reminder_holds WHERE invoice_id = $1`, [invoiceId]);
    },
    async getOwnerInvoice(ownerEmail, invoiceId) {
      const [row] = await query(
        `SELECT ${STORED_INVOICE_COLS} FROM invoices WHERE owner_email=$1 AND id=$2`,
        [ownerEmail.trim().toLowerCase(), invoiceId],
      );
      return row ? toStoredInvoice(row) : null;
    },
    async listOwnerInvoices(ownerEmail) {
      const rows = await query(
        `SELECT ${STORED_INVOICE_COLS} FROM invoices WHERE owner_email=$1 ORDER BY sent_at`,
        [ownerEmail.trim().toLowerCase()],
      );
      return rows.map(toStoredInvoice);
    },
    async invoiceExists(invoiceId) {
      const rows = await query(`SELECT 1 FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
      return rows.length > 0;
    },
  };
}

const STORED_INVOICE_COLS = `id,owner_email,customer_name,amount_sen,currency,sent_at,debt_ids,COALESCE(status,'UNKNOWN') status,COALESCE(settlement,'check') settlement`;

function toStoredInvoice(row: Record<string, unknown>): StoredInvoice {
  return {
    id: String(row.id),
    ownerEmail: String(row.owner_email),
    customerName: String(row.customer_name),
    amountSen: Number(row.amount_sen),
    currency: String(row.currency),
    sentAt: new Date(row.sent_at as string | Date).toISOString(),
    status: String(row.status),
    settlement: row.settlement as Settlement,
    debtIds: Array.isArray(row.debt_ids) ? (row.debt_ids as string[]) : [],
  };
}

/** Waits at most `ms` for a database call, so a slow database can't hold up a PayPal action. */
export function within<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The database didn't answer within ${ms}ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let cached: { url: string; db: PaymentDb } | null = null;

/** The payments database, or null when DATABASE_URL isn't set. */
export function paymentDb(env: Record<string, string | undefined> = process.env): PaymentDb | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  if (cached?.url !== url) {
    const sql = neon(url);
    cached = { url, db: createPaymentDb((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>) };
  }
  return cached.db;
}
