// The reminder schedule: who gets nudged when, from the ledger, the invoices sent on Collect
// and the owner's rules. Pure functions so they can be tested in Node.
//
// PROPOSAL: the real rules engine and scheduled job are Person 1's, and sending is Person 2's
// reminder function. This computes the same schedule on the device so the screens work now;
// nothing here sends anything.

import type { InvoiceRecord } from "./collect-store";
import { customerSlug, dueDateFor } from "./customer-tab";
import type { Debt } from "./debts";

export type ReminderRules = {
  /** Off: no reminders are planned at all. */
  on: boolean;
  /** Days after the bill falls due (or the invoice goes out, if later) before the first one. */
  firstAfterDays: number;
  /** Days between reminders after the first. */
  everyDays: number;
  /** Most reminders per bill. */
  maxCount: number;
  /** Hour of day they go out, 0–23, shop's local time. */
  sendHour: number;
  /** Nothing goes out on Friday 12–3pm (Friday prayers); those move to 3pm. */
  skipFridayPrayers: boolean;
};

export const DEFAULT_RULES: ReminderRules = {
  on: true,
  firstAfterDays: 3,
  everyDays: 4,
  maxCount: 3,
  sendHour: 10,
  skipFridayPrayers: true,
};

export const RULE_LIMITS = {
  firstAfterDays: { min: 0, max: 30 },
  everyDays: { min: 1, max: 30 },
  maxCount: { min: 1, max: 10 },
  sendHour: { min: 7, max: 21 },
} as const;

export type ScheduleKind = "due" | "invoice" | "reminder";

export type ScheduleItem = {
  /** Stable across days, so a moved reminder stays moved. */
  id: string;
  kind: ScheduleKind;
  customer: string;
  slug: string;
  /** YYYY-MM-DD, shop's local day. */
  day: string;
  /** Hour of day, 0–23. Only reminders have a real time; the others are all-day. */
  hour: number;
  /** What's still owed on the bills this item is about, in sen. */
  amountSen: number;
  /** 1 for the first reminder, 2 for the second… 0 for the others. */
  n: number;
  /** Reminders only: on or before today, so it should go out now. */
  dueNow: boolean;
  /** Reminders only: the owner dragged it to another day. */
  moved: boolean;
  label: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ORDINALS = ["1st", "2nd", "3rd"];

export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/** "2026-10-13" plus 3 days → "2026-10-16". */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 5 = Friday. */
function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The hour a reminder goes out on `day`, after the Friday prayers rule. */
export function sendHourOn(day: string, rules: ReminderRules): number {
  if (rules.skipFridayPrayers && weekday(day) === 5 && rules.sendHour >= 12 && rules.sendHour < 15) return 15;
  return rules.sendHour;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Any saved shape back to valid rules: unknown fields dropped, numbers kept in range. */
export function normaliseRules(value: unknown): ReminderRules {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof ReminderRules, unknown>>;
  const L = RULE_LIMITS;
  return {
    on: typeof v.on === "boolean" ? v.on : DEFAULT_RULES.on,
    firstAfterDays: clampInt(v.firstAfterDays, L.firstAfterDays.min, L.firstAfterDays.max, DEFAULT_RULES.firstAfterDays),
    everyDays: clampInt(v.everyDays, L.everyDays.min, L.everyDays.max, DEFAULT_RULES.everyDays),
    maxCount: clampInt(v.maxCount, L.maxCount.min, L.maxCount.max, DEFAULT_RULES.maxCount),
    sendHour: clampInt(v.sendHour, L.sendHour.min, L.sendHour.max, DEFAULT_RULES.sendHour),
    skipFridayPrayers: typeof v.skipFridayPrayers === "boolean" ? v.skipFridayPrayers : DEFAULT_RULES.skipFridayPrayers,
  };
}

/** Only tabs a PayPal invoice covers are chased: "Invoice sent" or "Overdue". */
function isChased(debt: Debt): boolean {
  return debt.status === "sent" || debt.status === "overdue";
}

function monthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS[m - 1] ?? month;
}

/**
 * Everything on the schedule: each chased customer's bill due date, their latest invoice,
 * and the reminders the rules plan after that. `moves` maps a reminder id to the day the
 * owner dragged it to. Sorted by day, then hour, then name.
 */
export function buildSchedule(
  debts: Debt[],
  invoices: InvoiceRecord[],
  rules: ReminderRules,
  moves: Record<string, string>,
  today: string,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const bySlug = new Map<string, Debt[]>();
  for (const debt of debts) {
    if (!isChased(debt)) continue;
    const slug = customerSlug(debt.customerName);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), debt]);
  }

  for (const [slug, chased] of bySlug) {
    const customer = chased[0].customerName;
    const amountSen = chased.reduce((sum, d) => sum + d.amountSen, 0);
    // The oldest unpaid bill sets the pace: reminders are about the money that's been owed longest.
    const oldestMonth = chased.map((d) => d.date.slice(0, 7)).sort()[0];
    const dueDay = dueDateFor(oldestMonth);
    items.push({
      id: `${slug}:due:${oldestMonth}`,
      kind: "due",
      customer,
      slug,
      day: dueDay,
      hour: 0,
      amountSen,
      n: 0,
      dueNow: false,
      moved: false,
      label: `${monthName(oldestMonth)} bill due`,
    });

    const latest = invoices
      .filter((inv) => inv.slug === slug)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    const invoiceDay = latest?.sentAt.slice(0, 10);
    if (latest && invoiceDay) {
      items.push({
        id: `${slug}:invoice:${latest.id}`,
        kind: "invoice",
        customer,
        slug,
        day: invoiceDay,
        hour: 0,
        amountSen: latest.amountSen,
        n: 0,
        dueNow: false,
        moved: false,
        label: latest.number ? `Invoice ${latest.number}` : "Invoice sent",
      });
    }

    if (!rules.on) continue;
    // Never remind before the bill is due, nor before the invoice reached them.
    const anchor = invoiceDay && invoiceDay > dueDay ? invoiceDay : dueDay;
    for (let n = 1; n <= rules.maxCount; n += 1) {
      const id = `${slug}:reminder:${oldestMonth}:${n}`;
      const planned = addDays(anchor, rules.firstAfterDays + (n - 1) * rules.everyDays);
      const day = moves[id] ?? planned;
      items.push({
        id,
        kind: "reminder",
        customer,
        slug,
        day,
        hour: sendHourOn(day, rules),
        amountSen,
        n,
        dueNow: day <= today,
        moved: moves[id] !== undefined && moves[id] !== planned,
        label: `${ordinal(n)} reminder`,
      });
    }
  }

  return items.sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour || a.customer.localeCompare(b.customer));
}

/** The friendly note that goes with a reminder. Plain text: callers must not treat it as HTML. */
export function reminderMessage(customer: string, amountSen: number, payLink?: string): string {
  const rm = (amountSen / 100).toFixed(2);
  const pay = payLink ? ` You can pay on PayPal here whenever it suits: ${payLink}` : " You can pay on PayPal from the link in your invoice email.";
  return `Hi ${customer}! Just a friendly reminder about RM ${rm} on your tab.${pay} Thank you!`;
}
