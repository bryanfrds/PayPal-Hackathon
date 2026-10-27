// PATCH /api/customers/[id]: Update customer contact information
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";
import { validateCustomerInput } from "@/lib/person1-validation";
import { clientIp, createThrottle } from "@/lib/throttle";

const writes = createThrottle(30, 60_000);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const wait = writes.hit(`${owner.email}:${clientIp(req)}`);
  if (wait) return NextResponse.json({ error: "Too many customer changes." }, { status: 429, headers: { "Retry-After": String(wait) } });

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

  const parsed = validateCustomerInput(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch = Object.fromEntries(Object.entries(parsed.value).filter(([, value]) => value !== undefined));

  const updated = await store.updateCustomer(owner.email, id, patch);
  return NextResponse.json(updated);
}
