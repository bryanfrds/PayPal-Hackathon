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
    expect(result.approved[0].handoffKey).toBe(`${owner}:entry-valid:1`);
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
});
