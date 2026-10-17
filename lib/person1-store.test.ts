import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPerson1Store, type Person1Store } from "./person1-store";
import type { CustomerRecord, ExtractedEntry, ReminderRuleRecord, ScanRecord } from "./person1-types";

describe("Person1Store (Memory implementation)", () => {
  let store: Person1Store;
  const owner = "owner@example.com";
  const otherOwner = "other@example.com";

  beforeEach(() => {
    store = createMemoryPerson1Store();
  });

  describe("Scan Records", () => {
    const scan: ScanRecord = {
      id: "scan-1",
      ownerEmail: owner,
      imageKey: "scans/scan-1.jpg",
      imageHash: "hash-abc",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    it("saves and retrieves a scan record scoped to owner", async () => {
      await store.saveScan(scan);
      const found = await store.getScan(owner, "scan-1");
      expect(found).toEqual(scan);

      // Other owner cannot read it
      const unauthorized = await store.getScan(otherOwner, "scan-1");
      expect(unauthorized).toBeNull();
    });

    it("finds existing scan by hash for duplicate detection", async () => {
      await store.saveScan(scan);
      const dup = await store.findScanByHash(owner, "hash-abc");
      expect(dup).toEqual(scan);

      const notFound = await store.findScanByHash(owner, "hash-other");
      expect(notFound).toBeNull();
    });
  });

  describe("Extracted Entries", () => {
    const scan: ScanRecord = {
      id: "scan-1",
      ownerEmail: owner,
      imageKey: "scans/scan-1.jpg",
      imageHash: "hash-abc",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    const entry: ExtractedEntry = {
      id: "entry-1",
      scanId: "scan-1",
      revision: 1,
      rawText: "Pak Ali 36.00",
      customerName: "Pak Ali",
      item: "Rokok",
      amountSen: 3600,
      rawAmountText: "36.00",
      date: "2026-10-18",
      classification: "debt",
      confidence: 0.95,
      isAmbiguous: false,
      included: true,
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    beforeEach(async () => {
      await store.saveScan(scan);
    });

    it("saves entries and retrieves by scanId and revision", async () => {
      await store.saveEntries([entry]);
      const entries = await store.getEntriesByScan(owner, "scan-1", 1);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it("updates entry corrections", async () => {
      await store.saveEntries([entry]);
      const updated = await store.updateEntry(owner, "entry-1", {
        customerName: "Pak Ali (Bengkel)",
        amountSen: 4000,
        ownerEdited: true,
      });
      expect(updated?.customerName).toBe("Pak Ali (Bengkel)");
      expect(updated?.amountSen).toBe(4000);
      expect(updated?.ownerEdited).toBe(true);
    });
  });

  describe("Customers Directory", () => {
    const customer: CustomerRecord = {
      id: "cust-1",
      ownerEmail: owner,
      name: "Pak Ali",
      slug: "pak-ali",
      email: "ali@example.com",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    it("saves and lists customers scoped to owner", async () => {
      await store.saveCustomer(customer);
      const list = await store.listCustomers(owner);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("Pak Ali");

      expect(await store.listCustomers(otherOwner)).toHaveLength(0);
    });

    it("confirms a customer identity and timestamp", async () => {
      await store.saveCustomer(customer);
      await store.confirmCustomer(owner, "cust-1");
      const updated = await store.getCustomer(owner, "cust-1");
      expect(updated?.confirmedAt).toBeDefined();
    });
  });

  describe("Reminder Rules", () => {
    it("returns default reminder rules if none set", async () => {
      const rules = await store.getReminderRules(owner);
      expect(rules.enabled).toBe(true);
      expect(rules.firstAfterDays).toBe(3);
      expect(rules.minIntervalDays).toBe(4);
    });

    it("updates reminder rules", async () => {
      const updated: ReminderRuleRecord = {
        ownerEmail: owner,
        enabled: false,
        firstAfterDays: 5,
        minIntervalDays: 7,
        maxAttempts: 2,
        sendHour: 14,
        skipFridayPrayers: true,
        requireApproval: true,
        updatedAt: "2026-10-18T00:00:00Z",
      };
      await store.setReminderRules(updated);
      const readBack = await store.getReminderRules(owner);
      expect(readBack.enabled).toBe(false);
      expect(readBack.firstAfterDays).toBe(5);
      expect(readBack.requireApproval).toBe(true);
    });
  });
});
