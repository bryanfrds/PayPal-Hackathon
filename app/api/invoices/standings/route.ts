// What the payments database last heard from PayPal about the device's invoices: within
// seconds of a payment when the webhook is set up. Cheap (no PayPal call), so the app can ask
// often; app/PaymentSync.tsx applies the answers with the same rules as its own PayPal check.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb, within } from "@/lib/payment-db";

const MAX_IDS = 100;
const ID = /^[A-Za-z0-9-]{5,64}$/;

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const ids = (raw as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && ID.test(id))) {
    return NextResponse.json({ error: `Send 1 to ${MAX_IDS} invoice ids.` }, { status: 400 });
  }

  const db = paymentDb();
  // No database: the app keeps checking PayPal itself, as before.
  if (!db) return NextResponse.json({ available: false, webhook: false, results: [] });

  try {
    const [results, webhookWorks] = await within(
      Promise.all([
        // Only invoices this owner sent, even if someone else knows the ids.
        db.latestFacts(owner.email, [...new Set(ids as string[])]),
        // Set up is not enough: PayPal must actually have called in the last day.
        process.env.PAYPAL_WEBHOOK_ID?.trim() ? db.webhookSeenSince(24) : Promise.resolve(false),
      ]),
    );
    return NextResponse.json({ available: true, webhook: webhookWorks, results });
  } catch (error) {
    console.error("POST /api/invoices/standings failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't read payments just now." }, { status: 503 });
  }
}
