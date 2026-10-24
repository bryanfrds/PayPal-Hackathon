import { describe, expect, it, vi } from "vitest";
import { createPostgresPerson1Store } from "./person1-postgres-store";

describe("Postgres Person 1 store", () => {
  it("writes scans to the tables from migration 004 and scopes reads by owner", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id:"scan-1",owner_email:"owner@example.com",image_key:"scans/key",image_hash:"hash",mime_type:"image/png",size_bytes:8,status:"completed",mode:"notebook",revision:1,error:null,created_at:"2026-10-19T00:00:00Z",updated_at:"2026-10-19T00:00:00Z" }]);
    const store = createPostgresPerson1Store(query);
    const scan = { id:"scan-1",ownerEmail:"owner@example.com",imageKey:"scans/key",imageHash:"hash",mimeType:"image/png",sizeBytes:8,status:"completed" as const,mode:"notebook" as const,revision:1,createdAt:"2026-10-19T00:00:00Z",updatedAt:"2026-10-19T00:00:00Z" };
    await store.saveScan(scan);
    expect(await store.getScan("OWNER@example.com", "scan-1")).toMatchObject({ ...scan, createdAt:"2026-10-19T00:00:00.000Z", updatedAt:"2026-10-19T00:00:00.000Z" });
    expect(query.mock.calls[1][1]).toEqual(["owner@example.com", "scan-1"]);
  });

  it("preserves stable ID on ON CONFLICT in saveApprovedDebts and returns the stored row to concurrent callers", async () => {
    const rowsByOwnerAndSource = new Map<string, Record<string, unknown>>();
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO approved_debts")) {
        const [
          id,
          ownerEmail,
          sourceEntryId,
          scanId,
          customerId,
          customerName,
          customerEmail,
          amountSen,
          currency,
          item,
          date,
          approvedAt,
          handoffKey,
        ] = params as string[];
        const key = `${ownerEmail}::${sourceEntryId}`;
        const existing = rowsByOwnerAndSource.get(key);
        if (existing) {
          const updated = {
            ...existing,
            customer_id: customerId,
            customer_name: customerName,
            customer_email: customerEmail,
            amount_sen: Number(amountSen),
            currency,
            item,
            date,
            approved_at: approvedAt,
            handoff_key: handoffKey,
          };
          rowsByOwnerAndSource.set(key, updated);
          return [updated];
        }
        const created = {
          id,
          owner_email: ownerEmail,
          source_entry_id: sourceEntryId,
          scan_id: scanId,
          customer_id: customerId,
          customer_name: customerName,
          customer_email: customerEmail,
          amount_sen: Number(amountSen),
          currency,
          item,
          date,
          approved_at: approvedAt,
          handoff_key: handoffKey,
        };
        rowsByOwnerAndSource.set(key, created);
        return [created];
      }
      if (sql.includes("JOIN extracted_entries")) {
        const [ownerEmail, scanId, lineIndex] = params;
        for (const r of rowsByOwnerAndSource.values()) {
          if (r.owner_email === ownerEmail && r.scan_id === scanId && lineIndex === 1) {
            return [r];
          }
        }
        return [];
      }
      return [];
    });

    const store = createPostgresPerson1Store(query);

    const [first, second] = await Promise.all([
      store.saveApprovedDebts([
        {
          id: "appr-caller-1",
          ownerEmail: "owner@example.com",
          sourceEntryId: "entry-1",
          scanId: "scan-1",
          customerId: "cust-1",
          customerName: "Pak Ali",
          customerEmail: "ali@example.com",
          amountSen: 3600,
          currency: "MYR",
          item: "Rokok",
          date: "2026-10-19",
          approvedAt: "2026-10-19T00:00:00Z",
          handoffKey: "key-1",
        },
      ]),
      store.saveApprovedDebts([
        {
          id: "appr-caller-2",
          ownerEmail: "owner@example.com",
          sourceEntryId: "entry-1",
          scanId: "scan-1",
          customerId: "cust-1",
          customerName: "Pak Ali Updated",
          customerEmail: "ali-new@example.com",
          amountSen: 4200,
          currency: "MYR",
          item: "Rokok + Kopi",
          date: "2026-10-19",
          approvedAt: "2026-10-19T00:01:00Z",
          handoffKey: "key-2",
        },
      ]),
    ]);

    expect(query.mock.calls[0][0]).toContain("ON CONFLICT(owner_email, source_entry_id) DO UPDATE");
    expect(query.mock.calls[0][0]).toContain("RETURNING *");
    expect(first[0].id).toBe("appr-caller-1");
    expect(second[0].id).toBe("appr-caller-1");
    expect(second[0].amountSen).toBe(4200);
    expect(second[0].customerName).toBe("Pak Ali Updated");
    expect(second[0].item).toBe("Rokok + Kopi");
    expect(second[0].handoffKey).toBe("key-2");

    const byLine = await store.getApprovedDebtByScanAndLine("owner@example.com", "scan-1", 1);
    expect(byLine?.id).toBe("appr-caller-1");
  });
});
