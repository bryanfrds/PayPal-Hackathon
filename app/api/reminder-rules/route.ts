// GET & PUT /api/reminder-rules: Owner reminder configuration
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";
import type { ReminderRuleRecord } from "@/lib/person1-types";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const store = getPerson1Store();
  const rules = await store.getReminderRules(owner.email);
  return NextResponse.json(rules);
}

export async function PUT(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const store = getPerson1Store();
  const current = await store.getReminderRules(owner.email);

  const updated: ReminderRuleRecord = {
    ...current,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    firstAfterDays:
      typeof body.firstAfterDays === "number" ? Math.max(0, Math.min(30, Math.round(body.firstAfterDays))) : current.firstAfterDays,
    minIntervalDays:
      typeof body.minIntervalDays === "number" ? Math.max(1, Math.min(30, Math.round(body.minIntervalDays))) : current.minIntervalDays,
    maxAttempts:
      typeof body.maxAttempts === "number" ? Math.max(1, Math.min(10, Math.round(body.maxAttempts))) : current.maxAttempts,
    sendHour:
      typeof body.sendHour === "number" ? Math.max(0, Math.min(23, Math.round(body.sendHour))) : current.sendHour,
    skipFridayPrayers:
      typeof body.skipFridayPrayers === "boolean" ? body.skipFridayPrayers : current.skipFridayPrayers,
    requireApproval:
      typeof body.requireApproval === "boolean" ? body.requireApproval : current.requireApproval,
    updatedAt: new Date().toISOString(),
  };

  await store.setReminderRules(updated);
  return NextResponse.json(updated);
}
