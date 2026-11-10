import { NextResponse } from "next/server";
import { invoiceRequestId, isValidEmail } from "@/lib/collect";
import { MAX_AMOUNT_SEN, MAX_NAME_LENGTH } from "@/lib/debts";
import { customerSlug } from "@/lib/customer-tab";
import { debtInvoices, type DebtInvoices } from "@/lib/debt-invoices";
import { paymentDb, within } from "@/lib/payment-db";
import { invoiceFacts, settlementOf } from "@/lib/payments";
import { createDraftInvoice, getInvoice, getPayerLink, PayPalError, sendInvoice, shopCurrency, type PayPalInvoice } from "@/lib/paypal";
import { paypalFailure } from "./errors";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

/** Statuses that mean the invoice has gone out to the customer. */
const OUT = new Set(["SENT", "SHARED", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING", "PAID", "MARKED_AS_PAID", "PAID_EXTERNAL"]);

const CANCELLED_MESSAGE = "This invoice was cancelled on PayPal. Check it there before sending again.";
const DIFFERS_MESSAGE = "This invoice already went out on PayPal with a different amount or recipient. Check it there before changing it.";

/** True when PayPal's invoice bills a different amount or person. Only what PayPal reported counts. */
function differs(invoice: PayPalInvoice, email: string, totalSen: number): boolean {
  const paypalTotal = invoiceFacts(invoice).totalSen;
  const recipient = invoice.primary_recipients?.[0]?.billing_info?.email_address;
  if (paypalTotal !== undefined && paypalTotal !== totalSen) return true;
  return recipient !== undefined && recipient.trim().toLowerCase() !== email.trim().toLowerCase();
}

type ManualBody = {
  kind: "manual";
  customerName: string;
  email: string;
  lines: { name: string; amountSen: number }[];
  requestId: string;
  /** The device's debt ids this invoice covers, for the payments database. */
  debtIds: string[];
};

type ApprovedBody = {
  kind: "approved";
  approvedDebtId: string;
  requestId: string;
};

type Body = ManualBody | ApprovedBody;

function parseBody(value: unknown): Body | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const requestId = typeof v.requestId === "string" ? v.requestId : "";
  if (!/^buku-[0-9a-f]{16}$/.test(requestId)) return null;

  // Try approved debt format first
  if (typeof v.approvedDebtId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v.approvedDebtId)) {
    return {
      kind: "approved",
      approvedDebtId: v.approvedDebtId,
      requestId,
    };
  }

  // Fall back to manual format
  const name = typeof v.customerName === "string" ? v.customerName.trim() : "";
  const email = typeof v.email === "string" ? v.email.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH || !isValidEmail(email)) return null;
  if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > 100) return null;
  const lines: ManualBody["lines"] = [];
  for (const line of v.lines) {
    const l = line as Record<string, unknown>;
    if (typeof l?.name !== "string" || !l.name.trim() || l.name.length > 200) return null;
    if (typeof l.amountSen !== "number" || !Number.isInteger(l.amountSen) || l.amountSen <= 0 || l.amountSen > MAX_AMOUNT_SEN) return null;
    lines.push({ name: l.name.trim(), amountSen: l.amountSen });
  }
  // Optional, so an older screen that doesn't send them still works.
  const debtIds = Array.isArray(v.debtIds) ? v.debtIds : [];
  if (debtIds.length > 100 || !debtIds.every((id): id is string => typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id))) return null;
  return { kind: "manual", customerName: name, email, lines, requestId, debtIds };
}

/**
 * Records the sent invoice in the payments database, if there is one. Never fails the send:
 * the invoice is out either way, and the device keeps its own record.
 */
