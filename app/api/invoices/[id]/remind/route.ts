// Has PayPal email a customer a reminder about one invoice, with its Pay button. This is the
// safe reminder delivery: it asks PayPal where the invoice stands first and only reminds
// about money still owed, and holds back a second reminder for the same invoice too soon.
//
// The device decides when a reminder is due (lib/reminders.ts) and records it as sent.
// PayPal's remind call takes no idempotency key, so this route never retries it.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { invoiceFacts, noReminderReason, type NoReminder } from "@/lib/payments";
import { getInvoice, PayPalError, remindInvoice } from "@/lib/paypal";
import { paypalFailure } from "../../errors";

const ID = /^[A-Za-z0-9-]{5,64}$/;

/** PayPal allows two reminders a day per invoice; one every 12 hours is plenty for a customer. */
const MIN_GAP_MS = 12 * 60 * 60 * 1000;

// Invoice id → when it was last reminded. Per server instance only, so it stops double taps
// and quick retries; the device's own "sent" record is what spaces reminders out.
const lastReminded = new Map<string, number>();

function recentlyReminded(id: string, now: number): boolean {
  const at = lastReminded.get(id);
  return at !== undefined && now - at < MIN_GAP_MS;
}

function remember(id: string, now: number) {
  if (lastReminded.size > 5000) {
    for (const [key, at] of lastReminded) if (now - at >= MIN_GAP_MS) lastReminded.delete(key);
  }
  lastReminded.set(id, now);
}

const WHY_NOT: Record<NoReminder, string> = {
  paid: "This invoice is already paid on PayPal, so no reminder was sent.",
  closed: "This invoice was cancelled or refunded on PayPal, so no reminder was sent.",
  pending: "The customer's payment is on its way on PayPal, so no reminder was sent.",
  unknown: "PayPal can't send a reminder for this invoice right now.",
};

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Unknown invoice." }, { status: 400 });

  const now = Date.now();
  if (recentlyReminded(id, now)) {
    return NextResponse.json({ error: "PayPal already emailed this customer a reminder for this invoice today." }, { status: 429 });
  }

  let facts;
  try {
    facts = invoiceFacts(await getInvoice(id));
  } catch (error) {
    console.error("POST /api/invoices/[id]/remind lookup failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    if (paypal?.status === 404) return NextResponse.json({ error: "PayPal has no invoice with that id." }, { status: 404 });
    const failure = paypalFailure(paypal);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }

  const reason = noReminderReason(facts);
  if (reason) return NextResponse.json({ error: WHY_NOT[reason], reason, status: facts.status }, { status: 409 });

  try {
    await remindInvoice(id);
  } catch (error) {
    console.error("POST /api/invoices/[id]/remind failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    // No answer at all: PayPal may have sent it, so treat it as sent rather than risk a second email.
    if (!paypal?.status) {
      remember(id, now);
      return NextResponse.json(
        { error: "PayPal didn't answer, so the reminder may have gone out. Check before sending another.", maybeSent: true },
        { status: 502 },
      );
    }
    const failure = paypalFailure(paypal);
    return NextResponse.json({ error: failure.status === 422 ? "PayPal didn't accept this reminder." : failure.message }, { status: failure.status });
  }

  remember(id, now);
  return NextResponse.json({ ok: true, status: facts.status });
}
