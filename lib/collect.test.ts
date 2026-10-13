import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { collectGroups, invoiceLines, invoiceRequestId, isInvoiceable, isValidEmail, withDomain } from "./collect";

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
  it("is the same for the same tabs in any order", () => {
    expect(invoiceRequestId(["b", "a"])).toBe(invoiceRequestId(["a", "b"]));
  });
  it("differs for different tabs", () => {
    expect(invoiceRequestId(["a"])).not.toBe(invoiceRequestId(["a", "b"]));
  });
  it("fits PayPal's request id format", () => {
    expect(invoiceRequestId(["D-1", "D-2"])).toMatch(/^buku-[0-9a-f]{16}$/);
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
