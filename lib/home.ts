// Numbers and labels for the home dashboard. Pure functions so they can be tested in Node.

import { customerSlug } from "./customer-tab";
import { translator, type T } from "./i18n";
import type { ScheduleItem } from "./reminders";
import { outstanding, type Debt } from "./debts";
import { daysLate, isInvoiced, isNotInvoiced, isOverdue, notInvoicedTally, overdueTally } from "./tab-status";

export type HomeSummary = {
  /** Still owed across every debt that isn't paid, in sen. */
  owedSen: number;
  /** Debts that aren't paid. */
  openCount: number;
  /** Overdue tabs (isOverdue in lib/tab-status). */
  overdueCount: number;
  /** Already paid, in sen. */
  paidSen: number;
  /** Paid as a share of everything ever written down, 0–100, rounded. 0 when there are no debts. */
  collectedPct: number;
};

export function summariseHome(debts: Debt[], today: string): HomeSummary {
  const owed = outstanding(debts);
  let paidSen = 0;
  for (const debt of debts) if (debt.status === "paid") paidSen += debt.amountSen;
  const overdueCount = overdueTally(debts, today).tabs;
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

/** Greeting for the hour of day (0–23): morning before noon, afternoon until 7pm, then evening. English keeps the Malay words. */
export function greeting(hour: number, t: T = translator()): string {
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 19) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
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

// ---- Home redesign: the figures behind the hero, stat tiles, Today list and board ----

export type BoardRow = {
  customerName: string;
  slug: string;
  owedSen: number;
  /** Overdue if any tab is (isOverdue), else Invoice sent if any tab has an invoice, else Not sent. */
  status: Exclude<Debt["status"], "paid">;
  /**
   * The next step. Remind: an invoiced tab is overdue (reminders only chase tabs with a PayPal
   * invoice). Invoice: a tab has no invoice yet, so Collect comes first. View: just wait.
   */
  next: "remind" | "invoice" | "view";
  /** Days the oldest unpaid bill is past its due date (the 10th of the next month); 0 if not yet. */
  daysLate: number;
  /** Owed as a share of the biggest balance, 0–100, for the bars. */
  sharePct: number;
};

/** The badge on a board row: "5 days late" once past due, otherwise Overdue / Invoice sent / Not sent. */
export function lateLabel(row: Pick<BoardRow, "status" | "daysLate">, t: T = translator()): string {
  if (row.status === "overdue" && row.daysLate > 0) return t("late.days", { count: row.daysLate });
  return t(`status.${row.status}`);
}

/** Who owes, biggest balance first, with days late and a bar length. */
export function owedBoard(debts: Debt[], today: string): BoardRow[] {
  type Acc = { row: BoardRow; overdue: boolean; sent: boolean; notInvoiced: boolean; lateInvoiced: boolean };
  const bySlug = new Map<string, Acc>();
  for (const debt of debts) {
    if (debt.status === "paid") continue;
    const slug = customerSlug(debt.customerName);
    let acc = bySlug.get(slug);
    if (!acc) {
      const row: BoardRow = { customerName: debt.customerName, slug, owedSen: 0, status: "unpaid", next: "view", daysLate: 0, sharePct: 0 };
      acc = { row, overdue: false, sent: false, notInvoiced: false, lateInvoiced: false };
      bySlug.set(slug, acc);
    }
    acc.row.owedSen += debt.amountSen;
    acc.row.daysLate = Math.max(acc.row.daysLate, daysLate(debt, today));
    // One rule for every screen (lib/tab-status): late whether or not an invoice went out.
    const late = isOverdue(debt, today);
    if (late) acc.overdue = true;
    if (isInvoiced(debt)) {
      acc.sent = true;
      if (late) acc.lateInvoiced = true;
    }
    if (isNotInvoiced(debt)) acc.notInvoiced = true;
  }
  const rows = [...bySlug.values()].map(({ row, overdue, sent, notInvoiced, lateInvoiced }) => {
    row.status = overdue ? "overdue" : sent ? "sent" : "unpaid";
    row.next = lateInvoiced ? "remind" : notInvoiced ? "invoice" : "view";
    return row;
  });
  rows.sort((a, b) => b.owedSen - a.owedSen || b.daysLate - a.daysLate || a.customerName.localeCompare(b.customerName));
  const top = rows[0]?.owedSen ?? 0;
  for (const row of rows) row.sharePct = top > 0 ? Math.max(4, Math.round((row.owedSen / top) * 100)) : 0;
  return rows;
}

export type HomeOverview = HomeSummary & {
  /** Owed on overdue tabs (isOverdue), in sen, and as a share of everything. */
  overdueSen: number;
  overduePct: number;
  overdueTabs: number;
  /** The most days any unpaid bill is past due. */
  oldestDaysLate: number;
  customersOwing: number;
  /** Reminders that should go out today, one per customer, names in schedule order. */
  remindNow: string[];
  /** The next day a reminder is planned after today, if any. */
  nextReminder?: string;
  /** Tabs with no PayPal invoice yet (isNotInvoiced): the same tabs Collect bills. */
  notInvoiced: { count: number; sen: number; customers: number; names: string[] };
  paidTabs: { count: number; sen: number };
};

/** Everything on Home's hero, stat tiles and Today list. `schedule` is buildSchedule's output. */
export function homeOverview(debts: Debt[], schedule: ScheduleItem[], today: string): HomeOverview {
  const summary = summariseHome(debts, today);
  const overdue = overdueTally(debts, today);
  const waiting = notInvoicedTally(debts);
  let oldestDaysLate = 0;
  const paidTabs = { count: 0, sen: 0 };
  for (const debt of debts) {
    if (debt.status === "paid") {
      paidTabs.count += 1;
      paidTabs.sen += debt.amountSen;
      continue;
    }
    oldestDaysLate = Math.max(oldestDaysLate, daysLate(debt, today));
  }
  const all = summary.owedSen + summary.paidSen;
  const reminders = schedule.filter((i) => i.kind === "reminder");
  const remindNow: string[] = [];
  for (const r of reminders) if (r.dueNow && !remindNow.includes(r.customer)) remindNow.push(r.customer);
  const next = reminders.filter((r) => !r.sent && r.day > today).map((r) => r.day).sort()[0];
  return {
    ...summary,
    overdueSen: overdue.sen,
    overduePct: all === 0 ? 0 : Math.round((overdue.sen / all) * 100),
    overdueTabs: overdue.tabs,
    oldestDaysLate,
    customersOwing: customerSummaries(debts).length,
    remindNow,
    nextReminder: next,
    notInvoiced: { count: waiting.tabs, sen: waiting.sen, customers: waiting.customers, names: waiting.names },
    paidTabs,
  };
}

export type MonthTotal = { month: string; label: string; owedSen: number; collectedSen: number };

/** Owed and collected per month the tabs were written down, the last `count` months up to today. */
export function monthTotals(debts: Debt[], today: string, count = 4): MonthTotal[] {
  const [y, m] = today.split("-").map(Number);
  const months: MonthTotal[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const month = d.toISOString().slice(0, 7);
    months.push({ month, label: SHORT_MONTHS[d.getUTCMonth()], owedSen: 0, collectedSen: 0 });
  }
  const byMonth = new Map(months.map((row) => [row.month, row]));
  for (const debt of debts) {
    const row = byMonth.get(debt.date.slice(0, 7));
    if (!row) continue;
    if (debt.status === "paid") row.collectedSen += debt.amountSen;
    else row.owedSen += debt.amountSen;
  }
  return months;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
