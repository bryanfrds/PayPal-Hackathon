import { describe, expect, it } from "vitest";
import { createDebtStore, DebtStoreError, newDebtId, STORAGE_KEY } from "./debt-store";
import { outstanding, type Debt } from "./debts";

function debt(id: string, amountSen = 100, status: Debt["status"] = "unpaid"): Debt {
  return {
    id,
    customerName: `Customer ${id}`,
    item: "",
    amountSen,
    date: "2026-10-01",
    status,
    source: "manual",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

class FakeStorage {
  data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(key: string) {
    if (this.failReads) throw new Error("SecurityError");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

const SEED = [debt("S1", 1000), debt("S2", 250, "paid")];

describe("createDebtStore", () => {
  it("starts from the sample debts on a first visit, without writing anything", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, SEED);
    expect(store.list().map((d) => d.id)).toEqual(["S1", "S2"]);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(store.persistent).toBe(true);
  });

  it("adds, lists and removes, and the change survives a reload", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, SEED);
    store.add(debt("N1", 1250));
    expect(store.list().map((d) => d.id)).toEqual(["S1", "S2", "N1"]);

    const reloaded = createDebtStore(storage, SEED);
    expect(reloaded.list().map((d) => d.id)).toEqual(["S1", "S2", "N1"]);

    expect(reloaded.remove("S1")?.id).toBe("S1");
    expect(reloaded.remove("missing")).toBeUndefined();
    expect(createDebtStore(storage, SEED).list().map((d) => d.id)).toEqual(["S2", "N1"]);
  });

  it("can put a removed debt back (undo)", () => {
    const store = createDebtStore(new FakeStorage(), SEED);
    const removed = store.remove("S1")!;
    store.add(removed);
    expect(store.list().map((d) => d.id).sort()).toEqual(["S1", "S2"]);
  });

  it("refuses a duplicate id", () => {
    const store = createDebtStore(new FakeStorage(), SEED);
    expect(() => store.add(debt("S1"))).toThrow(DebtStoreError);
  });

  it("updates only the named debt", () => {
    const store = createDebtStore(new FakeStorage(), SEED);
    expect(store.update("S1", { status: "sent" })?.status).toBe("sent");
    expect(store.list().find((d) => d.id === "S2")?.status).toBe("paid");
    expect(store.update("missing", { status: "sent" })).toBeUndefined();
  });

  it("leaves the list unchanged when a save fails, so nothing is half-saved", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, SEED);
    storage.failWrites = true;
    expect(() => store.add(debt("N1"))).toThrow(DebtStoreError);
    expect(() => store.remove("S1")).toThrow(DebtStoreError);
    expect(store.list().map((d) => d.id)).toEqual(["S1", "S2"]);
  });

  it("falls back to the sample debts when saved data is unreadable, and keeps valid records", () => {
    const storage = new FakeStorage();
    storage.data.set(STORAGE_KEY, "{not json");
    expect(createDebtStore(storage, SEED).list().map((d) => d.id)).toEqual(["S1", "S2"]);

    storage.data.set(STORAGE_KEY, JSON.stringify([debt("OK"), { id: "bad", amountSen: 1.5 }]));
    expect(createDebtStore(storage, SEED).list().map((d) => d.id)).toEqual(["OK"]);
  });

  it("works in memory when storage is missing or blocked", () => {
    const none = createDebtStore(null, SEED);
    none.add(debt("N1"));
    expect(none.list()).toHaveLength(3);
    expect(none.persistent).toBe(false);

    const blocked = new FakeStorage();
    blocked.failReads = true;
    expect(createDebtStore(blocked, SEED).persistent).toBe(false);
  });

  it("reset puts the sample debts back", () => {
    const store = createDebtStore(new FakeStorage(), SEED);
    store.remove("S1");
    store.remove("S2");
    expect(store.list()).toEqual([]);
    store.reset();
    expect(store.list().map((d) => d.id)).toEqual(["S1", "S2"]);
  });

  it("the ledger total comes from what's in the store", () => {
    const store = createDebtStore(new FakeStorage(), SEED);
    store.add(debt("N1", 10));
    store.add(debt("N2", 20));
    expect(outstanding(store.list())).toEqual({ totalSen: 1030, count: 3 });
  });
});

describe("newDebtId", () => {
  it("makes distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newDebtId));
    expect(ids.size).toBe(200);
  });
});
