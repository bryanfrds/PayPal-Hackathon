// Numbers and labels for the home dashboard. Pure functions so they can be tested in Node.

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
