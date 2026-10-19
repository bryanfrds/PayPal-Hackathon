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
});
