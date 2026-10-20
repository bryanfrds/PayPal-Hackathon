// PATCH /api/scans/[id]/entries/[entryId]: Updates an owner's corrections on an entry
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";
import { validateEntryPatch } from "@/lib/person1-validation";
import { clientIp, createThrottle } from "@/lib/throttle";

const writes = createThrottle(60, 60_000);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const wait = writes.hit(`${owner.email}:${clientIp(req)}`);
  if (wait) return NextResponse.json({ error: "Too many entry changes." }, { status: 429, headers: { "Retry-After": String(wait) } });

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

  const parsed = validateEntryPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = parsed.value;
  if (typeof body.amountSen === "number") {
    if (!Number.isInteger(body.amountSen) || body.amountSen <= 0 || body.amountSen > 100_000_000) {
      return NextResponse.json({ error: "amountSen must be a positive integer in sen (max 100,000,000)." }, { status: 400 });
    }
    patch.amountSen = body.amountSen;
  }
  if (typeof body.included === "boolean") patch.included = body.included;
  if (typeof body.isAmbiguous === "boolean") {
    patch.isAmbiguous = body.isAmbiguous;
    if (!body.isAmbiguous) patch.ambiguityReason = undefined;
  }
  if (typeof body.confirmedCustomerId === "string") {
    const custId = body.confirmedCustomerId.trim();
    if (custId) {
      const customer = await store.getCustomer(owner.email, custId);
      if (!customer) {
        return NextResponse.json({ error: "Customer not found." }, { status: 404 });
      }
      patch.confirmedCustomerId = custId;
    } else {
      patch.confirmedCustomerId = undefined;
    }
  }

  const updated = await store.updateEntry(owner.email, entryId, patch);
  return NextResponse.json(updated);
}
