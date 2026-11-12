// POST /api/entries/[id]/confirm-customer: Explicitly links an entry to a confirmed customer
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id: entryId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  if (!customerId) {
    return NextResponse.json({ error: "customerId is required." }, { status: 400 });
  }

  const store = getPerson1Store();
  const entry = await store.getEntry(owner.email, entryId);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  const customer = await store.getCustomer(owner.email, customerId);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  // Confirm customer if not confirmed yet
  const confirmedCust = await store.confirmCustomer(owner.email, customerId);

  // Link entry to confirmed customer and use confirmed customer's official name
  const updatedEntry = await store.updateEntry(owner.email, entryId, {
    confirmedCustomerId: customer.id,
    customerName: customer.name,
    ownerEdited: true,
  });

  return NextResponse.json({
    entry: updatedEntry,
    customer: confirmedCust,
  });
}
