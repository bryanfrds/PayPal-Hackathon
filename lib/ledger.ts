// Figures for the ledger's laptop chips and totals panel. Pure functions so they can be tested in Node.

import type { Debt, DebtStatus } from "./debts";

export type LedgerFilter = "all" | DebtStatus;
export const LEDGER_FILTERS: LedgerFilter[] = ["all", "overdue", "sent", "unpaid", "paid"];

export type LedgerTotals = {
  /** Tabs per status, and all of them. */
  counts: Record<LedgerFilter, number>;
  /** Sen per status. */
  sen: Record<DebtStatus, number>;
  /** Everything not paid, in sen. */
  owedSen: number;
};

export function ledgerTotals(debts: Debt[]): LedgerTotals {
  const counts: Record<LedgerFilter, number> = { all: debts.length, overdue: 0, sent: 0, unpaid: 0, paid: 0 };
  const sen: Record<DebtStatus, number> = { overdue: 0, sent: 0, unpaid: 0, paid: 0 };
  for (const d of debts) {
    counts[d.status] += 1;
    sen[d.status] += d.amountSen;
  }
  return { counts, sen, owedSen: sen.overdue + sen.sent + sen.unpaid };
}

export function filterByStatus(debts: Debt[], filter: LedgerFilter): Debt[] {
  return filter === "all" ? debts : debts.filter((d) => d.status === filter);
}
