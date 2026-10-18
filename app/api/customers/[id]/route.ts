// PATCH /api/customers/[id]: Update customer contact information
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const store = getPerson1Store();
  const existing = await store.getCustomer(owner.email, id);
  if (!existing) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.email === "string") patch.email = body.email.trim();
  if (typeof body.phone === "string") patch.phone = body.phone.trim();
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();

  const updated = await store.updateCustomer(owner.email, id, patch);
  return NextResponse.json(updated);
}
