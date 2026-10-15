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

export const TONES: { id: Tone; label: string; hint: string }[] = [
  { id: "friendly", label: "Friendly", hint: "First nudge" },
  { id: "polite", label: "Polite", hint: "Gentle follow-up" },
  { id: "firm", label: "Firm", hint: "Long overdue" },
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

/**
 * The PayPal pay link for this customer's newest sent invoice that still covers an unpaid
 * debt. Undefined when there's no such invoice or its link isn't a PayPal https page.
 */
export function payLinkFor(invoices: InvoiceRecord[], debts: Debt[], slug: string): string | undefined {
  const unpaid = new Set(debts.filter((d) => d.status !== "paid" && customerSlug(d.customerName) === slug).map((d) => d.id));
  const match = invoices
    .filter((r) => r.slug === slug && isPayPalUrl(r.payerLink) && r.debtIds.some((id) => unpaid.has(id)))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  return match?.payerLink;
}

export type ShareInput = {
  customerName: string;
  shopName: string;
  owedSen: number;
  items: string[];
  tone: Tone;
  /** A PayPal pay link; left out of the message when missing. */
  payLink?: string;
};

export type ShareMessage = {
  /** First paragraph. The amount is wrapped in *asterisks*, WhatsApp's bold. */
  intro: string;
  /** The words before the link, when there is one. */
  payLine?: string;
  link?: string;
  closing: string;
  /** Everything above as one message, paragraphs separated by a blank line. */
  text: string;
};

export function buildShareMessage(input: ShareInput): ShareMessage {
  const name = input.customerName.trim() || "there";
  const shop = input.shopName.trim();
  const amount = `*RM ${formatSen(input.owedSen)}*`;
  const list = itemSummary(input.items);
  const what = list ? `${amount} (${list})` : amount;
  const link = isPayPalUrl(input.payLink) ? input.payLink : undefined;

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

  const parts = [intro];
  if (link) parts.push(`${payLine} ${link}`);
  parts.push(CLOSING);
  return {
    intro,
    payLine: link ? payLine : undefined,
    link,
    closing: CLOSING,
    text: parts.join("\n\n"),
  };
}

/** WhatsApp's share link: it opens WhatsApp with the text filled in and asks who to send it to. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
