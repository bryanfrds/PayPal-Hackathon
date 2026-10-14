// Sends one customer's PayPal invoice for the Collect screen. Thin glue over Person 2's
// lib/paypal.ts: create the draft (idempotent by requestId), send it, and return what the
// screen needs. Retrying with the same requestId never makes a second invoice, and an
// invoice that already went out isn't sent again.

import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/collect";
import { MAX_AMOUNT_SEN, MAX_NAME_LENGTH } from "@/lib/debts";
import { createDraftInvoice, getInvoice, getPayerLink, PayPalError, sendInvoice } from "@/lib/paypal";
import { paypalFailure } from "./errors";
import { requireOwner } from "@/lib/auth-server";

/** Statuses that mean the invoice has gone out to the customer. */
const OUT = new Set(["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING", "PAID", "MARKED_AS_PAID"]);

type Body = {
  customerName: string;
  email: string;
  lines: { name: string; amountSen: number }[];
  requestId: string;
};

function parseBody(value: unknown): Body | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = typeof v.customerName === "string" ? v.customerName.trim() : "";
  const email = typeof v.email === "string" ? v.email.trim() : "";
  const requestId = typeof v.requestId === "string" ? v.requestId : "";
  if (!name || name.length > MAX_NAME_LENGTH || !isValidEmail(email) || !/^buku-[0-9a-f]{16}$/.test(requestId)) return null;
  if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > 100) return null;
  const lines: Body["lines"] = [];
  for (const line of v.lines) {
    const l = line as Record<string, unknown>;
    if (typeof l?.name !== "string" || !l.name.trim() || l.name.length > 200) return null;
    if (typeof l.amountSen !== "number" || !Number.isInteger(l.amountSen) || l.amountSen <= 0 || l.amountSen > MAX_AMOUNT_SEN) return null;
    lines.push({ name: l.name.trim(), amountSen: l.amountSen });
  }
  return { customerName: name, email, lines, requestId };
}

export async function POST(request: Request) {
  // Only the signed-in shop owner (proxy.ts checks too).
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: "That invoice is missing a name, email or amount." }, { status: 400 });

  try {
    const draft = await createDraftInvoice({
      recipientEmail: body.email,
      recipientName: body.customerName,
      items: body.lines.map((l) => ({ name: l.name, amount: l.amountSen / 100 })),
      requestId: body.requestId,
    });
    // A retry gets back the create response from the first try, which can still say DRAFT
    // after that try sent it. So always ask PayPal where the invoice stands now.
    let current = await getInvoice(draft.id);
    if (current.status === "DRAFT") {
      try {
        await sendInvoice(draft.id);
      } catch (error) {
        // Sent by a request that's still finishing? Check again before calling it a failure.
        const again = await getInvoice(draft.id);
        if (!OUT.has(again.status ?? "")) throw error;
      }
      current = await getInvoice(draft.id);
    }
    if (!OUT.has(current.status ?? "")) {
      return NextResponse.json(
        { error: "This invoice was cancelled on PayPal. Check it there before sending again." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      id: draft.id,
      number: current.detail?.invoice_number,
      payerLink: getPayerLink(current),
    });
  } catch (error) {
    // Messages from lib/paypal.ts are already redacted; this keeps PayPal's debug id for us.
    console.error("POST /api/invoices failed:", error instanceof Error ? error.message : error);
    const failure = paypalFailure(error instanceof PayPalError ? error : null);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
