// Rows for the Insights dashboard (AG Studio). Pure functions so they can be tested in Node.
//
// Studio's data engine does the sums and grouping in the browser, so each debt becomes one
// flat row with the numbers already split into "still owed" and "collected".

import { dueDateFor, daysBetween } from "./customer-tab";
import type { Debt, DebtStatus } from "./debts";
import { STATUS_LABEL } from "@/app/components/StatusBadge";

export type LateBucket =
  "Not due yet" | "1–30 days late" | "31+ days late" | "Paid";

export type InsightRow = {
  customer: string;
  item: string;
  /** "2026-08": the month the debt was written down. Sorts in order; shown as "Aug 2026". */
  month: string;
  status: string;
  /** Ringgit, not sen: Studio formats and sums these as currency. */
  amount: number;
  /** Same as amount unless paid, then 0. */
  owed: number;
  /** Same as amount when paid, otherwise 0. */
  collected: number;
  /** Days past the bill's due date (the 10th of the next month); 0 when not due or paid. */
  daysLate: number;
  lateBucket: LateBucket;
  /** 1 when overdue, so a sum counts overdue tabs. */
  overdue: number;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-08" → "Aug 2026". */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : monthKey;
}

export function lateBucket(status: DebtStatus, daysLate: number): LateBucket {
  if (status === "paid") return "Paid";
  if (daysLate <= 0) return "Not due yet";
  if (daysLate <= 30) return "1–30 days late";
  return "31+ days late";
}

/** One row per debt. `today` is YYYY-MM-DD. */
export function toInsightRows(debts: Debt[], today: string): InsightRow[] {
  return debts.map((debt) => {
    const monthKey = debt.date.slice(0, 7);
    const paid = debt.status === "paid";
    const daysLate = paid
      ? 0
      : Math.max(0, daysBetween(dueDateFor(monthKey), today));
    const amount = debt.amountSen / 100;
    return {
      customer: debt.customerName,
      item: debt.item,
      month: monthKey,
      status: STATUS_LABEL[debt.status],
      amount,
      owed: paid ? 0 : amount,
      collected: paid ? amount : 0,
      daysLate,
      lateBucket: lateBucket(debt.status, daysLate),
      overdue: debt.status === "overdue" ? 1 : 0,
    };
  });
}

export type ScoreRow = { customer: string; owed: number };

/** Biggest balance first, people who owe nothing left out. Used by the scoreboard widget. */
export function rankOwed(rows: ScoreRow[]): ScoreRow[] {
  return rows
    .filter((row) => row.owed > 0)
    .sort((a, b) => b.owed - a.owed || a.customer.localeCompare(b.customer));
}
