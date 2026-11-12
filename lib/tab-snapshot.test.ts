import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import { customerTab } from "./customer-tab";
import type { Debt } from "./debts";
import { MAX_SNAPSHOT_BYTES, buildTabSnapshot, isTabToken, newTabToken, parseTabSnapshot, snapshotToTab, type TabSnapshot } from "./tab-snapshot";

const LINK = "https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA-BBBB";

function debt(id: string, name: string, status: Debt["status"], date: string, amountSen = 1000): Debt {
  return { id, customerName: name, item: "Milo", amountSen, date, status, source: "manual", createdAt: `${date}T08:00:00.000Z` };
}

function invoice(over: Partial<InvoiceRecord>): InvoiceRecord {
  return { id: "INV2-AAAA-BBBB", customerName: "Kak Lina", slug: "kak-lina", email: "lina@secret.my", debtIds: ["T-1"], amountSen: 1000, sentAt: "2026-10-05T08:00:00.000Z", payerLink: LINK, ...over };
}

const debts = [
  debt("T-1", "Kak Lina", "sent", "2026-10-01"),
  debt("T-2", "Kak Lina", "paid", "2026-09-01"),
  debt("T-3", "Mr Raj", "unpaid", "2026-10-02"),
];

describe("newTabToken", () => {
  it("is 128 random bits in base64url (22 characters), different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newTabToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isTabToken(t)).toBe(true);
    }
  });

  it("isTabToken turns away anything else", () => {
    for (const bad of ["", "short", "a".repeat(21), "has spaces in it 1234567", "../../etc/passwd/aaaaaa", 42, null]) expect(isTabToken(bad)).toBe(false);
  });
});

describe("buildTabSnapshot", () => {
  it("holds one customer only, with local ids and no email", () => {
    const s = buildTabSnapshot("kak-lina", debts, [invoice({})], "Kedai Ah Seng")!;
    expect(s.customerName).toBe("Kak Lina");
    expect(s.debts.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(JSON.stringify(s)).not.toContain("Mr Raj");
    expect(JSON.stringify(s)).not.toContain("secret.my");
    expect(JSON.stringify(s)).not.toContain("T-1");
    expect(s.invoices).toEqual([{ id: "INV2-AAAA-BBBB", debtIds: ["d2"], amountSen: 1000, sentAt: "2026-10-05T08:00:00.000Z", payerLink: LINK }]);
    expect(parseTabSnapshot(s).ok).toBe(true);
  });

  it("leaves out closed or paid invoices and non-PayPal links", () => {
    const closed = invoice({ id: "INV2-CLOSED-1", standing: { settlement: "closed", checkedAt: "2026-10-06T00:00:00Z" } as InvoiceRecord["standing"] });
    const odd = invoice({ id: "INV2-ODDLINK-1", payerLink: "https://evil.example/pay" });
    const s = buildTabSnapshot("kak-lina", debts, [closed, odd], "Kedai")!;
    expect(s.invoices.map((r) => r.id)).toEqual(["INV2-ODDLINK-1"]);
    expect(s.invoices[0].payerLink).toBeUndefined();
  });

  it("is null for a customer with no debts", () => {
    expect(buildTabSnapshot("nobody", debts, [], "Kedai")).toBeNull();
  });

  it("reads back into the same tab the owner sees", () => {
    const s = buildTabSnapshot("kak-lina", debts, [invoice({})], "Kedai")!;
    const back = snapshotToTab(s);
    const today = "2026-10-17";
    const owner = customerTab(debts, "kak-lina", today)!;
    const shared = customerTab(back.debts, back.slug, today)!;
    expect(shared.owedSen).toBe(owner.owedSen);
    expect(shared.toPay.map((b) => [b.month, b.unpaidSen])).toEqual(owner.toPay.map((b) => [b.month, b.unpaidSen]));
    expect(back.invoices[0].email).toBe("");
  });
});

describe("parseTabSnapshot", () => {
  const good = (): TabSnapshot => buildTabSnapshot("kak-lina", debts, [invoice({})], "Kedai")!;

  it("rejects extra fields at every level", () => {
    expect(parseTabSnapshot({ ...good(), ownerEmail: "x@y.z" }).ok).toBe(false);
    const d = good();
    (d.debts[0] as Record<string, unknown>).customerName = "Someone else";
    expect(parseTabSnapshot(d).ok).toBe(false);
    const i = good();
    (i.invoices[0] as Record<string, unknown>).email = "lina@secret.my";
    expect(parseTabSnapshot(i).ok).toBe(false);
  });

  it("rejects non-PayPal pay links", () => {
    for (const link of ["https://evil.example/pay", "http://www.paypal.com/x", "javascript:alert(1)"]) {
      const s = good();
      s.invoices[0].payerLink = link;
      expect(parseTabSnapshot(s)).toEqual({ ok: false, error: "Pay links must be PayPal pages." });
    }
  });

  it("rejects oversized snapshots and fields", () => {
    const big = good();
    big.debts = Array.from({ length: 500 }, (_, n) => ({ id: `d${n + 1}`, item: "x".repeat(200), amountSen: 100, date: "2026-10-01", status: "unpaid" as const }));
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_SNAPSHOT_BYTES);
    expect(parseTabSnapshot(big)).toEqual({ ok: false, error: "Too big." });
    const longName = good();
    longName.customerName = "x".repeat(201);
    expect(parseTabSnapshot(longName).ok).toBe(false);
  });

  it("rejects bad amounts, dates, statuses and invoice references", () => {
    const cases: ((s: TabSnapshot) => void)[] = [
      (s) => (s.debts[0].amountSen = -5),
      (s) => (s.debts[0].amountSen = 12.5),
      (s) => (s.debts[0].date = "yesterday"),
      (s) => (s.debts[0].date = "2026-02-30"),
      (s) => (s.debts[0].date = "2026-13-01"),
      (s) => ((s.debts[0] as { status: string }).status = "forgiven"),
      (s) => (s.invoices[0].debtIds = ["d99"]),
      (s) => (s.invoices[0].id = "x"),
      (s) => ((s as { v: number }).v = 2),
    ];
    for (const change of cases) {
      const s = good();
      change(s);
      expect(parseTabSnapshot(s).ok).toBe(false);
    }
    expect(parseTabSnapshot(null).ok).toBe(false);
    expect(parseTabSnapshot("text").ok).toBe(false);
  });
});
