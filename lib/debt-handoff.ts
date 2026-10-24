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

    const scan = await store.getScan(ownerEmail, entry.scanId);
    if (!scan) {
      rejected.push({ entryId, reason: "Source scan no longer exists." });
      continue;
    }

    if (entry.revision !== scan.revision) {
      rejected.push({ entryId, reason: "Extraction results have been superseded by a newer rescan." });
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
    const lineIndex = entry.sourceRef.lineIndex;

    const existingByLine = await store.getApprovedDebtByScanAndLine(ownerEmail, scan.id, lineIndex);
    const existingDebt = existingByLine || (await store.getApprovedDebtBySourceEntryId(ownerEmail, entry.id));

    if (existingDebt) {
      if (existingDebt.sourceEntryId === entry.id && existingDebt.handoffKey === handoffKey) {
        approved.push(existingDebt);
        continue;
      }

      if (existingByLine && existingByLine.sourceEntryId !== entry.id) {
        rejected.push({
          entryId,
          reason: "This notebook line has already been approved for invoicing.",
        });
        continue;
      }

      // Update the existing approved record in place, preserving its unique stable ID
      const updatedRecord: ApprovedDebtRecord = {
        ...existingDebt,
        sourceEntryId: entry.id,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        amountSen: entry.amountSen,
        item: entry.item || "Barang kedai",
        date: entry.date,
        approvedAt: new Date().toISOString(),
        handoffKey,
      };

      const [saved] = await store.saveApprovedDebts([updatedRecord]);
      approved.push(saved || updatedRecord);
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

    const [savedNew] = await store.saveApprovedDebts([approvedRecord]);
    approved.push(savedNew || approvedRecord);
  }

  return { approved, rejected };
}
