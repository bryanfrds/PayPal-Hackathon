// POST /api/reminders/process: Triggers a scheduled reminder evaluation pass
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { paymentDb } from "@/lib/payment-db";
import { getPerson1Store } from "@/lib/person1-store";
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
    sendReminder: async (invoiceId: string) => {
      // Delegate safely to Person 2's remind endpoint internally
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.startsWith("localhost") ? "http" : "https";
      try {
        const cookie = req.headers.get("cookie") || "";
        const res = await fetch(`${protocol}://${host}/api/invoices/${invoiceId}/remind`, {
          method: "POST",
          headers: { cookie },
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, message: data.message || "Delivered", error: data.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Delivery call failed" };
      }
    },
  };

  const outcome = await processEligibleReminders(owner.email, deps);
  return NextResponse.json(outcome);
}
