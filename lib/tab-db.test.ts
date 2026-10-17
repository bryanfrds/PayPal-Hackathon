// Runs the shared-tab queries against a real database: TEST_DATABASE_URL, from the environment
// or .env.local, like lib/payment-db.test.ts. Skipped without one (as in CI). Needs migration
// 003_customer_tabs.sql on that database. Rows use a random test owner and are removed afterwards.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { afterAll, describe, expect, it } from "vitest";
import { createTabDb } from "./tab-db";
import { buildTabSnapshot } from "./tab-snapshot";

const envFile = resolve(process.cwd(), ".env.local");
const url = (process.env.TEST_DATABASE_URL ?? (existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).TEST_DATABASE_URL : undefined))?.trim();

const owner = `test-${Math.random().toString(36).slice(2, 8)}@example.com`;
const sql = url ? neon(url) : null;
const db = sql ? createTabDb((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>) : null;

const snapshot = buildTabSnapshot(
  "kak-lina",
  [{ id: "T-1", customerName: "Kak Lina", item: "Milo", amountSen: 1200, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00Z" }],
  [],
  "Kedai Ah Seng",
)!;

describe.skipIf(!db)("shared tab database", () => {
  afterAll(async () => {
    if (sql) await sql.query(`DELETE FROM customer_tabs WHERE owner_email = $1`, [owner]);
  });

  it("publishes, keeps the token on update, revokes, and starts a new token after", async () => {
    const token = await db!.publish(owner, "kak-lina", snapshot);
    expect(await db!.publish(owner, "kak-lina", { ...snapshot, shopName: "Kedai Baru" })).toBe(token);
    expect((await db!.read(token))?.shopName).toBe("Kedai Baru");
    expect(await db!.revoke(owner, "kak-lina")).toBe(true);
    expect(await db!.revoke(owner, "kak-lina")).toBe(false);
    expect(await db!.read(token)).toBeNull();
    const next = await db!.publish(owner, "kak-lina", snapshot);
    expect(next).not.toBe(token);
    expect((await db!.read(next))?.snapshot.debts).toHaveLength(1);
  });
});
