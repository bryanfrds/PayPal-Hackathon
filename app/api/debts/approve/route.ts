// POST /api/debts/approve: Approves reviewed draft entries and gates them for Person 2's invoicing
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { approveDebtsForInvoicing } from "@/lib/debt-handoff";
import { getPerson1Store } from "@/lib/person1-store";

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const rawIds = body.entryIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "entryIds must be a non-empty array of strings." }, { status: 400 });
  }

  const store = getPerson1Store();
  const result = await approveDebtsForInvoicing(owner.email, rawIds, store);

  return NextResponse.json(result);
}
