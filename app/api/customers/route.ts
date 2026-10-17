// GET & POST /api/customers: Customer directory management
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { customerSlug } from "@/lib/customer-tab";
import { getPerson1Store } from "@/lib/person1-store";
import type { CustomerRecord } from "@/lib/person1-types";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const store = getPerson1Store();
  const list = await store.listCustomers(owner.email);
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  }

  const slug = customerSlug(name);
  const store = getPerson1Store();

  const existing = await store.getCustomerBySlug(owner.email, slug);
  if (existing) {
    return NextResponse.json(
      { error: `A customer named "${existing.name}" already exists.`, customer: existing },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const customer: CustomerRecord = {
    id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ownerEmail: owner.email,
    name,
    slug,
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await store.saveCustomer(customer);
  return NextResponse.json(customer, { status: 201 });
}
