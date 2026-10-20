import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb } from "@/lib/payment-db";
import { getPerson1Store } from "@/lib/person1-store";
import { deliverScheduledReminder } from "@/lib/remind";
import { processEligibleReminders, type InvoiceCandidate, type SchedulerDeps } from "@/lib/reminder-scheduler";

export const maxDuration = 60;

async function processOwner(ownerEmail: string, candidateInvoices?: InvoiceCandidate[], enforceSendHour = false) {
  const store = getPerson1Store();
  const db = paymentDb();

  const deps: SchedulerDeps = {
    store,
    enforceSendHour,
    getInvoices: async () => {
      if (candidateInvoices && Array.isArray(candidateInvoices)) {
        return candidateInvoices;
      }
      if (db) {
        return (await db.listOwnerInvoices(ownerEmail)).map((invoice): InvoiceCandidate => ({
          id: invoice.id,
          customerName: invoice.customerName,
          dueDate: invoice.sentAt.slice(0, 10),
          amountSen: invoice.amountSen,
          status: invoice.status,
          settlement: invoice.settlement,
        }));
      }
      return [];
    },
    // Person 2's safe delivery, called in-process.
    sendReminder: deliverScheduledReminder,
  };
  return processEligibleReminders(ownerEmail, deps);
}

export async function POST(req?: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let candidateInvoices: InvoiceCandidate[] | undefined;
  if (req) {
    try {
      const body = await req.json();
      if (Array.isArray(body.candidateInvoices)) {
        candidateInvoices = body.candidateInvoices;
      }
    } catch {}
  }

  try {
    return NextResponse.json(await processOwner(owner.email, candidateInvoices));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reminder processing failed." },
      { status: 503 },
    );
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized scheduler request." }, { status: 401 });
  }
  const store = getPerson1Store();
  const owners = await store.listEnabledReminderOwners();
  const results = [];
  for (const ownerEmail of owners) {
    try {
      results.push({ ownerEmail, ok: true, outcome: await processOwner(ownerEmail, undefined, false) });
    } catch (error) {
      results.push({ ownerEmail, ok: false, error: error instanceof Error ? error.message : "Failed" });
    }
  }
  return NextResponse.json({ processedOwners: owners.length, results });
}
