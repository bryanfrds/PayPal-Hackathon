// Where a sent invoice stands on PayPal (sent, paid…), for the invoice tracking screen.
// Read-only: marking debts paid is Person 2's reconciliation.

import { NextResponse } from "next/server";
import { getInvoice, getPayerLink, PayPalError } from "@/lib/paypal";
import { paypalFailure } from "../errors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{5,64}$/.test(id)) return NextResponse.json({ error: "Unknown invoice." }, { status: 400 });
  try {
    const invoice = await getInvoice(id);
    return NextResponse.json({
      status: invoice.status ?? "UNKNOWN",
      number: invoice.detail?.invoice_number,
      payerLink: getPayerLink(invoice),
    });
  } catch (error) {
    const failure = paypalFailure(error instanceof PayPalError ? error : null);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
