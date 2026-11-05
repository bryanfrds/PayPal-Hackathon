// GET /api/debts/approved: List approved debts ready for invoicing
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const store = getPerson1Store();
  const approvedDebts = await store.getApprovedDebts(owner.email);

  return NextResponse.json({ approvedDebts });
}
