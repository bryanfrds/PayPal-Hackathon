import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { collectGroups, invoiceLines, invoiceRequestId, isInvoiceable, isValidEmail, sendRequest, withDomain, type PendingSend } from "./collect";

function debt(id: string, customerName: string, amountSen: number, status: Debt["status"], date = "2026-10-01", item = "Milo"): Debt {
  return { id, customerName, item, amountSen, date, status, source: "manual", createdAt: `${date}T00:00:00.000Z` };
}

describe("isInvoiceable", () => {
  it("bills tabs that haven't had an invoice", () => {
    expect(isInvoiceable(debt("a", "A", 1, "unpaid"))).toBe(true);
    expect(isInvoiceable(debt("a", "A", 1, "overdue"))).toBe(true);
    expect(isInvoiceable(debt("a", "A", 1, "sent"))).toBe(false);
    expect(isInvoiceable(debt("a", "A", 1, "paid"))).toBe(false);
  });
});

describe("collectGroups", () => {
  const debts = [
    debt("1", "Uncle Tan", 1780, "unpaid", "2026-10-05"),
    debt("2", "Mak Cik Siti", 4850, "overdue", "2026-08-02"),
    debt("3", "uncle tan", 500, "unpaid", "2026-10-01"),
    debt("4", "Kak Lina", 2240, "sent"),
    debt("5", "Mr. Raj", 500, "unpaid"),
  ];

  it("makes one group per customer, overdue first, then biggest first", () => {
    const groups = collectGroups(debts, {});
    expect(groups.map((g) => [g.customerName, g.totalSen, g.status])).toEqual([
      ["Mak Cik Siti", 4850, "overdue"],
      ["Uncle Tan", 2280, "unpaid"],
      ["Mr. Raj", 500, "unpaid"],
    ]);
    expect(groups[1].debts.map((d) => d.id)).toEqual(["3", "1"]);
  });

  it("attaches saved emails by customer slug", () => {
    const groups = collectGroups(debts, { "uncle-tan": "tan@example.com" });
    expect(groups.find((g) => g.slug === "uncle-tan")?.email).toBe("tan@example.com");
    expect(groups.find((g) => g.slug === "mr-raj")?.email).toBeUndefined();
  });
});

describe("emails", () => {
  it.each([
    ["raj.kumar@gmail.com", true],
    [" siti@yahoo.com.my ", true],
    ["raj.kumar@", false],
    ["raj@gmail", false],
    ["raj kumar@gmail.com", false],
    ["", false],
  ])("%j valid: %s", (email, ok) => {
    expect(isValidEmail(email)).toBe(ok);
  });

  it("fills in a common ending", () => {
    expect(withDomain("raj.kumar@", "gmail.com")).toBe("raj.kumar@gmail.com");
    expect(withDomain("raj.kumar@gm", "gmail.com")).toBe("raj.kumar@gmail.com");
    expect(withDomain("raj", "yahoo.com")).toBe("raj@yahoo.com");
    expect(withDomain("  ", "yahoo.com")).toBe("");
  });
});

describe("invoiceRequestId", () => {
  const base = { debtIds: ["a", "b"], email: "siti@gmail.com", lines: [{ name: "Beras", amountSen: 4850 }] };
  it("is the same for the same invoice, whatever the tab order or email case", () => {
    expect(invoiceRequestId({ ...base, debtIds: ["b", "a"], email: "Siti@Gmail.com " })).toBe(invoiceRequestId(base));
  });
  it("changes when the tabs, email or an amount change", () => {
    const id = invoiceRequestId(base);
    expect(invoiceRequestId({ ...base, debtIds: ["a"] })).not.toBe(id);
    expect(invoiceRequestId({ ...base, email: "siti2@gmail.com" })).not.toBe(id);
    expect(invoiceRequestId({ ...base, lines: [{ name: "Beras", amountSen: 4800 }] })).not.toBe(id);
  });
  it("fits PayPal's request id format", () => {
    expect(invoiceRequestId(base)).toMatch(/^buku-[0-9a-f]{16}$/);
  });
});

describe("pending sends", () => {
  const debts = [debt("1", "Uncle Tan", 1780, "unpaid", "2026-10-05"), debt("2", "Uncle Tan", 500, "unpaid", "2026-10-12")];
  const pending: PendingSend = {
    slug: "uncle-tan",
    customerName: "Uncle Tan",
    email: "old@gmail.com",
    debtIds: ["1"],
    lines: [{ name: "Milo (2026-10-05)", amountSen: 1780 }],
    amountSen: 1780,
    requestId: "buku-0123456789abcdef",
    startedAt: "2026-10-13T10:00:00.000Z",
  };

  it("limits the customer to the unfinished send's tabs, email and amount", () => {
    const [g] = collectGroups(debts, { "uncle-tan": "new@gmail.com" }, { "uncle-tan": pending });
    expect(g.debts.map((d) => d.id)).toEqual(["1"]);
    expect(g).toMatchObject({ email: "old@gmail.com", totalSen: 1780, pending });
  });

  it("resends exactly the saved request for a pending group", () => {
    const [g] = collectGroups(debts, {}, { "uncle-tan": pending });
    expect(sendRequest(g, new Date())).toBe(pending);
  });

  it("ignores a pending send whose tabs are no longer waiting for an invoice", () => {
    const [g] = collectGroups(debts, { "uncle-tan": "new@gmail.com" }, { "uncle-tan": { ...pending, debtIds: ["gone"] } });
    expect(g.pending).toBeUndefined();
    expect(g.totalSen).toBe(2280);
  });

  it("builds a fresh request with a stable id otherwise", () => {
    const [g] = collectGroups(debts, { "uncle-tan": "new@gmail.com" });
    const a = sendRequest(g, new Date("2026-10-13T10:00:00Z"));
    const b = sendRequest(g, new Date("2026-10-13T11:00:00Z"));
    expect(a.requestId).toBe(b.requestId);
    expect(a).toMatchObject({ email: "new@gmail.com", amountSen: 2280, debtIds: ["1", "2"] });
  });
});

describe("invoiceLines", () => {
  it("names each line by item and date, in sen", () => {
    expect(invoiceLines([debt("1", "A", 4850, "unpaid", "2026-08-02", "Beras 10kg"), debt("2", "A", 100, "unpaid", "2026-10-01", "")])).toEqual([
      { name: "Beras 10kg (2026-08-02)", amountSen: 4850 },
      { name: "Shop items (2026-10-01)", amountSen: 100 },
    ]);
  });
});

describe("sample emails", async () => {
  const { SAMPLE_DEBTS, SAMPLE_EMAILS } = await import("../app/ledger/sample-data");
  const { customerSlug } = await import("./customer-tab");
  it("are keyed by the slugs of real sample customers, and valid", () => {
    const slugs = new Set(SAMPLE_DEBTS.map((d) => customerSlug(d.customerName)));
    for (const [slug, email] of Object.entries(SAMPLE_EMAILS)) {
      expect(slugs.has(slug)).toBe(true);
      expect(isValidEmail(email)).toBe(true);
    }
  });
});
