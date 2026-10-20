// Figures for the ledger's laptop chips and totals panel. Pure functions so they can be tested in Node.

import type { InvoiceRecord } from "./collect-store";
import { formatSen, type Debt, type DebtStatus } from "./debts";
import { translator, type T } from "./i18n";
import { isNotInvoiced, isOverdue } from "./tab-status";

/**
 * The ledger's filter chips, using the shared rules in lib/tab-status. Invoice sent, Not sent
 * and Paid split every tab by where its invoice stands; Overdue is the late ones among them,
 * invoiced or not, so a late "Invoice sent" tab shows under both.
 */
export type LedgerFilter = "all" | DebtStatus;
export const LEDGER_FILTERS: LedgerFilter[] = ["all", "overdue", "sent", "unpaid", "paid"];

export function matchesFilter(debt: Debt, filter: LedgerFilter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") return isOverdue(debt, today);
  if (filter === "unpaid") return isNotInvoiced(debt);
  return debt.status === filter;
}

export type LedgerTotals = {
  /** Tabs per filter chip, and all of them. */
  counts: Record<LedgerFilter, number>;
  /** Sen per filter chip. Overdue overlaps the others. */
  sen: Record<DebtStatus, number>;
  /** Everything not paid, in sen: Invoice sent plus Not sent. */
  owedSen: number;
};

export function ledgerTotals(debts: Debt[], today: string): LedgerTotals {
  const counts: Record<LedgerFilter, number> = { all: debts.length, overdue: 0, sent: 0, unpaid: 0, paid: 0 };
  const sen: Record<DebtStatus, number> = { overdue: 0, sent: 0, unpaid: 0, paid: 0 };
  for (const d of debts) {
    for (const f of ["overdue", "sent", "unpaid", "paid"] as const) {
      if (!matchesFilter(d, f, today)) continue;
      counts[f] += 1;
      sen[f] += d.amountSen;
    }
  }
  return { counts, sen, owedSen: sen.sent + sen.unpaid };
}

export function filterByStatus(debts: Debt[], filter: LedgerFilter, today: string): Debt[] {
  return filter === "all" ? debts : debts.filter((d) => matchesFilter(d, filter, today));
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

/**
 * Each debt's invoice: the newest record that covers it (if a tab was invoiced again, the new
 * invoice is the live one, as in payPlan and reconcileDebts).
 */
export function latestInvoiceByDebt(invoices: InvoiceRecord[]): Record<string, InvoiceRecord> {
  const map: Record<string, InvoiceRecord> = {};
  for (const inv of invoices) {
    for (const id of inv.debtIds) {
      const current = map[id];
      if (!current || inv.sentAt > current.sentAt) map[id] = inv;
    }
  }
  return map;
}
