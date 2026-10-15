// The reminder schedule: who gets nudged when, from the ledger, the invoices sent on Collect
// and the owner's rules. Pure functions so they can be tested in Node.
//
// PROPOSAL: the real rules engine and scheduled job are Person 1's, and sending is Person 2's
// reminder function. This computes the same schedule on the device so the screens work now;
// nothing here sends anything.

import type { InvoiceRecord } from "./collect-store";
import { customerSlug, dueDateFor } from "./customer-tab";
import { todayLocal, type Debt } from "./debts";
import { translator, type T, type TKey } from "./i18n";

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
  /** Reminders only: the owner sent it (tapped WhatsApp) on `day`. */
  sent: boolean;
  label: string;
};

const ORDINALS: TKey[] = ["reminders.ordinal.1", "reminders.ordinal.2", "reminders.ordinal.3"];

/** 1 → "1st", 4 → "4th" (in the language of `t`). */
export function ordinal(n: number, t: T = translator()): string {
  const key = ORDINALS[n - 1];
  return key ? t(key) : t("reminders.ordinal.n", { n });
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

function monthName(month: string, t: T): string {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? t(`reminders.month.${m}` as TKey) : month;
}

/**
 * Everything on the schedule: each chased customer's bill due date, their latest invoice,
 * and the reminders the rules plan after that. `moves` maps a reminder id to the day the
 * owner dragged it to; `sent` maps it to the day they sent it. A reminder that should have gone
 * out but hasn't is due today, and the ones after it count from there. Sorted by day, then
 * hour, then name. Labels are in the language of `t` (English by default).
 */
export function buildSchedule(
  debts: Debt[],
  invoices: InvoiceRecord[],
  rules: ReminderRules,
  moves: Record<string, string>,
  today: string,
  sent: Record<string, string> = {},
  t: T = translator(),
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
      sent: false,
      label: t("reminders.label.due", { month: monthName(oldestMonth, t) }),
    });

    const latest = invoices
      .filter((inv) => inv.slug === slug)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    // The shop's own day the invoice went out (sentAt is UTC; before 8am in Malaysia is still the same day there).
    const invoiceDay = latest ? todayLocal(new Date(latest.sentAt)) : undefined;
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
        sent: false,
        label: latest.number ? t("reminders.label.invoiceNumber", { number: latest.number }) : t("reminders.label.invoiceSent"),
      });
    }

    if (!rules.on) continue;
    // Never remind before the bill is due, nor before the invoice reached them.
    const anchor = invoiceDay && invoiceDay > dueDay ? invoiceDay : dueDay;
    // A reminder sent for an older bill that's since been paid still counts: the next bill's
    // first reminder keeps the spacing instead of landing the day after.
    const thisBill = `${slug}:reminder:${oldestMonth}:`;
    const lastEarlier = Object.entries(sent)
      .filter(([id]) => id.startsWith(`${slug}:reminder:`) && !id.startsWith(thisBill))
      .map(([, day]) => day)
      .sort()
      .at(-1);
    let previous: string | null = null;
    for (let n = 1; n <= rules.maxCount; n += 1) {
      const id = `${slug}:reminder:${oldestMonth}:${n}`;
      const wasSent = sent[id] !== undefined;
      let byRules: string = previous === null ? addDays(anchor, rules.firstAfterDays) : addDays(previous, rules.everyDays);
      if (previous === null && lastEarlier) {
        const spaced = addDays(lastEarlier, rules.everyDays);
        if (spaced > byRules) byRules = spaced;
      }
      // Nothing goes out by itself, so one that's overdue and unsent is due today, not in the past.
      const planned: string = byRules < today ? today : byRules;
      // A move only counts if it's still ahead: not in the past and after the reminder before it,
      // so one customer never gets two nudges on a day or the 2nd before the 1st.
      const move = moves[id];
      const moveOk = move !== undefined && move >= today && (previous === null || move > previous);
      const day: string = wasSent ? sent[id] : moveOk ? move : planned;
      previous = day;
      items.push({
        id,
        kind: "reminder",
        customer,
        slug,
        day,
        hour: sendHourOn(day, rules),
        amountSen,
        n,
        dueNow: !wasSent && day <= today,
        moved: !wasSent && moveOk && move !== planned,
        sent: wasSent,
        label: t(wasSent ? "reminders.label.reminderSent" : "reminders.label.reminder", { ordinal: ordinal(n, t) }),
      });
    }
  }

  return items.sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour || a.customer.localeCompare(b.customer));
}

/** The friendly note that goes with a reminder. Plain text: callers must not treat it as HTML. */
export function reminderMessage(customer: string, amountSen: number, payLink?: string, t: T = translator()): string {
  const amount = (amountSen / 100).toFixed(2);
  return payLink
    ? t("reminders.message.link", { name: customer, amount, link: payLink })
    : t("reminders.message.noLink", { name: customer, amount });
}

/** True for a complete, real YYYY-MM-DD day (not "0052-02-10" or "52026-02-10"). */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01") return false;
  return addDays(value, 0) === value;
}

/**
 * The first day a reminder can move to: today, and after the reminder before it, so one
 * customer never gets two nudges on a day or the 2nd before the 1st.
 */
export function earliestMoveDay(items: ScheduleItem[], item: ScheduleItem, today: string): string {
  const before = items.find((i) => i.kind === "reminder" && i.slug === item.slug && i.n === item.n - 1);
  const afterBefore = before ? addDays(before.day, 1) : today;
  return afterBefore > today ? afterBefore : today;
}
