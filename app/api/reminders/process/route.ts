// POST /api/reminders/process: Triggers a scheduled reminder evaluation pass
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb } from "@/lib/payment-db";
import { getPerson1Store } from "@/lib/person1-store";
import { deliverScheduledReminder } from "@/lib/remind";
import { processEligibleReminders, type InvoiceCandidate, type SchedulerDeps } from "@/lib/reminder-scheduler";

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let body: { candidateInvoices?: InvoiceCandidate[] } = {};
  try {
    body = await req.json();
  } catch {}

  const store = getPerson1Store();
  const db = paymentDb();

  const deps: SchedulerDeps = {
    store,
    getInvoices: async () => {
      if (body.candidateInvoices && Array.isArray(body.candidateInvoices)) {
        return body.candidateInvoices;
      }
      return [];
    },
    // Person 2's safe delivery, called in-process.
    sendReminder: deliverScheduledReminder,
  };

  const outcome = await processEligibleReminders(owner.email, deps);
  return NextResponse.json(outcome);
}
