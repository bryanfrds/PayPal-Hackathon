// The WhatsApp message a shop sends a customer about their tab. Pure functions so the
// wording, item list and link can be tested in Node.
//
// The link is only ever the customer's PayPal pay link: our own /tab page only works on
// the owner's device, so it's never put in a message.

import type { InvoiceRecord } from "./collect-store";
import { isPayPalUrl } from "./customer-pay";
import { customerSlug } from "./customer-tab";
import { formatSen, type Debt } from "./debts";
import { DEFAULT_LANGUAGE, translate, translator, type Language, type T } from "./i18n";

export type Tone = "friendly" | "polite" | "firm";

/** The tones; their names and hints are the keys tone.<id> and tone.<id>.hint. */
export const TONES: { id: Tone; emoji: string }[] = [
  { id: "friendly", emoji: "🙂" },
  { id: "polite", emoji: "🤝" },
  { id: "firm", emoji: "📌" },
];

export const MAX_ITEMS_NAMED = 3;

/** "Milo, gula, beras and 2 more" (in the message's language). Empty when there's nothing to name. */
export function itemSummary(items: string[], max = MAX_ITEMS_NAMED, t: T = translator()): string {
  const names = items.map((s) => s.trim()).filter(Boolean);
  const sep = t("msg.items.sep");
  if (names.length === 0) return "";
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return t("msg.items.two", { a: names[0], b: names[1] });
    return t("msg.items.list", { list: names.slice(0, -1).join(sep), last: names[names.length - 1] });
  }
  return t("msg.items.more", { list: names.slice(0, max).join(sep), count: names.length - max });
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
  /** The message's language; English when left out. */
  language?: Language;
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
  const lang = input.language ?? DEFAULT_LANGUAGE;
  const t: T = (key, vars) => translate(lang, key, vars);
  const name = plainName(input.customerName) || t("msg.nameFallback");
  const shop = plainName(input.shopName) || t("msg.shopFallback");
  const amount = `*RM ${formatSen(input.owedSen)}*`;
  const list = itemSummary(input.items.map(plainName), MAX_ITEMS_NAMED, t);
  const what = list ? `${amount} (${list})` : amount;
  const pay = input.pay && isPayPalUrl(input.pay.link) ? input.pay : undefined;
  const link = pay?.link;

  const intro = t(`msg.${input.tone}.intro`, { name, shop, what });
  // An invoice for only part of the tab says so, rather than "pay your tab" for less than is owed.
  const payLine =
    pay && !pay.full ? t("msg.partialPayLine", { amount: `RM ${formatSen(pay.amountSen)}` }) : t(`msg.${input.tone}.payLine`);
  const closing = t("msg.closing");

  const parts = [intro];
  if (link) parts.push(`${payLine} ${link}`);
  parts.push(closing);
  return {
    intro,
    payLine: link ? payLine : undefined,
    link,
    linkSen: pay?.amountSen,
    closing,
    text: parts.join("\n\n"),
  };
}

/** WhatsApp's share link: it opens WhatsApp with the text filled in and asks who to send it to. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * The link to put in the message (if any) and the note to show when there isn't one, in words
 * that are true for each case (keys share.noLink.*). `payLinkOn` is the "Add PayPal pay link" setting.
 */
export function chooseLink(lookup: PayLinkLookup, payLinkOn: boolean, t: T = translator()): { pay?: PayLink; note?: string } {
  if (!payLinkOn) return { note: t("share.noLink.off") };
  if (lookup.pay) return { pay: lookup.pay };
  return { note: t(`share.noLink.${lookup.reason}`) };
}
