// Figures for the ledger's laptop chips and totals panel. Pure functions so they can be tested in Node.

import { formatSen, type Debt, type DebtStatus } from "./debts";
import { translator, type T } from "./i18n";

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

// Spreadsheet apps run a cell that starts with one of these as a formula (CSV injection),
// including after leading spaces, which some of them skip.
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;

/** One CSV cell: formula-looking text gets a leading ', and every cell is quoted. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Formats debts as CSV for export. Headers stay in English so the file reads the same in any
 * spreadsheet; `t` only words the fallback for a blank item (English unless one is passed).
 * Starts with a UTF-8 byte order mark so Excel reads names with accents or non-Latin script.
 */
export function debtsToCsv(debts: Debt[], invoiceMap: Record<string, string> = {}, t: T = translator()): string {
  const headers = ["Customer", "Item", "Amount (RM)", "Date", "Status", "Source", "Invoice ID"];
  const rows = debts.map((d) => [
    d.customerName ?? "",
    d.item || t("ledger.noItem"),
    formatSen(d.amountSen),
    d.date,
    d.status,
    d.source || "manual",
    invoiceMap[d.id] || "",
  ]);
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