async function saveToDb(ownerEmail: string, customerName: string, amountSen: number, debtIds: string[], sent: { id: string; number?: string; payerLink?: string }) {
  const db = paymentDb();
  if (!db) return;
  try {
    await within(db.saveInvoice({
      id: sent.id,
      ownerEmail,
      number: sent.number,
      customerName,
      slug: customerSlug(customerName),
      debtIds,
      amountSen,
      currency: shopCurrency(),
      payerLink: sent.payerLink,
      sentAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error("POST /api/invoices: sent, but couldn't save to the database:", error instanceof Error ? error.message : error);
  }
}

export async function POST(request: Request) {
  // Only the signed-in shop owner (proxy.ts checks too).
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: "That invoice is missing a name, email or amount." }, { status: 400 });

  try {
    let customerName: string;
    let email: string;
    let lines: { name: string; amountSen: number }[];
    let debtIds: string[] = [];
    let requestId = body.requestId;

    if (body.kind === "approved") {
      // Resolve the approved debt server-side
      const store = getPerson1Store();
      const debt = await store.getApprovedDebt(owner.email, body.approvedDebtId);
      if (!debt) {
        return NextResponse.json({ error: "Approved debt not found." }, { status: 404 });
      }
      // Without this answer a second invoice can't be ruled out, so nothing is sent.
      let links: DebtInvoices;
      try {
        links = await debtInvoices(owner.email);
      } catch (error) {
        console.error("POST /api/invoices: couldn't check existing invoices:", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Couldn't check this debt's invoices. Try again." }, { status: 503 });
      }
      const closedIds = [...(links.closed.get(debt.id) ?? [])];
      const existing = links.live.get(debt.id);
      if (existing) {
        // Never a second invoice. A retry whose answer was lost gets the same invoice back.
        const invoice = await getInvoice(existing.id);
        const facts = invoiceFacts(invoice);
        if (settlementOf(facts, existing.amountSen, existing.currency) === "closed") {
          // Cancelled or refunded, and the webhook hasn't said so: note it, then bill again below.
          closedIds.push(existing.id);
          try {
            await within(paymentDb()!.saveFacts(existing.id, facts, new Date(), "app"));
          } catch (error) {
            console.error("POST /api/invoices: couldn't save a cancelled invoice:", error instanceof Error ? error.message : error);
          }
        } else {
          if (!OUT.has(invoice.status ?? "")) return NextResponse.json({ error: CANCELLED_MESSAGE }, { status: 409 });
          if (existing.amountSen !== debt.amountSen || differs(invoice, debt.customerEmail, debt.amountSen)) {
            return NextResponse.json({ error: DIFFERS_MESSAGE }, { status: 409 });
          }
          return NextResponse.json({ id: existing.id, number: invoice.detail?.invoice_number, payerLink: getPayerLink(invoice) });
        }
      }
      // Every invoice ever made for this debt, in case one went out but never reached the invoices
      // table: that one is the debt's invoice, whatever the debt has been corrected to since.
      for (const id of debt.paypalInvoiceIds ?? []) {
        if (closedIds.includes(id)) continue;
        let invoice: PayPalInvoice;
        try {
          invoice = await getInvoice(id);
        } catch (error) {
          // A draft the owner deleted on PayPal is gone, and must not block the debt for good.
          if (error instanceof PayPalError && error.status === 404) continue;
          throw error;
        }
        if (OUT.has(invoice.status ?? "")) {
          if (differs(invoice, debt.customerEmail, debt.amountSen)) return NextResponse.json({ error: DIFFERS_MESSAGE }, { status: 409 });
          const number = invoice.detail?.invoice_number;
          const payerLink = getPayerLink(invoice);
          await saveToDb(owner.email, debt.customerName, invoiceFacts(invoice).totalSen ?? debt.amountSen, [debt.id], { id, number, payerLink });
          return NextResponse.json({ id, number, payerLink });
        }
        if (invoice.status !== "DRAFT") closedIds.push(id);
      }
      const [customer, entry, scan] = await Promise.all([
        store.getCustomer(owner.email, debt.customerId),
        store.getEntry(owner.email, debt.sourceEntryId),
        store.getScan(owner.email, debt.scanId),
      ]);
      if (!customer?.confirmedAt || customer.email !== debt.customerEmail || !entry || !scan || entry.revision !== scan.revision || !entry.included || entry.isAmbiguous || entry.confirmedCustomerId !== debt.customerId) {
        return NextResponse.json({ error: "Approved debt must be reviewed again before invoicing." }, { status: 409 });
      }

      customerName = debt.customerName;
      email = debt.customerEmail;
      lines = [{ name: debt.item, amountSen: debt.amountSen }];
      debtIds = [body.approvedDebtId]; // Use the approved debt ID for idempotency tracking
      // Stable across corrections, so a lost answer can't become a second invoice. Billing again
      // after a cancelled or refunded invoice gets a new id.
      requestId = invoiceRequestId({ debtIds, email: "approved-debt", lines: [], previousInvoiceIds: closedIds });
    } else {
      customerName = body.customerName;
      email = body.email;
      lines = body.lines;
      debtIds = body.debtIds;
    }

    const totalSen = lines.reduce((sum, l) => sum + l.amountSen, 0);
    const createDraft = (id: string) =>
      createDraftInvoice({
        recipientEmail: email,
        recipientName: customerName,
        items: lines.map((l) => ({ name: l.name, amount: l.amountSen / 100 })),
        requestId: id,
      });
    // Recorded before anything is sent; if this fails, nothing goes out.
    const remember = async (invoiceId: string) => {
      if (body.kind === "approved") await getPerson1Store().addApprovedDebtInvoiceId(owner.email, body.approvedDebtId, invoiceId);
    };
    let draft = await createDraft(requestId);
    await remember(draft.id);
    // A retry gets back the create response from the first try, which can still say DRAFT
    // after that try sent it. So always ask PayPal where the invoice stands now.
    let current = await getInvoice(draft.id);
    const paypalName = current.primary_recipients?.[0]?.billing_info?.name?.full_name;
    const paypalItems = current.items?.map((item) => item.name);
    const oldWording = (paypalName !== undefined && paypalName !== customerName) || (paypalItems !== undefined && JSON.stringify(paypalItems) !== JSON.stringify(lines.map((l) => l.name)));
    if (current.status === "DRAFT" && (oldWording || differs(current, email, totalSen))) {
      // A draft from a send that failed before the debt was corrected. It never went out, so it
      // is left unsent and the corrected details get their own draft (the same one on a retry).
      draft = await createDraft(invoiceRequestId({ debtIds, email, lines, previousInvoiceIds: [draft.id] }));
      await remember(draft.id);
      current = await getInvoice(draft.id);
    }
    if ((current.status === "DRAFT" || OUT.has(current.status ?? "")) && differs(current, email, totalSen)) {
      return NextResponse.json({ error: DIFFERS_MESSAGE }, { status: 409 });
    }
    if (current.status === "DRAFT") {
      try {
        await sendInvoice(draft.id);
      } catch (error) {
        // Sent by a request that's still finishing? Check again before calling it a failure.
        const again = await getInvoice(draft.id);
        if (!OUT.has(again.status ?? "")) throw error;
      }
      current = await getInvoice(draft.id);
    }
    if (!OUT.has(current.status ?? "")) {
      return NextResponse.json({ error: CANCELLED_MESSAGE }, { status: 409 });
    }
    const number = current.detail?.invoice_number;
    const payerLink = getPayerLink(current);
    await saveToDb(owner.email, customerName, invoiceFacts(current).totalSen ?? totalSen, debtIds, { id: draft.id, number, payerLink });
    return NextResponse.json({ id: draft.id, number, payerLink });
  } catch (error) {
    // Messages from lib/paypal.ts are already redacted; this keeps PayPal's debug id for us.
    console.error("POST /api/invoices failed:", error instanceof Error ? error.message : error);
    const failure = paypalFailure(error instanceof PayPalError ? error : null);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
