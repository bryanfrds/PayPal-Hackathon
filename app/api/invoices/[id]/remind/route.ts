// Has PayPal email a customer a reminder about one invoice, with its Pay button. This is the
// safe reminder delivery: it asks PayPal where the invoice stands first and only reminds
// about money still owed, and holds back a second reminder for the same invoice too soon.
//
// The device decides when a reminder is due (lib/reminders.ts) and records it as sent.
// PayPal's remind call takes no idempotency key, so this route never retries it.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb } from "@/lib/payment-db";
import { invoiceFacts, noReminderReason, type NoReminder } from "@/lib/payments";
import { getInvoice, PayPalError, remindInvoice } from "@/lib/paypal";
import { paypalFailure } from "../../errors";

const ID = /^[A-Za-z0-9-]{5,64}$/;

/** PayPal allows two reminders a day per invoice; one every 12 hours is plenty for a customer. */
const MIN_GAP_MS = 12 * 60 * 60 * 1000;

// A send is held before PayPal is asked, so two requests at once (double tap, two tabs, two
// phones) can't both go through. In the payments database when there is one, so the hold covers
// every server instance; otherwise per instance, in memory. The device's own "sent" record is
// what spaces reminders out.
type Holds = { claim(id: string): Promise<boolean>; release(id: string): Promise<void> };

const lastReminded = new Map<string, number>();
const memoryHolds: Holds = {
  async claim(id) {
    const now = Date.now();
    const at = lastReminded.get(id);
    if (at !== undefined && now - at < MIN_GAP_MS) return false;
    if (lastReminded.size > 5000) {
      for (const [key, t] of lastReminded) if (now - t >= MIN_GAP_MS) lastReminded.delete(key);
    }
    lastReminded.set(id, now);
    return true;
  },
  async release(id) {
    lastReminded.delete(id);
  },
};

function holds(): Holds {
  const db = paymentDb();
  if (!db) return memoryHolds;
  return { claim: (id) => db.claimReminder(id, MIN_GAP_MS), release: (id) => db.releaseReminder(id) };
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

  const hold = holds();
  let claimed: boolean;
  try {
    claimed = await hold.claim(id);
  } catch (error) {
    console.error("POST /api/invoices/[id]/remind: couldn't check the hold:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't check whether a reminder just went out. Try again." }, { status: 503 });
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "PayPal already emailed this customer a reminder for this invoice in the last 12 hours.", alreadySent: true },
      { status: 409 },
    );
  }
  // Only for answers that prove nothing was sent.
  const release = () => {
    hold.release(id).catch((error: unknown) => console.error("POST /api/invoices/[id]/remind: couldn't release the hold:", error instanceof Error ? error.message : error));
  };

  let facts;
  try {
    facts = invoiceFacts(await getInvoice(id));
  } catch (error) {
    release();
    console.error("POST /api/invoices/[id]/remind lookup failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    if (paypal?.status === 404) return NextResponse.json({ error: "PayPal has no invoice with that id." }, { status: 404 });
    const failure = paypalFailure(paypal);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }

  const reason = noReminderReason(facts);
  if (reason) {
    release();
    return NextResponse.json({ error: WHY_NOT[reason], reason, status: facts.status }, { status: 409 });
  }

  try {
    await remindInvoice(id);
  } catch (error) {
    console.error("POST /api/invoices/[id]/remind failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    // No answer, or a PayPal server error: it may have gone out, so it stays held back rather
    // than risk a second email. Only a 4xx is a clear "not sent".
    const status = paypal?.status ?? 0;
    if (status < 400 || status >= 500) {
      return NextResponse.json(
        { error: "PayPal didn't answer, so the reminder may have gone out. Check before sending another.", maybeSent: true },
        { status: 502 },
      );
    }
    release();
    const failure = paypalFailure(paypal);
    return NextResponse.json({ error: failure.status === 422 ? "PayPal didn't accept this reminder." : failure.message }, { status: failure.status });
  }

  return NextResponse.json({ ok: true, status: facts.status });
}
