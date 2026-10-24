// Person 1 Comprehensive Acceptance and Fixtures Test Suite
// Verifies all Section 2.4 requirements from the Person 1 Implementation Guide
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findCustomerSuggestions } from "./customer-matching";
import { approveDebtsForInvoicing } from "./debt-handoff";
import { computeImageHash, saveScanImage } from "./image-storage";
import { createMemoryPerson1Store, type Person1Store } from "./person1-store";
import type { CustomerRecord, ExtractedEntry, ScanRecord } from "./person1-types";
import { processEligibleReminders, type SchedulerDeps } from "./reminder-scheduler";
import { extractNotebookEntries } from "./vision-extractor";

describe("Person 1 Section 2.4 Comprehensive Acceptance Test Suite", () => {
  let store: Person1Store;
  const owner = "owner@example.com";
  const today = "2026-10-18";
  const dummyImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x12, 0x34]);

  async function registerScan(scanId: string) {
    await store.saveScan({
      id: scanId,
      ownerEmail: owner,
      imageKey: `scans/${scanId}.jpg`,
      imageHash: `hash-${scanId}`,
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: today,
      updatedAt: today,
    });
  }

  beforeEach(() => {
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
    store = createMemoryPerson1Store();
  });

  describe("1. Clear Handwriting Scenario", () => {
    it("extracts structured draft entries without creating debts or invoices", async () => {
      const entries = await extractNotebookEntries(dummyImageBytes, "image/jpeg", {
        scanId: "scan-clear",
        revision: 1,
        today,
        fixtureScenario: "clear_handwriting",
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.classification === "debt")).toBe(true);
      expect(entries.every((e) => e.included === true)).toBe(true);
      expect(entries.every((e) => !e.isAmbiguous)).toBe(true);

      // Financial invariant: drafts alone never create approved debts in store
      const approved = await store.getApprovedDebts(owner);
      expect(approved).toHaveLength(0);
    });
  });

  describe("2. Unclear / Ambiguous Handwriting & Invalid Amounts", () => {
    it("flags ambiguous values and bars them from handoff until resolved", async () => {
      await registerScan("scan-ambig");
      const entries = await extractNotebookEntries(dummyImageBytes, "image/jpeg", {
        scanId: "scan-ambig",
        revision: 1,
        today,
        fixtureScenario: "ambiguous_handwriting",
      });

      const ambig = entries.find((e) => e.isAmbiguous);
      expect(ambig).toBeDefined();
      expect(ambig?.included).toBe(false);
      expect(ambig?.ambiguityReason).toBeDefined();

      await store.saveEntries(entries);

      // Attempting to approve without resolving must fail
      const handoff = await approveDebtsForInvoicing(owner, [ambig!.id], store);
      expect(handoff.approved).toHaveLength(0);
      expect(handoff.rejected).toHaveLength(1);
      expect(handoff.rejected[0].reason).toMatch(/ambiguous/i);
    });
  });

  describe("3. Missing Dates", () => {
    it("defaults missing dates safely to the scan date", async () => {
      const entries = await extractNotebookEntries(dummyImageBytes, "image/jpeg", {
        scanId: "scan-nodate",
        revision: 1,
        today,
        fixtureScenario: "missing_date",
      });

      expect(entries[0].date).toBe(today);
    });
  });

  describe("4. Similar Customer Names & Suggestions", () => {
    it("suggests matches and requires explicit owner confirmation", async () => {
      const directory: CustomerRecord[] = [
        {
          id: "cust-ali-1",
          ownerEmail: owner,
          name: "Pak Ali (Bengkel)",
          slug: "pak-ali-bengkel",
          email: "ali@example.com",
          createdAt: today,
          updatedAt: today,
        },
        {
          id: "cust-ali-2",
          ownerEmail: owner,
          name: "Pak Ali (Pasar)",
          slug: "pak-ali-pasar",
          email: "ali.pasar@example.com",
          createdAt: today,
          updatedAt: today,
        },
      ];

      for (const c of directory) await store.saveCustomer(c);

      // Scanned line simply says "Pak Ali"
      const suggestions = findCustomerSuggestions("Pak Ali", directory);
      expect(suggestions.length).toBe(2);
      expect(suggestions[0].confidence).toBeGreaterThan(0.7);

      await registerScan("scan-sim");
      // Entry cannot be approved without explicit confirmedCustomerId link
      const entry: ExtractedEntry = {
        id: "entry-similar-names",
        scanId: "scan-sim",
        revision: 1,
        rawText: "Pak Ali 36.00",
        customerName: "Pak Ali",
        item: "Rokok",
        amountSen: 3600,
        rawAmountText: "36.00",
        date: today,
        classification: "debt",
        confidence: 0.9,
        isAmbiguous: false,
        included: true,
        sourceRef: { lineIndex: 1 },
        ownerEdited: false,
        createdAt: today,
        updatedAt: today,
      };

      await store.saveEntries([entry]);

      const unconfirmedHandoff = await approveDebtsForInvoicing(owner, [entry.id], store);
      expect(unconfirmedHandoff.approved).toHaveLength(0);

      // Now owner explicitly confirms cust-ali-1
      await store.confirmCustomer(owner, "cust-ali-1");
      await store.updateEntry(owner, entry.id, {
        confirmedCustomerId: "cust-ali-1",
        customerName: "Pak Ali (Bengkel)",
      });

      const confirmedHandoff = await approveDebtsForInvoicing(owner, [entry.id], store);
      expect(confirmedHandoff.approved).toHaveLength(1);
      expect(confirmedHandoff.approved[0].customerEmail).toBe("ali@example.com");
    });
  });

  describe("5. Crossed-Out Debts & Partial Repayments", () => {
    it("preserves classifications for review and never auto-bills or creates new debts", async () => {
      await registerScan("scan-crossed");
      await registerScan("scan-repay");
      const crossedEntries = await extractNotebookEntries(dummyImageBytes, "image/jpeg", {
        scanId: "scan-crossed",
        revision: 1,
        today,
        fixtureScenario: "crossed_out_debt",
      });

      const crossed = crossedEntries.find((e) => e.classification === "crossed_out");
      expect(crossed?.included).toBe(false);

      const repaymentEntries = await extractNotebookEntries(dummyImageBytes, "image/jpeg", {
        scanId: "scan-repay",
        revision: 1,
        today,
        fixtureScenario: "partial_repayment",
      });

      const repayment = repaymentEntries.find((e) => e.classification === "repayment");
      expect(repayment?.included).toBe(false);

      await store.saveEntries([crossed!, repayment!]);

      const handoff = await approveDebtsForInvoicing(owner, [crossed!.id, repayment!.id], store);
      expect(handoff.approved).toHaveLength(0);
      expect(handoff.rejected).toHaveLength(2);
    });
  });

  describe("6. Duplicate Image Uploads / Imports", () => {
    it("detects identical image hashes across multiple scan uploads", async () => {
      const hash1 = computeImageHash(dummyImageBytes);
      await saveScanImage(owner, "scan-original", dummyImageBytes, "image/jpeg");

      const scan1: ScanRecord = {
        id: "scan-original",
        ownerEmail: owner,
        imageKey: "scans/scan-original.jpg",
        imageHash: hash1,
        mimeType: "image/jpeg",
        sizeBytes: dummyImageBytes.byteLength,
        status: "completed",
        mode: "notebook",
        revision: 1,
        createdAt: today,
        updatedAt: today,
      };

      await store.saveScan(scan1);

      // Second upload with same image bytes
      const existing = await store.findScanByHash(owner, hash1);
      expect(existing).not.toBeNull();
      expect(existing?.id).toBe("scan-original");
    });
  });

  describe("7. Reminder Orchestration & Suppression After Payment", () => {
    it("suppresses reminders when an invoice is already paid or cancelled", async () => {
      const sendReminder = vi.fn();
      const deps: SchedulerDeps = {
        store,
        now: new Date("2026-10-18T10:00:00Z"),
        getInvoices: async () => [
          {
            id: "INV-PAID-CHECK",
            customerName: "Mak Cik Siti",
            dueDate: "2026-10-01",
            amountSen: 4850,
            status: "PAID",
            settlement: "paid",
          },
          {
            id: "INV-CANCELLED-CHECK",
            customerName: "Ah Seng",
            dueDate: "2026-10-01",
            amountSen: 3990,
            status: "CANCELLED",
            settlement: "closed",
          },
        ],
        sendReminder,
      };

      const outcome = await processEligibleReminders(owner, deps);
      expect(outcome.requested).toHaveLength(0);
      expect(outcome.skipped).toHaveLength(2);
      expect(sendReminder).not.toHaveBeenCalled();
    });

    it("prevents duplicate reminder requests on retry/concurrent runs", async () => {
      const sendReminder = vi.fn().mockResolvedValue({ ok: true });
      const deps: SchedulerDeps = {
        store,
        now: new Date("2026-10-18T10:00:00Z"),
        getInvoices: async () => [
          {
            id: "INV-IDEMP",
            customerName: "Pak Ali",
            dueDate: "2026-10-01", // 17 days ago
            amountSen: 3600,
            status: "SENT",
            settlement: "open",
          },
        ],
        sendReminder,
      };

      // First run requests reminder
      const firstRun = await processEligibleReminders(owner, deps);
      expect(firstRun.requested).toHaveLength(1);
      expect(sendReminder).toHaveBeenCalledTimes(1);

      // Immediate second run is suppressed due to minimum interval rule
      const secondRun = await processEligibleReminders(owner, deps);
      expect(secondRun.requested).toHaveLength(0);
      expect(secondRun.skipped).toHaveLength(1);
      expect(sendReminder).toHaveBeenCalledTimes(1);
    });
  });
});
