import { beforeEach, describe, expect, it } from "vitest";
import { approveDebtsForInvoicing } from "./debt-handoff";
import { createMemoryPerson1Store, type Person1Store } from "./person1-store";
import type { CustomerRecord, ExtractedEntry, ScanRecord } from "./person1-types";

describe("debt-handoff", () => {
  let store: Person1Store;
  const owner = "owner@example.com";

  beforeEach(async () => {
    store = createMemoryPerson1Store();

    await store.saveScan({
      id: "scan-1",
      ownerEmail: owner,
      imageKey: "scans/1.jpg",
      imageHash: "hash-1",
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    });

    await store.saveCustomer({
      id: "cust-1",
      ownerEmail: owner,
      name: "Pak Ali",
      slug: "pak-ali",
      email: "ali@example.com",
      confirmedAt: "2026-10-18T00:00:00Z",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    });
  });

  it("approves valid confirmed entries and generates idempotency handoff keys", async () => {
    const validEntry: ExtractedEntry = {
      id: "entry-valid",
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
      confirmedCustomerId: "cust-1",
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    await store.saveEntries([validEntry]);

    const result = await approveDebtsForInvoicing(owner, ["entry-valid"], store);
    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.approved[0].handoffKey).toContain(`${owner}:entry-valid:1:`);
    expect(result.approved[0].customerEmail).toBe("ali@example.com");

    // Replay is idempotent
    const replay = await approveDebtsForInvoicing(owner, ["entry-valid"], store);
    expect(replay.approved).toHaveLength(1);
    expect(replay.approved[0].id).toBe(result.approved[0].id);
  });

  it("rejects unconfirmed, ambiguous, crossed-out, or excluded entries", async () => {
    const entries: ExtractedEntry[] = [
      {
        id: "entry-unconfirmed",
        scanId: "scan-1",
        revision: 1,
        rawText: "Anon 10.00",
        customerName: "Anon",
        item: "Kopi",
        amountSen: 1000,
        rawAmountText: "10.00",
        date: "2026-10-18",
        classification: "debt",
        confidence: 0.9,
        isAmbiguous: false,
        included: true,
        sourceRef: { lineIndex: 2 },
        ownerEdited: false,
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: "2026-10-18T00:00:00Z",
      },
      {
        id: "entry-ambiguous",
        scanId: "scan-1",
        revision: 1,
        rawText: "Pak Ali 1?.00",
        customerName: "Pak Ali",
        item: "Roti",
        amountSen: 1500,
        rawAmountText: "1?.00",
        date: "2026-10-18",
        classification: "ambiguous",
        confidence: 0.5,
        isAmbiguous: true,
        included: true,
        confirmedCustomerId: "cust-1",
        sourceRef: { lineIndex: 3 },
        ownerEdited: false,
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: "2026-10-18T00:00:00Z",
      },
      {
        id: "entry-crossed",
        scanId: "scan-1",
        revision: 1,
        rawText: "[BATAL] Pak Ali",
        customerName: "Pak Ali",
        item: "Gula",
        amountSen: 2000,
        rawAmountText: "20.00",
        date: "2026-10-18",
        classification: "crossed_out",
        confidence: 0.9,
        isAmbiguous: false,
        included: false,
        confirmedCustomerId: "cust-1",
        sourceRef: { lineIndex: 4 },
        ownerEdited: false,
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: "2026-10-18T00:00:00Z",
      },
    ];

    await store.saveEntries(entries);

    const result = await approveDebtsForInvoicing(
      owner,
      ["entry-unconfirmed", "entry-ambiguous", "entry-crossed"],
      store,
    );

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.find((r) => r.entryId === "entry-unconfirmed")?.reason).toMatch(/confirmed/i);
    expect(result.rejected.find((r) => r.entryId === "entry-ambiguous")?.reason).toMatch(/ambiguous/i);
    expect(result.rejected.find((r) => r.entryId === "entry-crossed")?.reason).toMatch(/crossed out|excluded/i);
  });

  it("updates existing approved debt in place when entry is edited, without creating duplicate approved debts", async () => {
    const entry: ExtractedEntry = {
      id: "entry-edit-test",
      scanId: "scan-1",
      revision: 1,
      rawText: "Pak Ali 100.00",
      customerName: "Pak Ali",
      item: "Beras",
      amountSen: 10000, // RM100
      rawAmountText: "100.00",
      date: "2026-10-18",
      classification: "debt",
      confidence: 0.95,
      isAmbiguous: false,
      included: true,
      confirmedCustomerId: "cust-1",
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };

    await store.saveEntries([entry]);

    // Initial approval for RM100
    const firstResult = await approveDebtsForInvoicing(owner, ["entry-edit-test"], store);
    expect(firstResult.approved).toHaveLength(1);
    expect(firstResult.approved[0].amountSen).toBe(10000);
    const initialApprovedId = firstResult.approved[0].id;

    // Verify exactly one approved debt exists
    let allDebts = await store.getApprovedDebts(owner);
    expect(allDebts).toHaveLength(1);
    expect(allDebts[0].amountSen).toBe(10000);

    // Edit the entry to RM120
    await store.updateEntry(owner, "entry-edit-test", {
      amountSen: 12000,
      item: "Beras Wangi",
      ownerEdited: true,
    });

    // Re-approve the edited entry
    const secondResult = await approveDebtsForInvoicing(owner, ["entry-edit-test"], store);
    expect(secondResult.approved).toHaveLength(1);
    expect(secondResult.approved[0].amountSen).toBe(12000);
    expect(secondResult.approved[0].id).toBe(initialApprovedId); // Stable ID preserved!

    // Verify there is STILL exactly one approved debt in the store, updated to RM120
    allDebts = await store.getApprovedDebts(owner);
    expect(allDebts).toHaveLength(1);
    expect(allDebts[0].amountSen).toBe(12000);
    expect(allDebts[0].item).toBe("Beras Wangi");
  });

  it("rejects modifying an approved debt that has already been invoiced on PayPal", async () => {
    const entry: ExtractedEntry = {
      id: "entry-invoiced",
      scanId: "scan-1",
      revision: 1,
      rawText: "Pak Ali 50.00",
      customerName: "Pak Ali",
      item: "Kopi",
      amountSen: 5000,
      rawAmountText: "50.00",
      date: "2026-10-18",
      classification: "debt",
      confidence: 0.95,
      isAmbiguous: false,
      included: true,
      confirmedCustomerId: "cust-1",
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };
    await store.saveEntries([entry]);
    const approvedResult = await approveDebtsForInvoicing(owner, ["entry-invoiced"], store);
    const approvedId = approvedResult.approved[0].id;

    // Mock paymentDb with an active invoice containing this debtId
    const { paymentDb } = await import("./payment-db");
    const originalPaymentDb = paymentDb;
    const mockDb = {
      listOwnerInvoices: async () => [
        {
          id: "INV2-ACTIVE",
          ownerEmail: owner,
          customerName: "Pak Ali",
          amountSen: 5000,
          currency: "MYR",
          sentAt: "2026-10-18T00:00:00Z",
          status: "SENT",
          settlement: "open" as const,
          debtIds: [approvedId],
        },
      ],
    };

    // Edit the entry
    await store.updateEntry(owner, "entry-invoiced", {
      amountSen: 6000,
      ownerEdited: true,
    });

    const { vi } = await import("vitest");
    const spy = vi.spyOn(await import("./payment-db"), "paymentDb").mockReturnValue(mockDb as any);

    try {
      const editResult = await approveDebtsForInvoicing(owner, ["entry-invoiced"], store);
      expect(editResult.approved).toHaveLength(0);
      expect(editResult.rejected).toHaveLength(1);
      expect(editResult.rejected[0].reason).toMatch(/already been invoiced on PayPal/i);
    } finally {
      spy.mockRestore();
    }
  });
});
