import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { loadSharedTab, publishTab, revokeTab } from "./shared-tab";
import type { PublishedTab, TabDb } from "./tab-db";
import { buildTabSnapshot, newTabToken, type TabSnapshot } from "./tab-snapshot";

/** The same rules as the SQL in lib/tab-db.ts, in memory. */
function memoryTabDb(): TabDb & { rows: Map<string, { token: string; revoked: boolean; tab: PublishedTab }> } {
  const rows = new Map<string, { token: string; revoked: boolean; tab: PublishedTab }>();
  return {
    rows,
    async publish(owner, slug, snapshot: TabSnapshot, newToken = newTabToken) {
      const key = `${owner.trim().toLowerCase()}|${slug}`;
      const row = rows.get(key);
      const token = row && !row.revoked ? row.token : newToken();
      rows.set(key, { token, revoked: false, tab: { customerName: snapshot.customerName, shopName: snapshot.shopName, snapshot, updatedAt: new Date().toISOString() } });
      return token;
    },
    async revoke(owner, slug) {
      const row = rows.get(`${owner.trim().toLowerCase()}|${slug}`);
      if (!row || row.revoked) return false;
      row.revoked = true;
      return true;
    },
    async read(token) {
      for (const row of rows.values()) if (row.token === token && !row.revoked) return row.tab;
      return null;
    },
  };
}

const debts: Debt[] = [
  { id: "T-1", customerName: "Kak Lina", item: "Milo", amountSen: 1200, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00Z" },
];
const snapshot = buildTabSnapshot("kak-lina", debts, [], "Kedai Ah Seng")!;

describe("publishTab", () => {
  it("returns /t/<token> and keeps the same token on every update", async () => {
    const db = memoryTabDb();
    const first = await publishTab(db, "owner@shop.my", { slug: "kak-lina", snapshot });
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(/^\/t\/[A-Za-z0-9_-]{22}$/);
    const again = await publishTab(db, "Owner@Shop.my", { slug: "kak-lina", snapshot: { ...snapshot, shopName: "Kedai Baru" } });
    expect(again.body.url).toBe(first.body.url);
  });

  it("gives a new token after the link was turned off, so the old link stays off", async () => {
    const db = memoryTabDb();
    const first = await publishTab(db, "o@s.my", { slug: "kak-lina", snapshot });
    expect((await revokeTab(db, "o@s.my", { slug: "kak-lina" })).body).toEqual({ revoked: true });
    const token = String(first.body.url).slice(3);
    expect(await loadSharedTab(db, token)).toBeNull();
    const next = await publishTab(db, "o@s.my", { slug: "kak-lina", snapshot });
    expect(next.body.url).not.toBe(first.body.url);
  });

  it("refuses bad requests", async () => {
    const db = memoryTabDb();
    expect((await publishTab(db, "o@s.my", { slug: "mr-raj", snapshot })).status).toBe(400); // another customer's slug
    expect((await publishTab(db, "o@s.my", { slug: "kak-lina", snapshot, extra: 1 })).status).toBe(400);
    expect((await publishTab(db, "o@s.my", { slug: "kak-lina", snapshot: { ...snapshot, ownerEmail: "o@s.my" } })).status).toBe(400);
    expect((await publishTab(db, "o@s.my", { slug: "../x", snapshot })).status).toBe(400);
    expect((await publishTab(db, "o@s.my", null)).status).toBe(400);
    expect(db.rows.size).toBe(0);
  });

  it("says sharing isn't set up without the database", async () => {
    expect((await publishTab(null, "o@s.my", { slug: "kak-lina", snapshot })).status).toBe(503);
    expect((await revokeTab(null, "o@s.my", { slug: "kak-lina" })).status).toBe(503);
  });
});

describe("loadSharedTab (the public /t/<token> page)", () => {
  it("shows a live tab, and nothing (not found) for unknown, malformed or turned-off tokens", async () => {
    const db = memoryTabDb();
    const { body } = await publishTab(db, "o@s.my", { slug: "kak-lina", snapshot });
    const token = String(body.url).slice(3);
    const tab = await loadSharedTab(db, token);
    expect(tab?.slug).toBe("kak-lina");
    expect(tab?.shopName).toBe("Kedai Ah Seng");
    expect(tab?.debts[0]).toMatchObject({ customerName: "Kak Lina", amountSen: 1200 });

    expect(await loadSharedTab(db, newTabToken())).toBeNull();
    expect(await loadSharedTab(db, "not a token")).toBeNull();
    expect(await loadSharedTab(null, token)).toBeNull();
    await revokeTab(db, "o@s.my", { slug: "kak-lina" });
    expect(await loadSharedTab(db, token)).toBeNull();
  });

  it("doesn't show a stored snapshot that fails the checks", async () => {
    const db = memoryTabDb();
    const token = await db.publish("o@s.my", "kak-lina", { ...snapshot, invoices: [{ id: "INV2-AAAA-1", debtIds: ["d1"], amountSen: 100, sentAt: "2026-10-01T00:00:00Z", payerLink: "https://evil.example" }] });
    expect(await loadSharedTab(db, token)).toBeNull();
  });
});
