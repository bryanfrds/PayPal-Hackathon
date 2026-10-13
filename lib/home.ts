// Numbers and labels for the home dashboard. Pure functions so they can be tested in Node.

import { customerSlug } from "./customer-tab";
import { outstanding, type Debt } from "./debts";

export type HomeSummary = {
  /** Still owed across every debt that isn't paid, in sen. */
  owedSen: number;
  /** Debts that aren't paid. */
  openCount: number;
  overdueCount: number;
  /** Already paid, in sen. */
  paidSen: number;
  /** Paid as a share of everything ever written down, 0–100, rounded. 0 when there are no debts. */
  collectedPct: number;
};

export function summariseHome(debts: Debt[]): HomeSummary {
  const owed = outstanding(debts);
  let paidSen = 0;
  let overdueCount = 0;
  for (const debt of debts) {
    if (debt.status === "paid") paidSen += debt.amountSen;
    if (debt.status === "overdue") overdueCount += 1;
  }
  const allSen = paidSen + owed.totalSen;
  return {
    owedSen: owed.totalSen,
    openCount: owed.count,
    overdueCount,
    paidSen,
    collectedPct: allSen === 0 ? 0 : Math.round((paidSen / allSen) * 100),
  };
}

/** "Mak Cik Siti" → "MS", "Nurul" → "N", "Pak Ali (Bengkel)" → "PA". "?" when there's nothing to use. */
export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Malay greeting for the hour of day (0–23): pagi before noon, petang until 7pm, then malam. */
export function greeting(hour: number): string {
  if (hour < 12) return "Selamat pagi";
  if (hour < 19) return "Selamat petang";
  return "Selamat malam";
}

/** Index into a palette of `size` colours; the same name always gets the same index. */
export function colourIndex(name: string, size: number): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % size;
}

export type CustomerSummary = {
  customerName: string;
  /** Still owed across this customer's unpaid debts, in sen. */
  owedSen: number;
  /** Unpaid debts. */
  count: number;
  /** Oldest unpaid debt's date, YYYY-MM-DD. */
  since: string;
  /** The most urgent status among their unpaid debts. */
  status: Exclude<Debt["status"], "paid">;
};

const URGENCY: Record<Exclude<Debt["status"], "paid">, number> = { overdue: 0, sent: 1, unpaid: 2 };

/**
 * One row per customer who still owes something, most urgent first (overdue, then
 * invoice sent, then not sent), then oldest first. Names are grouped the same way as the
 * customer's own page (customerSlug), so "Kak Lina" and "kak lina." are one row.
 */
export function customerSummaries(debts: Debt[]): CustomerSummary[] {
  const byName = new Map<string, CustomerSummary>();
  for (const debt of debts) {
    if (debt.status === "paid") continue;
    const key = customerSlug(debt.customerName);
    const row = byName.get(key);
    if (!row) {
      byName.set(key, { customerName: debt.customerName, owedSen: debt.amountSen, count: 1, since: debt.date, status: debt.status });
      continue;
    }
    row.owedSen += debt.amountSen;
    row.count += 1;
    if (debt.date < row.since) row.since = debt.date;
    if (URGENCY[debt.status] < URGENCY[row.status]) row.status = debt.status;
  }
  return [...byName.values()].sort(
    (a, b) => URGENCY[a.status] - URGENCY[b.status] || a.since.localeCompare(b.since),
  );
}
