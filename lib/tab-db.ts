// Published customer tabs on the server (table customer_tabs, db/migrations/003_customer_tabs.sql),
// beside the payment records in lib/payment-db.ts and in the same style: one parameterised
// query per call, and null without DATABASE_URL so the app works device-only as before.

import "server-only";
import { neon } from "@neondatabase/serverless";
import type { Query } from "./payment-db";
import { newTabToken, type TabSnapshot } from "./tab-snapshot";

export type PublishedTab = { customerName: string; shopName: string; snapshot: TabSnapshot; updatedAt: string };

export type TabDb = {
  /**
   * Saves the owner's latest copy of one customer's tab and returns its token. Publishing the
   * same customer again keeps the token, so links already sent keep working. After a revoke,
   * the next publish gets a new token, so the old link stays off.
   */
  publish(ownerEmail: string, slug: string, snapshot: TabSnapshot, newToken?: () => string): Promise<string>;
  /** Turns a customer's link off. False if there was no live link. */
  revoke(ownerEmail: string, slug: string): Promise<boolean>;
  /** The live tab for a token, or null (unknown or turned off). */
  read(token: string): Promise<PublishedTab | null>;
};

export function createTabDb(query: Query): TabDb {
  return {
    async publish(ownerEmail, slug, snapshot, newToken = newTabToken) {
      const rows = await query(
        `INSERT INTO customer_tabs (token, owner_email, slug, customer_name, shop_name, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (owner_email, slug) DO UPDATE SET
           token = CASE WHEN customer_tabs.revoked_at IS NULL THEN customer_tabs.token ELSE EXCLUDED.token END,
           customer_name = EXCLUDED.customer_name,
           shop_name = EXCLUDED.shop_name,
           snapshot = EXCLUDED.snapshot,
           updated_at = now(),
           revoked_at = NULL
         RETURNING token`,
        [newToken(), ownerEmail.trim().toLowerCase(), slug, snapshot.customerName, snapshot.shopName, JSON.stringify(snapshot)],
      );
      return String(rows[0].token);
    },

    async revoke(ownerEmail, slug) {
      const rows = await query(
        `UPDATE customer_tabs SET revoked_at = now() WHERE owner_email = $1 AND slug = $2 AND revoked_at IS NULL RETURNING token`,
        [ownerEmail.trim().toLowerCase(), slug],
      );
      return rows.length > 0;
    },

    async read(token) {
      const [row] = await query(
        `SELECT customer_name, shop_name, snapshot, updated_at FROM customer_tabs WHERE token = $1 AND revoked_at IS NULL`,
        [token],
      );
      if (!row) return null;
      const snapshot = (typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot) as TabSnapshot;
      return {
        customerName: String(row.customer_name),
        shopName: String(row.shop_name),
        snapshot,
        updatedAt: new Date(row.updated_at as string | Date).toISOString(),
      };
    },
  };
}

let cached: { url: string; db: TabDb } | null = null;

/** The published-tabs table, or null when DATABASE_URL isn't set. */
export function tabDb(env: Record<string, string | undefined> = process.env): TabDb | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  if (cached?.url !== url) {
    const sql = neon(url);
    cached = { url, db: createTabDb((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>) };
  }
  return cached.db;
}
