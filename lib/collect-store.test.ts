import { describe, expect, it } from "vitest";
import { CollectStoreError, createCollectStore, type InvoiceRecord } from "./collect-store";

class FakeStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

function rec(id: string, sentAt: string): InvoiceRecord {
  return { id, customerName: "A", slug: "a", email: "a@b.co", debtIds: ["D-1"], amountSen: 100, sentAt };
}

describe("createCollectStore", () => {
  it("saves emails by slug and keeps them across reloads", () => {
    const storage = new FakeStorage();
    createCollectStore(storage).setEmail("mr-raj", " raj@gmail.com ");
    expect(createCollectStore(storage).emails()).toEqual({ "mr-raj": "raj@gmail.com" });
  });

  it("lists invoices newest first and replaces a retried one instead of duplicating it", () => {
    const storage = new FakeStorage();
    const store = createCollectStore(storage);
    store.addInvoice(rec("INV1", "2026-10-13T10:00:00Z"));
    store.addInvoice(rec("INV2", "2026-10-13T11:00:00Z"));
    store.addInvoice({ ...rec("INV1", "2026-10-13T10:00:00Z"), number: "0042" });
    expect(store.invoices().map((r) => [r.id, r.number])).toEqual([
      ["INV2", undefined],
      ["INV1", "0042"],
    ]);
  });

  it("throws on a failed save and leaves what was saved", () => {
    const storage = new FakeStorage();
    const store = createCollectStore(storage);
    store.setEmail("a", "a@b.co");
    storage.failWrites = true;
    expect(() => store.setEmail("b", "b@b.co")).toThrow(CollectStoreError);
    expect(store.emails()).toEqual({ a: "a@b.co" });
  });

  it("ignores saved data it can't read", () => {
    const storage = new FakeStorage();
    storage.data.set("buku.emails.v1", "{bad");
    storage.data.set("buku.invoices.v1", JSON.stringify([{ id: 1 }]));
    const store = createCollectStore(storage);
    expect(store.emails()).toEqual({});
    expect(store.invoices()).toEqual([]);
  });

  it("won't write over saved data it can't read", () => {
    const storage = new FakeStorage();
    storage.data.set("buku.invoices.v1", "{bad");
    expect(() => createCollectStore(storage).addInvoice(rec("INV1", "2026-10-13T10:00:00Z"))).toThrow(CollectStoreError);
    expect(storage.data.get("buku.invoices.v1")).toBe("{bad");
  });

  it("keeps an unfinished send until it's cleared", () => {
    const storage = new FakeStorage();
    const send = { slug: "a", customerName: "A", email: "a@b.co", debtIds: ["D-1"], lines: [{ name: "x", amountSen: 100 }], amountSen: 100, requestId: "buku-0123456789abcdef", startedAt: "2026-10-13T10:00:00Z" };
    createCollectStore(storage).setPending(send);
    expect(createCollectStore(storage).pending()).toEqual({ a: send });
    createCollectStore(storage).clearPending("a");
    expect(createCollectStore(storage).pending()).toEqual({});
  });

  it("works in memory without storage", () => {
    const store = createCollectStore(null);
    store.setEmail("a", "a@b.co");
    store.addInvoice(rec("INV1", "2026-10-13T10:00:00Z"));
    expect(store.emails()).toEqual({ a: "a@b.co" });
    expect(store.invoices()).toHaveLength(1);
  });
});
