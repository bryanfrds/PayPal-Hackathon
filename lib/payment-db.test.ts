// Runs the payment queries against the real database in DATABASE_URL (.env.local), and is
// skipped without one (as in CI). Rows use a random test prefix and are removed afterwards.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { afterAll, describe, expect, it } from "vitest";
import { createPaymentDb, type NewInvoice } from "./payment-db";

// Read without touching process.env, so other test files never reach the real database.
const envFile = resolve(process.cwd(), ".env.local");
const url = (process.env.DATABASE_URL ?? (existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL : undefined))?.trim();

const run = `TEST-${Math.random().toString(36).slice(2, 8)}`;
const sql = url ? neon(url) : null;
const db = sql ? createPaymentDb((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>) : null;

function invoice(id: string, amountSen = 1000): NewInvoice {
  return {
    id,
    ownerEmail: "owner@shop.my",
    customerName: "Mr Raj",
    slug: "mr-raj",
    email: "raj@x.co",
    debtIds: ["D-1", "D-2"],
    amountSen,
    currency: "MYR",
    sentAt: "2026-10-15T08:00:00Z",
  };
}

describe.skipIf(!db)("payment database", () => {
  afterAll(async () => {
    if (!sql) return;
    await sql.query(`DELETE FROM invoices WHERE id LIKE $1`, [`${run}%`]);
    await sql.query(`DELETE FROM paypal_events WHERE id LIKE $1`, [`${run}%`]);
    await sql.query(`DELETE FROM reminder_holds WHERE invoice_id LIKE $1`, [`${run}%`]);
  });

  it("saves an invoice once, and judges PayPal's answer against what was billed", async () => {
    const id = `${run}-A`;
    await db!.saveInvoice(invoice(id));
    await db!.saveInvoice(invoice(id, 5)); // a retried send changes nothing
    const paid = { status: "PAID", currency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0 };
    expect(await db!.saveFacts(id, paid, new Date("2026-10-15T09:00:00Z"), "webhook")).toBe("paid");
    const wrongTotal = { ...paid, totalSen: 900 };
    expect(await db!.saveFacts(id, wrongTotal, new Date("2026-10-15T10:00:00Z"), "app")).toBe("check");
  });

  it("never lets an older answer overwrite a newer one", async () => {
    const id = `${run}-B`;
    await db!.saveInvoice(invoice(id));
    await db!.saveFacts(id, { status: "CANCELLED" }, new Date("2026-10-15T10:00:00Z"), "webhook");
    expect(await db!.saveFacts(id, { status: "SENT" }, new Date("2026-10-15T09:00:00Z"), "app")).toBeNull();
    const [row] = await sql!.query(`SELECT status, settlement FROM invoices WHERE id = $1`, [id]);
    expect(row).toEqual({ status: "CANCELLED", settlement: "closed" });
  });

  it("knows nothing about an invoice it never saved", async () => {
    expect(await db!.saveFacts(`${run}-NONE`, { status: "PAID" }, new Date(), "webhook")).toBeNull();
  });

  it("notes each webhook event once, and forgets a failed one so PayPal's retry runs", async () => {
    const id = `${run}-EV1`;
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(true);
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(false);
    await db!.forgetEvent(id);
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(true);
    await db!.finishEvent(id, "paid");
    await db!.forgetEvent(id); // finished events are kept
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(false);
  });

  it("holds a reminder once at a time, even when two ask together", async () => {
    const id = `${run}-R`;
    const both = await Promise.all([db!.claimReminder(id, 60_000), db!.claimReminder(id, 60_000)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await db!.claimReminder(id, 60_000)).toBe(false);
    // Past the gap, it can be held again.
    expect(await db!.claimReminder(id, 0)).toBe(true);
    await db!.releaseReminder(id);
    expect(await db!.claimReminder(id, 60_000)).toBe(true);
  });
});
