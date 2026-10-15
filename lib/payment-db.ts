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
  email: string;
  debtIds: string[];
  amountSen: number;
  currency: string;
  payerLink?: string;
  sentAt: string;
};

export type CheckedBy = "app" | "webhook";

export type PaymentDb = {
  /** Records a sent invoice. A retry of the same send changes nothing. */
  saveInvoice(invoice: NewInvoice): Promise<void>;
  /**
   * Saves what PayPal said about an invoice, judged against what we billed. Only moves
   * forward in time, so an older answer arriving late never overwrites a newer one.
   * Returns the settlement, or null if we have no such invoice (or a newer answer).
   */
  saveFacts(id: string, facts: InvoiceFacts, checkedAt: Date, by: CheckedBy): Promise<Settlement | null>;
  /** Notes a webhook event. False if it was already noted: PayPal delivered it again. */
  recordEvent(id: string, type: string, invoiceId: string | null): Promise<boolean>;
  /** Marks a noted event done, with what came of it. */
  finishEvent(id: string, outcome: string): Promise<void>;
  /** Forgets a noted event that failed, so PayPal's retry is handled. */
  forgetEvent(id: string): Promise<void>;
  /** Holds an invoice for a reminder. False if one was held within `gapMs`. */
  claimReminder(invoiceId: string, gapMs: number): Promise<boolean>;
  /** Lets go of a hold when it's certain no reminder went out. */
  releaseReminder(invoiceId: string): Promise<void>;
};

export function createPaymentDb(query: Query): PaymentDb {
  return {
    async saveInvoice(i) {
      await query(
        `INSERT INTO invoices (id, owner_email, number, customer_name, slug, email, debt_ids, amount_sen, currency, payer_link, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [i.id, i.ownerEmail, i.number ?? null, i.customerName, i.slug, i.email, i.debtIds, i.amountSen, i.currency, i.payerLink ?? null, i.sentAt],
      );
    },

    async saveFacts(id, facts, checkedAt, by) {
      const [row] = await query(`SELECT amount_sen, currency FROM invoices WHERE id = $1`, [id]);
      if (!row) return null;
      const settlement = settlementOf(facts, Number(row.amount_sen), String(row.currency));
      const updated = await query(
        `UPDATE invoices
         SET status = $2, settlement = $3, total_sen = $4, paid_sen = $5, due_sen = $6, checked_at = $7, checked_by = $8
         WHERE id = $1 AND (checked_at IS NULL OR checked_at < $7)
         RETURNING id`,
        [id, facts.status, settlement, facts.totalSen ?? null, facts.paidSen ?? null, facts.dueSen ?? null, checkedAt.toISOString(), by],
      );
      return updated.length ? settlement : null;
    },

    async recordEvent(id, type, invoiceId) {
      const rows = await query(
        `INSERT INTO paypal_events (id, event_type, invoice_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
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
  };
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
