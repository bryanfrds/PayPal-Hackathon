// What the Collect screen bills, and how each customer's tabs become one PayPal invoice.
// Pure functions; the screens and the /api/invoices route use them.

import { customerSlug } from "./customer-tab";
import type { Debt } from "./debts";

/** Tabs that haven't been invoiced yet: not sent, or already overdue without an invoice. */
export function isInvoiceable(debt: Debt): boolean {
  return debt.status === "unpaid" || debt.status === "overdue";
}

export type CollectGroup = {
  customerName: string;
  slug: string;
  /** Oldest first. */
  debts: Debt[];
  totalSen: number;
  /** "overdue" if any tab is overdue, otherwise "unpaid" (not sent). */
  status: "overdue" | "unpaid";
  /** Saved email, if the shop has added one. */
  email?: string;
};

/** One group per customer with tabs to invoice, overdue first, then biggest amount first. */
export function collectGroups(debts: Debt[], emails: Record<string, string>): CollectGroup[] {
  const bySlug = new Map<string, CollectGroup>();
  for (const debt of debts) {
    if (!isInvoiceable(debt)) continue;
    const slug = customerSlug(debt.customerName);
    const group = bySlug.get(slug);
    if (group) {
      group.debts.push(debt);
      group.totalSen += debt.amountSen;
      if (debt.status === "overdue") group.status = "overdue";
    } else {
      bySlug.set(slug, {
        customerName: debt.customerName,
        slug,
        debts: [debt],
        totalSen: debt.amountSen,
        status: debt.status === "overdue" ? "overdue" : "unpaid",
        email: emails[slug],
      });
    }
  }
  for (const group of bySlug.values()) group.debts.sort((a, b) => a.date.localeCompare(b.date));
  return [...bySlug.values()].sort(
    (a, b) => (a.status === b.status ? 0 : a.status === "overdue" ? -1 : 1) || b.totalSen - a.totalSen,
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A plain check that catches typos like a missing @ or dot. PayPal does the real check. */
export function isValidEmail(email: string): boolean {
  return EMAIL.test(email.trim());
}

/** Common endings offered as one-tap buttons while typing an email. */
export const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com"];

/** "raj.kumar@" + "gmail.com" → "raj.kumar@gmail.com" (replaces any half-typed ending). */
export function withDomain(typed: string, domain: string): string {
  const local = typed.trim().split("@")[0];
  return local ? `${local}@${domain}` : "";
}

/**
 * The same tabs always give the same id, so PayPal treats a retry as the same invoice
 * (PayPal-Request-Id) and never creates a second one.
 */
export function invoiceRequestId(debtIds: string[]): string {
  const key = [...debtIds].sort().join("|");
  // FNV-1a, 32-bit, twice with different seeds for a longer id.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return `buku-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export type InvoiceLine = { name: string; amountSen: number };

/** One invoice line per tab, named by what was taken and when. */
export function invoiceLines(debts: Debt[]): InvoiceLine[] {
  return debts.map((d) => ({ name: `${d.item || "Shop items"} (${d.date})`.slice(0, 200), amountSen: d.amountSen }));
}
