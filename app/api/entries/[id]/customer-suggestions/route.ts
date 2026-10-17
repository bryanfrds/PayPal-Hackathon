// GET /api/entries/[id]/customer-suggestions: Suggests directory matches for an entry
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { findCustomerSuggestions } from "@/lib/customer-matching";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id: entryId } = await params;
  const store = getPerson1Store();

  const entry = await store.getEntry(owner.email, entryId);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  const directory = await store.listCustomers(owner.email);
  const suggestions = findCustomerSuggestions(entry.customerName, directory);

  return NextResponse.json({
    entryId: entry.id,
    customerName: entry.customerName,
    suggestions,
  });
}
