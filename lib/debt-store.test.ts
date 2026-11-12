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

  it("adds several debts in one save", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, SEED);
    store.addMany([debt("N1"), debt("N2")]);
    expect(createDebtStore(storage, []).list().map((d) => d.id)).toEqual(["S1", "S2", "N1", "N2"]);
  });

  it("adds none of them when one can't be added", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, SEED);
    expect(() => store.addMany([debt("N1"), debt("S1")])).toThrow(DebtStoreError);
    expect(() => store.addMany([debt("N2"), debt("N2")])).toThrow(DebtStoreError);
    storage.failWrites = true;
    expect(() => store.addMany([debt("N3")])).toThrow(DebtStoreError);
    expect(store.list().map((d) => d.id)).toEqual(["S1", "S2"]);
  });

  it("updates several debts in one save", () => {
    const storage = new FakeStorage();
    const store = createDebtStore(storage, [debt("A"), debt("B"), debt("C")]);
    expect(store.updateMany(["A", "C", "missing"], { status: "sent" })).toBe(2);
    expect(createDebtStore(storage, []).list().map((d) => d.status)).toEqual(["sent", "unpaid", "sent"]);
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

  it("flags saved data it can't read, and leaves it alone until the owner chooses", () => {
    for (const raw of ["{not json", '{"a":1}', JSON.stringify([debt("OK"), { id: "bad", amountSen: 1.5 }])]) {
      const storage = new FakeStorage();
      storage.data.set(STORAGE_KEY, raw);
      const store = createDebtStore(storage, SEED);
      expect(store.unreadable, raw).toBe(true);
      expect(store.list()).toEqual([]);
      // Adding anything would overwrite what couldn't be read, so it's refused.
      expect(() => store.add(debt("N1"))).toThrow(DebtStoreError);
      expect(storage.data.get(STORAGE_KEY)).toBe(raw);
      // The owner chooses to start over.
      store.reset();
      expect(store.unreadable).toBe(false);
      expect(store.list().map((d) => d.id)).toEqual(["S1", "S2"]);
    }
  });

  it("clear starts empty, also from unreadable data", () => {
    const storage = new FakeStorage();
    storage.data.set(STORAGE_KEY, "{not json");
    const store = createDebtStore(storage, SEED);
    store.clear();
    expect(store.unreadable).toBe(false);
    expect(createDebtStore(storage, SEED).list()).toEqual([]);
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

  it("two tabs adding at once keep both debts", () => {
    const shared = new FakeStorage();
    const tabA = createDebtStore(shared, SEED);
    const tabB = createDebtStore(shared, SEED);
    tabA.add(debt("A1"));
    tabB.add(debt("B1")); // tab B never saw A1 in memory
    expect(createDebtStore(shared, SEED).list().map((d) => d.id).sort()).toEqual(["A1", "B1", "S1", "S2"]);
    // A delete in one tab doesn't bring back what the other removed.
    tabA.remove("S1");
    tabB.remove("S2");
    expect(createDebtStore(shared, SEED).list().map((d) => d.id).sort()).toEqual(["A1", "B1"]);
  });

  it("refresh picks up another tab's changes", () => {
    const shared = new FakeStorage();
    const tabA = createDebtStore(shared, SEED);
    const tabB = createDebtStore(shared, SEED);
    tabA.add(debt("A1"));
    expect(tabB.list().map((d) => d.id)).not.toContain("A1");
    tabB.refresh();
    expect(tabB.list().map((d) => d.id)).toContain("A1");
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
