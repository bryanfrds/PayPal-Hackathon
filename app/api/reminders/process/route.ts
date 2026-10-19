import { NextResponse } from "next/server";
import { sendReminderForOwner } from "@/app/api/invoices/[id]/remind/route";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb } from "@/lib/payment-db";
import { getPerson1Store } from "@/lib/person1-store";
import { processEligibleReminders, type InvoiceCandidate, type SchedulerDeps } from "@/lib/reminder-scheduler";

export const maxDuration = 60;

async function processOwner(ownerEmail: string, enforceSendHour = false) {
  const store = getPerson1Store();
  const db = paymentDb();
  if (!db) throw new Error("Database is required for scheduled reminders.");
  const deps: SchedulerDeps = {
    store,
    enforceSendHour,
    getInvoices: async () => (await db.listOwnerInvoices(ownerEmail)).map((invoice): InvoiceCandidate => ({
      id: invoice.id, customerName: invoice.customerName, dueDate: invoice.sentAt.slice(0, 10),
      amountSen: invoice.amountSen, status: invoice.status, settlement: invoice.settlement,
    })),
    sendReminder: async (invoiceId) => {
      const res = await sendReminderForOwner(ownerEmail, invoiceId);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, message: data.message || "Delivered", error: data.error };
    },
  };
  return processEligibleReminders(ownerEmail, deps);
}

export async function POST(_req?: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  try { return NextResponse.json(await processOwner(owner.email)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reminder processing failed." }, { status: 503 }); }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized scheduler request." }, { status: 401 });
  const store = getPerson1Store();
  const owners = await store.listEnabledReminderOwners();
  const results = [];
  for (const ownerEmail of owners) {
    try { results.push({ ownerEmail, ok: true, outcome: await processOwner(ownerEmail, true) }); }
    catch (error) { results.push({ ownerEmail, ok: false, error: error instanceof Error ? error.message : "Failed" }); }
  }
  return NextResponse.json({ processedOwners: owners.length, results });
}
