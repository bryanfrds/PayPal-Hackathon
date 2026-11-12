// POST /api/reminders/[id]/reject: Rejects a pending reminder
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

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
      { error: `Decision cannot be rejected because its state is "${decision.action}".` },
      { status: 409 },
    );
  }

  const rejected = await store.rejectPendingReminder(owner.email, decisionId, "Rejected by owner");
  if (!rejected) {
    return NextResponse.json(
      { error: "Decision cannot be rejected because its state is no longer pending approval." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: "skipped", message: "Reminder rejected." });
}
