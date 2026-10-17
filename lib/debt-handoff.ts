// Person 1 approved debt handoff gatekeeper to Person 2's invoicing pipeline
import { isValidEmail } from "./collect";
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

    if (!entry.amountSen || entry.amountSen <= 0) {
      rejected.push({ entryId, reason: "Entry amount must be greater than zero." });
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

    if (!customer.email || !isValidEmail(customer.email)) {
      rejected.push({ entryId, reason: "Customer requires a valid email for PayPal invoicing." });
      continue;
    }

    const handoffKey = `${ownerEmail}:${entry.id}:${entry.revision}`;
    const existing = await store.getApprovedDebtByHandoffKey(ownerEmail, handoffKey);
    if (existing) {
      approved.push(existing);
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
