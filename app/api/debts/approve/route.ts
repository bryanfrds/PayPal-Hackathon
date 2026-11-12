// POST /api/debts/approve: Approves reviewed draft entries and gates them for Person 2's invoicing
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { debtInvoices, type DebtInvoices } from "@/lib/debt-invoices";
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

  // Without this answer a re-approval could rewrite a debt that was already invoiced.
  let links: DebtInvoices;
  try {
    links = await debtInvoices(owner.email);
  } catch (error) {
    console.error("POST /api/debts/approve: couldn't check existing invoices:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't check this debt's invoices. Try again." }, { status: 503 });
  }

  const store = getPerson1Store();
  const result = await approveDebtsForInvoicing(owner.email, rawIds, store, new Set(links.live.keys()));

  return NextResponse.json(result);
}
