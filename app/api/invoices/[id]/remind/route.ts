// The owner's Email button: has PayPal email a customer a reminder about one invoice. The safe
// delivery itself (status check first, hold against repeats) is lib/remind.ts.
//
// The device decides when a reminder is due (lib/reminders.ts) and records it as sent.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { sendInvoiceReminder } from "@/lib/remind";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  const outcome = await sendInvoiceReminder(id);
  if (outcome.ok) return NextResponse.json({ ok: true, status: outcome.status });
  const { ok: _ok, httpStatus, ...body } = outcome;
  return NextResponse.json(body, { status: httpStatus });
}
