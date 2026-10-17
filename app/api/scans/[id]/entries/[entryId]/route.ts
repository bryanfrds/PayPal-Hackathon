// PATCH /api/scans/[id]/entries/[entryId]: Updates an owner's corrections on an entry
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id: scanId, entryId } = await params;
  const store = getPerson1Store();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const existing = await store.getEntry(owner.email, entryId);
  if (!existing || existing.scanId !== scanId) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  const patch: Record<string, unknown> = { ownerEdited: true };
  if (typeof body.customerName === "string") patch.customerName = body.customerName.trim();
  if (typeof body.item === "string") patch.item = body.item.trim();
  if (typeof body.amountSen === "number") patch.amountSen = body.amountSen;
  if (typeof body.date === "string") patch.date = body.date;
  if (typeof body.included === "boolean") patch.included = body.included;
  if (typeof body.isAmbiguous === "boolean") {
    patch.isAmbiguous = body.isAmbiguous;
    if (!body.isAmbiguous) patch.ambiguityReason = undefined;
  }
  if (typeof body.confirmedCustomerId === "string") {
    patch.confirmedCustomerId = body.confirmedCustomerId;
  }

  const updated = await store.updateEntry(owner.email, entryId, patch);
  return NextResponse.json(updated);
}
