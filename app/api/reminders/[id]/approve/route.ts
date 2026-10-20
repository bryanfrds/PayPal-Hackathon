// POST /api/reminders/[id]/approve: Explicitly approves a pending reminder
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";
import { deliverScheduledReminder } from "@/lib/remind";

export async function POST(
  _req: Request,
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

  const claimed = await store.claimPendingReminder(owner.email, decisionId);
  if (!claimed) return NextResponse.json({ error: "Reminder was already taken for delivery." }, { status: 409 });

  // Person 2's safe delivery, called in-process.
  try {
    const delivery = await deliverScheduledReminder(decision.invoiceId);

    if (delivery.ok) {
      await store.updateReminderDecisionAction(owner.email, decisionId, "requested", delivery.message || "Approved by owner and sent");
      return NextResponse.json({ ok: true, status: "requested", message: delivery.message || "Reminder approved and delivered." });
    } else {
      await store.updateReminderDecisionAction(owner.email, decisionId, "failed", delivery.error || "Delivery refused");
      return NextResponse.json({ ok: false, error: delivery.error || "Delivery failed" }, { status: 502 });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Delivery connection error";
    await store.updateReminderDecisionAction(owner.email, decisionId, "failed", errorMsg);
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 502 });
  }
}
