// The customer's own view of their tab at the shop, in the style of SPayLater:
// what they owe, monthly bills with due dates, and their history.
//
// Built from the same Debt records as the ledger. Bills, due dates and the credit
// limit are worked out here; none of them are stored yet (see lib/debts.ts proposal).

import { outstanding, type Debt } from "./debts";

/** Every customer gets this limit until the shop can set one per customer. */
export const DEFAULT_CREDIT_LIMIT_SEN = 100_00;

/** A month's bill is due on this day of the following month. */
export const BILL_DUE_DAY = 10;

export type BillStatus = "paid" | "due" | "overdue";

export type Bill = {
  /** YYYY-MM of the debts in this bill. */
  month: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  status: BillStatus;
  /** Everything taken on credit that month, in sen. */
  totalSen: number;
  /** What's still unpaid of it, in sen. */
  unpaidSen: number;
  paidSen: number;
  /** Oldest first. */
  debts: Debt[];
};

export type CustomerTab = {
  customerName: string;
  slug: string;
  owedSen: number;
  limitSen: number;
  /** Limit minus what's owed; never below 0. */
  leftSen: number;
  /** Unpaid bills, oldest first. */
  toPay: Bill[];
  /** Paid bills, newest first. */
  paid: Bill[];
  /** Every debt, newest first. */
  history: Debt[];
};

/**
 * "Pak Ali (Bengkel)" → "pak-ali-bengkel", "陈先生" → "陈先生". Used in the customer's link
 * (pass it through tabPath, which encodes it). Spellings that differ only in case,
 * accents or punctuation ("Mr. Raj", "mr raj") share a slug on purpose: they're the same
 * customer written two ways. Swap to Person 1's customer IDs once the directory exists.
 */
export function customerSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Drop Latin accents only (é → e); other scripts' vowel signs are part of the letter.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  // Nothing usable (e.g. only punctuation): a stable id from the name, so it still has a page.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `c-${hash.toString(36)}`;
}

/** "/tab/<slug>" plus an optional "/bills" etc., with the slug encoded for the URL. */
export function tabPath(slug: string, rest = ""): string {
  return `/tab/${encodeURIComponent(slug)}${rest}`;
}

/** The slug back out of a URL segment. Next.js may hand it over still percent-encoded. */
export function slugFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** "2026-09" → "2026-10-10" (the due day in the month after). */
export function dueDateFor(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, "0")}-${String(BILL_DUE_DAY).padStart(2, "0")}`;
}

function billStatus(debts: Debt[], dueDate: string, today: string): BillStatus {
  const unpaid = debts.filter((d) => d.status !== "paid");
  if (unpaid.length === 0) return "paid";
  if (today > dueDate || unpaid.some((d) => d.status === "overdue")) return "overdue";
  return "due";
}

/** One bill per month of debt date. Unpaid bills oldest first, then paid bills newest first. */
export function groupBills(debts: Debt[], today: string): { toPay: Bill[]; paid: Bill[] } {
  const byMonth = new Map<string, Debt[]>();
  for (const debt of debts) {
    const month = debt.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), debt]);
  }
  const bills: Bill[] = [...byMonth.entries()].map(([month, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const dueDate = dueDateFor(month);
    const totalSen = sorted.reduce((sum, d) => sum + d.amountSen, 0);
    const unpaidSen = outstanding(sorted).totalSen;
    return {
      month,
      dueDate,
      status: billStatus(sorted, dueDate, today),
      totalSen,
      unpaidSen,
      paidSen: totalSen - unpaidSen,
      debts: sorted,
    };
  });
  return {
    toPay: bills.filter((b) => b.status !== "paid").sort((a, b) => a.month.localeCompare(b.month)),
    paid: bills.filter((b) => b.status === "paid").sort((a, b) => b.month.localeCompare(a.month)),
  };
}

/** The tab for the customer whose link slug matches, or null if there's none. */
export function customerTab(debts: Debt[], slug: string, today: string): CustomerTab | null {
  const mine = debts.filter((d) => customerSlug(d.customerName) === slug);
  if (mine.length === 0) return null;
  const owedSen = outstanding(mine).totalSen;
  const { toPay, paid } = groupBills(mine, today);
  return {
    customerName: mine[0].customerName,
    slug,
    owedSen,
    limitSen: DEFAULT_CREDIT_LIMIT_SEN,
    leftSen: Math.max(0, DEFAULT_CREDIT_LIMIT_SEN - owedSen),
    toPay,
    paid,
    history: [...mine].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  };
}

/**
 * Bills must be paid oldest first, with no gaps. Ticking a bill ticks every older one;
 * unticking a bill unticks every newer one. `count` is how many of the oldest are ticked.
 */
export function toggleBill(count: number, index: number): number {
  return index < count ? index : index + 1;
}

/** Sum of the oldest `count` unpaid bills, in sen. */
export function payableSen(toPay: Bill[], count: number): number {
  return toPay.slice(0, count).reduce((sum, b) => sum + b.unpaidSen, 0);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-15" → "15 Oct 2026" */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-10" → "October" (adds the year when it isn't `currentYear`). */
export function formatMonth(month: string, currentYear?: number): string {
  const [y, m] = month.split("-").map(Number);
  return currentYear === undefined || y === currentYear ? MONTHS_LONG[m - 1] : `${MONTHS_LONG[m - 1]} ${y}`;
}
