// Sends one customer's PayPal invoice for the Collect screen. Thin glue over Person 2's
// lib/paypal.ts: create the draft (idempotent by requestId), send it, and return what the
// screen needs. Retrying with the same requestId never makes a second invoice, and an
// invoice that already went out isn't sent again.

import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/collect";
import { MAX_AMOUNT_SEN, MAX_NAME_LENGTH } from "@/lib/debts";
import { createDraftInvoice, getInvoice, getPayerLink, PayPalError, sendInvoice } from "@/lib/paypal";
import { paypalFailure } from "./errors";

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
    // A retry returns the invoice from the first try; only send it if it's still a draft.
    const current = draft.status ? draft : await getInvoice(draft.id);
    let payerLink: string | undefined;
    if (current.status === undefined || current.status === "DRAFT") payerLink = await sendInvoice(draft.id);
    let number = current.detail?.invoice_number;
    try {
      const sent = await getInvoice(draft.id);
      number = sent.detail?.invoice_number ?? number;
      payerLink ??= getPayerLink(sent);
    } catch {
      // The invoice is sent; the number and link are nice-to-haves.
    }
    return NextResponse.json({ id: draft.id, number, payerLink });
  } catch (error) {
    const failure = paypalFailure(error instanceof PayPalError ? error : null);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
