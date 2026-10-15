// Runs the payment queries against a real database: TEST_DATABASE_URL, from the environment or
// .env.local. Skipped without one (as in CI). Its own variable, so a `vercel env pull` that
// brings in the live DATABASE_URL never points tests at it. Needs `npm run db:migrate` run
// on that database. Rows use a random test prefix and are removed afterwards.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { afterAll, describe, expect, it } from "vitest";
import { createPaymentDb, within, type NewInvoice } from "./payment-db";

// Read without touching process.env, so other test files never reach the real database.
const envFile = resolve(process.cwd(), ".env.local");
const url = (process.env.TEST_DATABASE_URL ?? (existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).TEST_DATABASE_URL : undefined))?.trim();

const run = `TEST-${Math.random().toString(36).slice(2, 8)}`;
const sql = url ? neon(url) : null;
const db = sql ? createPaymentDb((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>) : null;

function invoice(id: string, amountSen = 1000): NewInvoice {
  return {
    id,
    ownerEmail: " Owner@Shop.my ",
    customerName: "Mr Raj",
    slug: "mr-raj",
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
    const [saved] = await sql!.query(`SELECT owner_email, amount_sen FROM invoices WHERE id = $1`, [id]);
    expect(saved).toEqual({ owner_email: "owner@shop.my", amount_sen: 1000 });
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

  it("reads back the latest answer for the invoices asked about", async () => {
    const id = `${run}-C`;
    await db!.saveInvoice(invoice(id));
    expect(await db!.latestFacts([id])).toEqual([]); // not checked yet
    await db!.saveFacts(id, { status: "PAID", currency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0 }, new Date("2026-10-15T11:00:00Z"), "webhook");
    expect(await db!.latestFacts([id, `${run}-NONE`])).toEqual([
      { id, status: "PAID", currency: "MYR", billedCurrency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0, checkedAt: "2026-10-15T11:00:00.000Z", checkedBy: "webhook" },
    ]);
  });

  it("keeps the currency PayPal reported apart from the one billed", async () => {
    const id = `${run}-USD`;
    await db!.saveInvoice(invoice(id));
    expect(await db!.saveFacts(id, { status: "PAID", currency: "USD", totalSen: 1000, dueSen: 0 }, new Date("2026-10-15T11:00:00Z"), "webhook")).toBe("check");
    const [facts] = await db!.latestFacts([id]);
    expect(facts).toMatchObject({ currency: "USD", billedCurrency: "MYR" });
  });

  it("says whether a webhook event was handled recently", async () => {
    const id = `${run}-EV3`;
    await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X");
    await db!.finishEvent(id, "paid");
    expect(await db!.webhookSeenSince(1)).toBe(true);
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

  it("takes over an event that was noted but never finished, once it's a few minutes old", async () => {
    const id = `${run}-EV2`;
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(true);
    // Still in progress somewhere: a redelivery now is a duplicate.
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(false);
    await sql!.query(`UPDATE paypal_events SET received_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    expect(await db!.recordEvent(id, "INVOICING.INVOICE.PAID", "INV2-X")).toBe(true);
    await db!.finishEvent(id, "paid");
    await sql!.query(`UPDATE paypal_events SET received_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
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

describe("within", () => {
  it("passes a quick answer through and gives up on a slow one", async () => {
    await expect(within(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(within(new Promise(() => {}), 10)).rejects.toThrow("didn't answer");
  });
});
