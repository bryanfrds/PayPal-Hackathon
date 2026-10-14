// What the Collect screen bills, and how each customer's tabs become one PayPal invoice.
// Pure functions; the screens and the /api/invoices route use them.

import { customerSlug } from "./customer-tab";
import type { Debt } from "./debts";

/**
 * An invoice request saved on the device before it goes to PayPal, and kept until the
 * outcome is known. If the answer is lost, the retry sends exactly this again (same
 * request id), so PayPal returns the same invoice instead of making a second one.
 */
export type PendingSend = {
  slug: string;
  customerName: string;
  email: string;
  debtIds: string[];
  lines: InvoiceLine[];
  amountSen: number;
  requestId: string;
  /** ISO timestamp. */
  startedAt: string;
};

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
  /** An earlier send for these tabs didn't finish; retrying sends exactly that again. */
  pending?: PendingSend;
};

/**
 * One group per customer with tabs to invoice, overdue first, then biggest amount first.
 * A customer with an unfinished send is limited to that send's tabs, email and amount;
 * tabs added since then wait for the next invoice.
 */
export function collectGroups(
  debts: Debt[],
  emails: Record<string, string>,
  pending: Record<string, PendingSend> = {},
): CollectGroup[] {
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
  for (const group of bySlug.values()) {
    const p = pending[group.slug];
    const held = p ? group.debts.filter((d) => p.debtIds.includes(d.id)) : [];
    if (p && held.length > 0) {
      group.debts = held;
      group.totalSen = p.amountSen;
      group.email = p.email;
      group.status = held.some((d) => d.status === "overdue") ? "overdue" : "unpaid";
      group.pending = p;
    }
    group.debts.sort((a, b) => a.date.localeCompare(b.date));
  }
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
 * The same invoice (same tabs, email and lines) always gives the same id, so PayPal treats
 * a retry as the same invoice (PayPal-Request-Id) and never creates a second one. Changing
 * the email or an amount gives a new id, so a corrected invoice isn't swapped for the old one.
 * `previousInvoiceIds` are invoices already sent for these tabs (cancelled, or from before a
 * reset): billing them again gets a new id, so PayPal makes a new invoice instead of
 * returning the old one.
 */
export function invoiceRequestId(input: { debtIds: string[]; email: string; lines: InvoiceLine[]; previousInvoiceIds?: string[] }): string {
  const parts: unknown[] = [
    [...input.debtIds].sort(),
    input.email.trim().toLowerCase(),
    input.lines.map((l) => [l.name, l.amountSen]),
  ];
  if (input.previousInvoiceIds?.length) parts.push([...input.previousInvoiceIds].sort());
  const key = JSON.stringify(parts);
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

/** What goes to /api/invoices for a group: a pending send exactly as saved, otherwise a fresh one. */
export function sendRequest(group: CollectGroup, now: Date, previousInvoiceIds: string[] = []): PendingSend {
  if (group.pending) return group.pending;
  const email = group.email ?? "";
  const lines = invoiceLines(group.debts);
  const debtIds = group.debts.map((d) => d.id);
  return {
    slug: group.slug,
    customerName: group.customerName,
    email,
    debtIds,
    lines,
    amountSen: group.totalSen,
    requestId: invoiceRequestId({ debtIds, email, lines, previousInvoiceIds }),
    startedAt: now.toISOString(),
  };
}

export type Preview = {
  group: CollectGroup;
  /** False when this customer isn't in the batch: switched off, or no email yet. */
  willSend: boolean;
  reason?: "noEmail" | "switchedOff";
};

/**
 * Whose invoice the laptop's side pane shows: the one the owner picked, else the first being
 * sent, else the first on the list. Says whether it will actually go out, so the pane never
 * passes off a switched-off invoice as one that's being sent.
 */
export function pickPreview(groups: CollectGroup[], chosen: CollectGroup[], slug: string | null): Preview | null {
  const group = groups.find((g) => g.slug === slug) ?? chosen[0] ?? groups[0];
  if (!group) return null;
  if (chosen.some((c) => c.slug === group.slug)) return { group, willSend: true };
  return { group, willSend: false, reason: group.email ? "switchedOff" : "noEmail" };
}
