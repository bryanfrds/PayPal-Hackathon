// GET /api/debts/approved: List approved debts ready for invoicing, and the ones already settled
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { debtInvoices, refreshDebtInvoices, type DebtInvoices } from "@/lib/debt-invoices";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const store = getPerson1Store();
  const approvedDebts = await store.getApprovedDebts(owner.email);

  // Showing debts as "to send" without this answer could lead to a second invoice.
  let links: DebtInvoices;
  try {
    links = await refreshDebtInvoices(owner.email, await debtInvoices(owner.email), approvedDebts.map((debt) => debt.id));
  } catch (error) {
    console.error("GET /api/debts/approved: couldn't check existing invoices:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't check which debts were already invoiced. Try again." }, { status: 503 });
  }

  const notInvoiced = approvedDebts.filter((debt) => !links.live.has(debt.id));
  // A line the owner unticked after approving it is withdrawn: nothing to bill.
  const entries = await Promise.all(notInvoiced.map((debt) => store.getEntry(owner.email, debt.sourceEntryId)));
  const withdrawn = new Set(notInvoiced.filter((_, index) => entries[index]?.included === false).map((debt) => debt.id));

  return NextResponse.json({
    approvedDebts: notInvoiced.filter((debt) => !withdrawn.has(debt.id)),
    // So another device can catch up, and a device's own copy of these debts never bills on its own.
    invoiced: approvedDebts.flatMap((debt) => {
      const invoice = links.live.get(debt.id);
      return invoice ? [{ debt, invoice: { id: invoice.id, number: invoice.number, amountSen: invoice.amountSen, sentAt: invoice.sentAt, payerLink: invoice.payerLink } }] : [];
    }),
    withdrawnDebtIds: [...withdrawn],
  });
}
