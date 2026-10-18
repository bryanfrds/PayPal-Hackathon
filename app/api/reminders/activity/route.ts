// GET /api/reminders/activity: Returns scheduler activity and decision history
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));

  const store = getPerson1Store();
  const activity = await store.listReminderDecisions(owner.email, limit);

  return NextResponse.json({ activity });
}
