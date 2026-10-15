// The WhatsApp message a shop sends a customer about their tab. Pure functions so the
// wording, item list and link can be tested in Node.
//
// The link is only ever the customer's PayPal pay link: our own /tab page only works on
// the owner's device, so it's never put in a message.

import type { InvoiceRecord } from "./collect-store";
import { isPayPalUrl } from "./customer-pay";
import { customerSlug } from "./customer-tab";
import { formatSen, type Debt } from "./debts";

export type Tone = "friendly" | "polite" | "firm";

export const TONES: { id: Tone; emoji: string; label: string; hint: string }[] = [
  { id: "friendly", emoji: "🙂", label: "Friendly", hint: "First nudge" },
  { id: "polite", emoji: "🤝", label: "Polite", hint: "Gentle follow-up" },
  { id: "firm", emoji: "📌", label: "Firm", hint: "Long overdue" },
];

export const MAX_ITEMS_NAMED = 3;
export const CLOSING = "Terima kasih!";

/** "Milo, gula, beras and 2 more". Empty when there's nothing to name. */
export function itemSummary(items: string[], max = MAX_ITEMS_NAMED): string {
  const names = items.map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** Item names from a customer's unpaid debts, oldest first, blanks and repeats dropped. */
export function unpaidItems(debts: Debt[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const open = debts.filter((d) => d.status !== "paid").sort((a, b) => a.date.localeCompare(b.date));
  for (const debt of open) {
    const name = debt.item.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export type PayLink = {
  /** PayPal's page for the invoice. */
  link: string;
  /** What that invoice asks for, in sen. */
  amountSen: number;
  /** True when this one invoice covers everything the customer still owes, for exactly that amount. */
  full: boolean;
};

/** PayPal's last word says this invoice can't be paid any more (cancelled, refunded) or already is. */
function settled(record: InvoiceRecord): boolean {
  const settlement = record.standing?.settlement;
  return settlement === "closed" || settlement === "paid";
}

/**
 * Why a message has no pay link:
 * - none: nothing of theirs has been invoiced.
 * - not-on-device: invoiced, but this device has no PayPal link for it (the link is only
 *   saved when the invoice is sent from this device).
 * - over-billed: the invoice asks for more than they owe now.
 * - settled: PayPal shows the invoice as closed (cancelled or refunded) or already paid.
 */
export type NoLinkReason = "none" | "not-on-device" | "over-billed" | "settled";

export type PayLinkLookup = { pay: PayLink; reason?: undefined } | { pay?: undefined; reason: NoLinkReason };

/**
 * The PayPal pay link for this customer, or the reason there isn't one worth sending.
 *
 * Same rule as payPlan and reconcileDebts: if a debt was invoiced more than once, only its
 * newest invoice counts. Invoices PayPal says are closed or paid are skipped, so a cancelled
 * invoice's dead link is never sent. When several invoices are live, the newest is used.
 * Debts marked "unpaid" (not invoiced) are never matched, so an invoice left over from before a
 * reset of the sample tabs can't attach itself to a fresh debt with the same id. An invoice
 * asking for more than is owed is left out too.
 */
export function payLinkFor(invoices: InvoiceRecord[], debts: Debt[], slug: string): PayLinkLookup {
  const unpaid = debts.filter((d) => d.status !== "paid" && customerSlug(d.customerName) === slug);
  const invoiced = unpaid.filter((d) => d.status !== "unpaid");
  if (invoiced.length === 0) return { reason: "none" };
  const owedSen = unpaid.reduce((sum, d) => sum + d.amountSen, 0);

  const newestFor = new Map<string, InvoiceRecord>();
  for (const debt of invoiced) {
    const newest = invoices
      .filter((r) => r.debtIds.includes(debt.id))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (newest) newestFor.set(debt.id, newest);
  }

  const records = [...new Set(newestFor.values())];
  const live = records
    .filter((r) => !settled(r) && isPayPalUrl(r.payerLink))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  if (!live?.payerLink) {
    // Marked as invoiced with no record here, or an open invoice without a saved link.
    const missing = invoiced.some((d) => !newestFor.has(d.id)) || records.some((r) => !settled(r));
    return { reason: missing ? "not-on-device" : "settled" };
  }
  if (live.amountSen > owedSen) return { reason: "over-billed" };

  const coversAll = unpaid.every((d) => newestFor.get(d.id) === live);
  return { pay: { link: live.payerLink, amountSen: live.amountSen, full: coversAll && live.amountSen === owedSen } };
}

/** Names and items go in as typed, with *, _ and ~ turned into spaces, so WhatsApp doesn't make them bold, italic or struck through. */
export function plainName(name: string): string {
  return name.replace(/[*_~]/g, " ").replace(/\s+/g, " ").trim();
}

export type ShareInput = {
  customerName: string;
  shopName: string;
  owedSen: number;
  items: string[];
  tone: Tone;
  /** From payLinkFor; left out of the message when missing or not a PayPal page. */
  pay?: PayLink;
};

export type ShareMessage = {
  /** First paragraph. The amount is wrapped in *asterisks*, WhatsApp's bold. */
  intro: string;
  /** The words before the link, when there is one. */
  payLine?: string;
  link?: string;
  /** What the link's invoice asks for, in sen, when there's a link. */
  linkSen?: number;
  closing: string;
  /** Everything above as one message, paragraphs separated by a blank line. */
  text: string;
};

export function buildShareMessage(input: ShareInput): ShareMessage {
  const name = plainName(input.customerName) || "there";
  const shop = plainName(input.shopName) || "your shop";
  const amount = `*RM ${formatSen(input.owedSen)}*`;
  const list = itemSummary(input.items.map(plainName));
  const what = list ? `${amount} (${list})` : amount;
  const pay = input.pay && isPayPalUrl(input.pay.link) ? input.pay : undefined;
  const link = pay?.link;

  let intro: string;
  let payLine: string;
  switch (input.tone) {
    case "polite":
      intro = `Hello ${name}, this is ${shop}. A gentle reminder that your tab of ${what} is still open. Please settle it when you can.`;
      payLine = "You can pay with PayPal or card here:";
      break;
    case "firm":
      intro = `Hi ${name}, this is ${shop}. Your tab of ${what} is long overdue. Please pay it this week.`;
      payLine = "Pay with PayPal or card here:";
      break;
    default:
      intro = `Hi ${name}, ${shop} here 🙂 Just a friendly note: your tab is ${what}.`;
      payLine = "Pay easily with PayPal or card:";
  }

  // An invoice for only part of the tab says so, rather than "pay your tab" for less than is owed.
  if (pay && !pay.full) payLine = `RM ${formatSen(pay.amountSen)} of this can be paid here:`;

  const parts = [intro];
  if (link) parts.push(`${payLine} ${link}`);
  parts.push(CLOSING);
  return {
    intro,
    payLine: link ? payLine : undefined,
    link,
    linkSen: pay?.amountSen,
    closing: CLOSING,
    text: parts.join("\n\n"),
  };
}

/** WhatsApp's share link: it opens WhatsApp with the text filled in and asks who to send it to. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Why the message has no pay link, in words that are true for each case. */
export const NO_LINK_NOTE: Record<NoLinkReason | "off", string> = {
  none: "No PayPal invoice yet. Send one from Collect to add a pay link.",
  "not-on-device": "This tab's PayPal pay link isn't on this device, so the message has no link.",
  "over-billed": "The PayPal invoice is for more than they owe now, so the message has no link.",
  settled: "PayPal shows this invoice as paid or closed, so the message has no link.",
  off: "Pay links are turned off in Settings, so the message has no link.",
};

/**
 * The link to put in the message (if any) and the note to show when there isn't one.
 * `payLinkOn` is the owner's "Add PayPal pay link" setting.
 */
export function chooseLink(lookup: PayLinkLookup, payLinkOn: boolean): { pay?: PayLink; note?: string } {
  if (!payLinkOn) return { note: NO_LINK_NOTE.off };
  if (lookup.pay) return { pay: lookup.pay };
  return { note: NO_LINK_NOTE[lookup.reason] };
}
