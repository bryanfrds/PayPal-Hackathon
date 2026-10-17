// POST /api/reminders/[id]/approve: Explicitly approves a pending reminder
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id: decisionId } = await params;
  const store = getPerson1Store();

  const decision = await store.getReminderDecision(owner.email, decisionId);
  if (!decision) {
    return NextResponse.json({ error: "Reminder decision not found." }, { status: 404 });
  }

  if (decision.action !== "pending_approval") {
    return NextResponse.json(
      { error: `Decision cannot be approved because its state is "${decision.action}".` },
      { status: 409 },
    );
  }

  // Trigger safe delivery to Person 2
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const cookie = req.headers.get("cookie") || "";

  try {
    const res = await fetch(`${protocol}://${host}/api/invoices/${decision.invoiceId}/remind`, {
      method: "POST",
      headers: { cookie },
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      await store.updateReminderDecisionAction(owner.email, decisionId, "requested", "Approved by owner and sent");
      return NextResponse.json({ ok: true, status: "requested", message: "Reminder approved and delivered." });
    } else {
      await store.updateReminderDecisionAction(owner.email, decisionId, "failed", data.error || "Delivery refused");
      return NextResponse.json({ ok: false, error: data.error || "Delivery failed" }, { status: 502 });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Delivery connection error";
    await store.updateReminderDecisionAction(owner.email, decisionId, "failed", errorMsg);
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 502 });
  }
}
