// PayPal's webhook: PayPal calls this when one of our invoices is paid, cancelled, refunded
// or changed, so the payments database knows within seconds, even with the app closed.
//
// Safe against forged, repeated and out-of-order deliveries:
// - every delivery is checked with PayPal (verify-webhook-signature) before anything else;
// - each event id is handled once (paypal_events), so a redelivery is a no-op;
// - the event's own copy of the invoice is never trusted: the invoice is read fresh from
//   PayPal, and the database only takes answers newer than what it has.
// Answers non-2xx only when PayPal should try again.
//
// Setup: register <site>/api/paypal/webhook in the PayPal app for the INVOICING.INVOICE.*
// events and put its id in PAYPAL_WEBHOOK_ID. Needs DATABASE_URL.

import { NextResponse } from "next/server";
import { paymentDb } from "@/lib/payment-db";
import { invoiceFacts } from "@/lib/payments";
import { getInvoice, PayPalError, verifyWebhook } from "@/lib/paypal";

const INVOICE_ID = /^INV2-[A-Z0-9-]{5,40}$/;

type WebhookEvent = { id?: unknown; event_type?: unknown; resource?: Record<string, unknown> };

/** The invoice an INVOICING event is about: PayPal puts it at resource.invoice, or resource itself. */
function invoiceIdOf(event: WebhookEvent): string | null {
  const resource = event.resource ?? {};
  const invoice = (typeof resource.invoice === "object" && resource.invoice !== null ? resource.invoice : resource) as Record<string, unknown>;
  return typeof invoice.id === "string" && INVOICE_ID.test(invoice.id) ? invoice.id : null;
}

export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  const db = paymentDb();
  if (!webhookId || !db) {
    console.error("PayPal webhook received but PAYPAL_WEBHOOK_ID or DATABASE_URL isn't set.");
    return NextResponse.json({ error: "Not set up." }, { status: 503 });
  }

  const rawBody = await request.text();
  // PayPal's invoice events are a few KB; anything far bigger isn't one.
  if (rawBody.length > 200_000) return NextResponse.json({ error: "Too big." }, { status: 413 });
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.event_type !== "string") {
    return NextResponse.json({ error: "Not a PayPal event." }, { status: 400 });
  }

  let verified: boolean;
  try {
    verified = await verifyWebhook({ webhookId, headers: request.headers, rawBody });
  } catch (error) {
    console.error("PayPal webhook: couldn't verify:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't check with PayPal." }, { status: 503 });
  }
  if (!verified) {
    console.error("PayPal webhook: a delivery failed verification.");
    return NextResponse.json({ error: "Not verified." }, { status: 400 });
  }

  const eventId = event.id;
  const invoiceId = event.event_type.startsWith("INVOICING.INVOICE.") ? invoiceIdOf(event) : null;
  if (!(await db.recordEvent(eventId, event.event_type, invoiceId))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    let outcome = "ignored";
    if (invoiceId) {
      // Timed before the read, like the app's check, so the newer-wins rule compares like with like.
      const readAt = new Date();
      const facts = invoiceFacts(await getInvoice(invoiceId));
      const settlement = await db.saveFacts(invoiceId, facts, readAt, "webhook");
      outcome = settlement ?? "not ours or older";
    }
    await db.finishEvent(eventId, outcome);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    console.error(`PayPal webhook: event ${eventId} failed:`, error instanceof Error ? error.message : error);
    // An invoice PayPal doesn't have won't appear on a retry either: done.
    if (error instanceof PayPalError && error.status === 404) {
      await db.finishEvent(eventId, "invoice not found").catch(() => {});
      return NextResponse.json({ ok: true, outcome: "invoice not found" });
    }
    // Anything else: forget it so PayPal's retry gets a fresh try.
    await db.forgetEvent(eventId).catch(() => {});
    return NextResponse.json({ error: "Not handled." }, { status: 500 });
  }
}
