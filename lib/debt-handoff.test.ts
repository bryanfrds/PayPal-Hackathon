import { beforeEach, describe, expect, it } from "vitest";
import { approveDebtsForInvoicing } from "./debt-handoff";
import { createPostgresPerson1Store } from "./person1-postgres-store";
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

  it("prevents approving the same physical notebook line twice across rescans and rejects stale revisions", async () => {
    // 1. Scan at revision 1, line 1 entry
    const entryRev1: ExtractedEntry = {
      id: "entry-r1-l1",
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
    await store.saveEntries([entryRev1]);

    // Approve line 1 from revision 1
    const res1 = await approveDebtsForInvoicing(owner, ["entry-r1-l1"], store);
    expect(res1.approved).toHaveLength(1);
    const approvedDebtId = res1.approved[0].id;

    // 2. Rescan scan-1, bumping scan revision to 2 and producing new entry ID for line 1
    const scan = await store.getScan(owner, "scan-1");
    await store.saveScan({ ...scan!, revision: 2 });

    const entryRev2: ExtractedEntry = {
      id: "entry-r2-l1",
      scanId: "scan-1",
      revision: 2,
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
    await store.saveEntries([entryRev2]);

    // Attempting to approve stale revision 1 entry must be rejected
    const staleRes = await approveDebtsForInvoicing(owner, ["entry-r1-l1"], store);
    expect(staleRes.approved).toHaveLength(0);
    expect(staleRes.rejected).toHaveLength(1);
    expect(staleRes.rejected[0].reason).toMatch(/superseded|revision/i);

    // Attempting to approve line 1 from revision 2 when line 1 was already approved must be rejected or idempotent
    const res2 = await approveDebtsForInvoicing(owner, ["entry-r2-l1"], store);
    expect(res2.approved).toHaveLength(0);
    expect(res2.rejected).toHaveLength(1);
    expect(res2.rejected[0].reason).toMatch(/already been approved/i);

    // Assert only one approved debt represents that physical notebook line
    const allDebts = await store.getApprovedDebts(owner);
    expect(allDebts).toHaveLength(1);
    expect(allDebts[0].id).toBe(approvedDebtId);
  });

  it("prevents approving the same physical notebook line twice across rescans in Postgres store as well", async () => {
    const scans = new Map<string, Record<string, unknown>>();
    const entries = new Map<string, Record<string, unknown>>();
    const customers = new Map<string, Record<string, unknown>>();
    const debts = new Map<string, Record<string, unknown>>();

    const query = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
      if (sql.includes("INSERT INTO scans")) {
        const [id, ownerEmail, imageKey, imageHash, mimeType, sizeBytes, status, mode, revision, error, createdAt, updatedAt] = params;
        scans.set(`${ownerEmail}::${id}`, { id, owner_email: ownerEmail, image_key: imageKey, image_hash: imageHash, mime_type: mimeType, size_bytes: sizeBytes, status, mode, revision, error, created_at: createdAt, updated_at: updatedAt });
        return [];
      }
      if (sql.includes("SELECT * FROM scans WHERE owner_email=$1 AND id=$2")) {
        const [email, id] = params;
        const s = scans.get(`${email}::${id}`);
        return s ? [s] : [];
      }
      if (sql.includes("SELECT * FROM scans WHERE owner_email=$1 AND image_hash=$2")) {
        const [email, hash] = params;
        for (const s of scans.values()) {
          if (s.owner_email === email && s.image_hash === hash) return [s];
        }
        return [];
      }
      if (sql.includes("INSERT INTO customer_directory")) {
        const [id, ownerEmail, name, slug, email, phone, confirmedAt, createdAt, updatedAt] = params;
        customers.set(`${ownerEmail}::${id}`, { id, owner_email: ownerEmail, name, slug, email, phone, confirmed_at: confirmedAt, created_at: createdAt, updated_at: updatedAt });
        return [];
      }
      if (sql.includes("SELECT * FROM customer_directory WHERE owner_email=$1 AND id=$2")) {
        const [email, id] = params;
        const c = customers.get(`${email}::${id}`);
        return c ? [c] : [];
      }
      if (sql.includes("INSERT INTO extracted_entries")) {
        const [id, scanId, revision, rawText, customerName, item, amountSen, rawAmountText, date, classification, confidence, isAmbiguous, ambiguityReason, included, sourceRef, ownerEdited, confirmedCustomerId, createdAt, updatedAt] = params;
        entries.set(String(id), { id, scan_id: scanId, revision, raw_text: rawText, customer_name: customerName, item, amount_sen: amountSen, raw_amount_text: rawAmountText, date, classification, confidence, is_ambiguous: isAmbiguous, ambiguity_reason: ambiguityReason, included, source_ref: JSON.parse(String(sourceRef)), owner_edited: ownerEdited, confirmed_customer_id: confirmedCustomerId, created_at: createdAt, updated_at: updatedAt });
        return [];
      }
      if (sql.includes("SELECT e.* FROM extracted_entries e JOIN scans s ON s.id=e.scan_id WHERE s.owner_email=$1 AND e.id=$2")) {
        const [email, id] = params;
        const e = entries.get(String(id));
        if (!e) return [];
        const s = scans.get(`${email}::${e.scan_id}`);
        return s ? [e] : [];
      }
      if (sql.includes("SELECT a.* FROM approved_debts a JOIN extracted_entries e ON e.id = a.source_entry_id WHERE a.owner_email=$1 AND a.scan_id=$2 AND (e.source_ref->>'lineIndex')::int=$3")) {
        const [email, scanId, lineIndex] = params;
        for (const d of debts.values()) {
          if (d.owner_email === email && d.scan_id === scanId) {
            const e = entries.get(String(d.source_entry_id));
            if (e && (e.source_ref as { lineIndex: number }).lineIndex === lineIndex) {
              return [d];
            }
          }
        }
        return [];
      }
      if (sql.includes("SELECT * FROM approved_debts WHERE owner_email=$1 AND source_entry_id=$2")) {
        const [email, sourceEntryId] = params;
        const d = debts.get(`${email}::${sourceEntryId}`);
        return d ? [d] : [];
      }
      if (sql.includes("INSERT INTO approved_debts")) {
        const [id, ownerEmail, sourceEntryId, scanId, customerId, customerName, customerEmail, amountSen, currency, item, date, approvedAt, handoffKey] = params;
        const key = `${ownerEmail}::${sourceEntryId}`;
        const existing = debts.get(key);
        if (existing) {
          const updated = { ...existing, customer_id: customerId, customer_name: customerName, customer_email: customerEmail, amount_sen: amountSen, currency, item, date, approved_at: approvedAt, handoff_key: handoffKey };
          debts.set(key, updated);
          return [updated];
        }
        const created = { id, owner_email: ownerEmail, source_entry_id: sourceEntryId, scan_id: scanId, customer_id: customerId, customer_name: customerName, customer_email: customerEmail, amount_sen: amountSen, currency, item, date, approved_at: approvedAt, handoff_key: handoffKey };
        debts.set(key, created);
        return [created];
      }
      if (sql.includes("SELECT * FROM approved_debts WHERE owner_email=$1 ORDER BY approved_at DESC")) {
        const [email] = params;
        const result = [];
        for (const d of debts.values()) {
          if (d.owner_email === email) result.push(d);
        }
        return result;
      }
      return [];
    };

    const pgStore = createPostgresPerson1Store(query);

    await pgStore.saveScan({
      id: "scan-pg-1",
      ownerEmail: owner,
      imageKey: "scans/pg1.jpg",
      imageHash: "hash-pg-1",
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    });

    await pgStore.saveCustomer({
      id: "cust-pg-1",
      ownerEmail: owner,
      name: "Pak Ali",
      slug: "pak-ali",
      email: "ali@example.com",
      confirmedAt: "2026-10-18T00:00:00Z",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    });

    const entryRev1: ExtractedEntry = {
      id: "entry-pg-r1-l1",
      scanId: "scan-pg-1",
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
      confirmedCustomerId: "cust-pg-1",
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };
    await pgStore.saveEntries([entryRev1]);

    // 1. Approve line 1 from revision 1
    const res1 = await approveDebtsForInvoicing(owner, ["entry-pg-r1-l1"], pgStore);
    expect(res1.approved).toHaveLength(1);
    const approvedDebtId = res1.approved[0].id;

    // 2. Rescan producing revision 2 and new entry IDs
    const scan = await pgStore.getScan(owner, "scan-pg-1");
    await pgStore.saveScan({ ...scan!, revision: 2 });

    const entryRev2: ExtractedEntry = {
      id: "entry-pg-r2-l1",
      scanId: "scan-pg-1",
      revision: 2,
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
      confirmedCustomerId: "cust-pg-1",
      sourceRef: { lineIndex: 1 },
      ownerEdited: false,
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:00Z",
    };
    await pgStore.saveEntries([entryRev2]);

    // Stale revision 1 rejection
    const staleRes = await approveDebtsForInvoicing(owner, ["entry-pg-r1-l1"], pgStore);
    expect(staleRes.approved).toHaveLength(0);
    expect(staleRes.rejected).toHaveLength(1);
    expect(staleRes.rejected[0].reason).toMatch(/superseded|revision/i);

    // 3. Attempt to approve line 1 again from revision 2
    const res2 = await approveDebtsForInvoicing(owner, ["entry-pg-r2-l1"], pgStore);
    expect(res2.approved).toHaveLength(0);
    expect(res2.rejected).toHaveLength(1);
    expect(res2.rejected[0].reason).toMatch(/already been approved/i);

    // 4. Assert only one approved debt represents that physical notebook line
    const allDebts = await pgStore.getApprovedDebts(owner);
    expect(allDebts).toHaveLength(1);
    expect(allDebts[0].id).toBe(approvedDebtId);
  });
});
