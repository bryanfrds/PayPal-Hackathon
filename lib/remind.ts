// The safe reminder delivery: has PayPal email a customer a reminder about one invoice, with its
// Pay button. It asks PayPal where the invoice stands first and only reminds about money still
// owed, and holds back a second reminder for the same invoice too soon.
//
// Called in-process by the owner's Email button (/api/invoices/[id]/remind) and by the reminder
// scheduler (/api/reminders/...). Callers must have checked the owner is signed in.
// PayPal's remind call takes no idempotency key, so this never retries it.

import "server-only";
import { paymentDb } from "./payment-db";
import { paypalFailure } from "./paypal-failure";
import { invoiceFacts, noReminderReason, type NoReminder } from "./payments";
import { getInvoice, PayPalError, remindInvoice } from "./paypal";

const ID = /^[A-Za-z0-9-]{5,64}$/;

/** PayPal allows two reminders a day per invoice; one every 12 hours is plenty for a customer. */
const MIN_GAP_MS = 12 * 60 * 60 * 1000;

export type RemindOutcome =
  | { ok: true; status: string }
  | {
      ok: false;
      /** The HTTP status that fits, for routes that pass the outcome on. */
      httpStatus: number;
      error: string;
      /** A reminder for this invoice went out within the last 12 hours. */
      alreadySent?: true;
      /** PayPal didn't answer clearly, so this reminder may have gone out. */
      maybeSent?: true;
      reason?: NoReminder;
      status?: string;
    };

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

export async function sendInvoiceReminder(id: string): Promise<RemindOutcome> {
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, httpStatus: 400, error: "Unknown invoice." };

  const hold = holds();
  let claimed: boolean;
  try {
    claimed = await hold.claim(id);
  } catch (error) {
    console.error("Reminder: couldn't check the hold:", error instanceof Error ? error.message : error);
    return { ok: false, httpStatus: 503, error: "Couldn't check whether a reminder just went out. Try again." };
  }
  if (!claimed) {
    return {
      ok: false,
      httpStatus: 409,
      error: "PayPal already emailed this customer a reminder for this invoice in the last 12 hours.",
      alreadySent: true,
    };
  }
  // Only for answers that prove nothing was sent. Awaited: on Vercel, work left running after
  // the response may never finish, and a stuck hold would block the owner for 12 hours.
  const release = async () => {
    try {
      await hold.release(id);
    } catch (error) {
      console.error("Reminder: couldn't release the hold:", error instanceof Error ? error.message : error);
    }
  };

  let facts;
  try {
    facts = invoiceFacts(await getInvoice(id));
  } catch (error) {
    await release();
    console.error("Reminder: invoice lookup failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    if (paypal?.status === 404) return { ok: false, httpStatus: 404, error: "PayPal has no invoice with that id." };
    const failure = paypalFailure(paypal);
    return { ok: false, httpStatus: failure.status, error: failure.message };
  }

  const reason = noReminderReason(facts);
  if (reason) {
    await release();
    return { ok: false, httpStatus: 409, error: WHY_NOT[reason], reason, status: facts.status };
  }

  try {
    await remindInvoice(id);
  } catch (error) {
    console.error("Reminder: PayPal's remind call failed:", error instanceof Error ? error.message : error);
    const paypal = error instanceof PayPalError ? error : null;
    // No answer, or a PayPal server error: it may have gone out, so it stays held back rather
    // than risk a second email. Only a 4xx is a clear "not sent".
    const status = paypal?.status ?? 0;
    if (status < 400 || status >= 500) {
      return {
        ok: false,
        httpStatus: 502,
        error: "PayPal didn't answer, so the reminder may have gone out. Check before sending another.",
        maybeSent: true,
      };
    }
    await release();
    const failure = paypalFailure(paypal);
    return { ok: false, httpStatus: failure.status, error: failure.status === 422 ? "PayPal didn't accept this reminder." : failure.message };
  }

  return { ok: true, status: facts.status };
}

/**
 * The scheduler's view of a delivery (lib/reminder-scheduler.ts SchedulerDeps.sendReminder).
 * A reminder that may have gone out, or went out recently, counts as sent: the scheduler then
 * counts it towards its attempts and interval, so the customer isn't emailed again too soon.
 */
export async function deliverScheduledReminder(id: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const outcome = await sendInvoiceReminder(id);
  if (outcome.ok) return { ok: true, message: "PayPal emailed the reminder." };
  if (outcome.maybeSent || outcome.alreadySent) return { ok: true, message: outcome.error };
  return { ok: false, error: outcome.error };
}
