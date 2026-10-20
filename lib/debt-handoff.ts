// Person 1 approved debt handoff gatekeeper to Person 2's invoicing pipeline
import { isValidEmail } from "./collect";
import { paymentDb } from "./payment-db";
import type { Person1Store } from "./person1-store";
import type { ApprovedDebtRecord } from "./person1-types";

export type HandoffResult = {
  approved: ApprovedDebtRecord[];
  rejected: Array<{ entryId: string; reason: string }>;
};

export async function approveDebtsForInvoicing(
  ownerEmail: string,
  entryIds: string[],
  store: Person1Store,
): Promise<HandoffResult> {
  const approved: ApprovedDebtRecord[] = [];
  const rejected: Array<{ entryId: string; reason: string }> = [];

  for (const entryId of entryIds) {
    const entry = await store.getEntry(ownerEmail, entryId);
    if (!entry) {
      rejected.push({ entryId, reason: "Entry not found." });
      continue;
    }

    const scan = await store.getScan(ownerEmail, entry.scanId);
    if (!scan) {
      rejected.push({ entryId, reason: "Source scan no longer exists." });
      continue;
    }
    const firstImport = await store.findScanByHash(ownerEmail, scan.imageHash);
    if (firstImport && firstImport.id !== scan.id) {
      rejected.push({ entryId, reason: "Duplicate scan must be resolved before approval." });
      continue;
    }

    if (entry.classification === "crossed_out") {
      rejected.push({ entryId, reason: "Crossed out debts cannot be approved for invoicing." });
      continue;
    }

    if (entry.classification === "repayment") {
      rejected.push({ entryId, reason: "Repayments are not new debts and cannot be billed." });
      continue;
    }

    if (entry.isAmbiguous) {
      rejected.push({
        entryId,
        reason: `Ambiguous entry must be clarified before approval: ${entry.ambiguityReason || "Unclear handwriting"}.`,
      });
      continue;
    }

    if (!entry.included) {
      rejected.push({ entryId, reason: "Entry was excluded or marked crossed out." });
      continue;
    }

    if (!entry.amountSen || entry.amountSen <= 0 || !Number.isInteger(entry.amountSen)) {
      rejected.push({ entryId, reason: "Entry amount must be a positive integer in sen." });
      continue;
    }

    if (!entry.confirmedCustomerId) {
      rejected.push({ entryId, reason: "Entry must be linked to a confirmed customer before approval." });
      continue;
    }

    const customer = await store.getCustomer(ownerEmail, entry.confirmedCustomerId);
    if (!customer) {
      rejected.push({ entryId, reason: "Linked customer record does not exist." });
      continue;
    }

    if (!customer.confirmedAt) {
      rejected.push({ entryId, reason: "Linked customer has not been confirmed by the shop owner." });
      continue;
    }

    if (!customer.email || !isValidEmail(customer.email)) {
      rejected.push({ entryId, reason: "Customer requires a valid email for PayPal invoicing." });
      continue;
    }

    const handoffKey = `${ownerEmail}:${entry.id}:${entry.revision}:${entry.updatedAt}:${customer.updatedAt}`;

    const existingDebt = await store.getApprovedDebtBySourceEntryId(ownerEmail, entry.id);
    if (existingDebt) {
      if (existingDebt.handoffKey === handoffKey) {
        approved.push(existingDebt);
        continue;
      }

      // Check if this approved debt has already been invoiced on PayPal
      const db = paymentDb();
      if (db) {
        const ownerInvoices = await db.listOwnerInvoices(ownerEmail);
        const alreadyInvoiced = ownerInvoices.some(
          (inv) =>
            inv.status !== "CANCELLED" &&
            inv.settlement !== "closed" &&
            Array.isArray((inv as { debtIds?: string[] }).debtIds) &&
            (inv as { debtIds?: string[] }).debtIds!.includes(existingDebt.id),
        );
        if (alreadyInvoiced) {
          rejected.push({
            entryId,
            reason: "This debt has already been invoiced on PayPal and cannot be modified without cancelling the invoice first.",
          });
          continue;
        }
      }

      // Update the existing approved record in place, preserving its unique stable ID
      const updatedRecord: ApprovedDebtRecord = {
        ...existingDebt,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        amountSen: entry.amountSen,
        item: entry.item || "Barang kedai",
        date: entry.date,
        approvedAt: new Date().toISOString(),
        handoffKey,
      };

      await store.saveApprovedDebts([updatedRecord]);
      approved.push(updatedRecord);
      continue;
    }

    const approvedRecord: ApprovedDebtRecord = {
      id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerEmail,
      sourceEntryId: entry.id,
      scanId: entry.scanId,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      amountSen: entry.amountSen,
      currency: "MYR",
      item: entry.item || "Barang kedai",
      date: entry.date,
      approvedAt: new Date().toISOString(),
      handoffKey,
    };

    await store.saveApprovedDebts([approvedRecord]);
    approved.push(approvedRecord);
  }

  return { approved, rejected };
}
