// Where debts are kept. For now that's the browser (localStorage) on the shop owner's
// device, so manual entry and the ledger work before there's a backend. A server store
// can replace this later behind the same interface.

import { isDebt, type Debt } from "./debts";

export interface DebtStore {
  /** Every debt, newest record last. */
  list(): Debt[];
  /** Saves a new debt. Throws DebtStoreError if it can't be saved. */
  add(debt: Debt): void;
  /** Saves several new debts in one write: all of them or, if it throws, none. */
  addMany(debts: Debt[]): void;
  /** Changes some fields of a debt. Returns the updated debt, or undefined if there's none with that id. */
  update(id: string, patch: Partial<Omit<Debt, "id">>): Debt | undefined;
  /** Removes a debt and returns it (so it can be restored), or undefined if there's none with that id. */
  remove(id: string): Debt | undefined;
  /** Puts the sample debts back, for demos. Also the way out of unreadable saved data. */
  reset(): void;
  /** Starts with no debts at all. Also a way out of unreadable saved data. */
  clear(): void;
  /** Re-reads what's saved, e.g. after another tab changed it. */
  refresh(): void;
  /** False when nothing is saved between visits (private browsing, storage blocked). */
  readonly persistent: boolean;
  /**
   * True when saved data exists but couldn't be read. Nothing is written over it (adds and
   * removes are refused) until the owner picks reset() or clear().
   */
  readonly unreadable: boolean;
}

/** A save failed. The store is left exactly as it was before the call. */
export class DebtStoreError extends Error {
  constructor(message = "Couldn't save on this device. Your entry is still here; try again.") {
    super(message);
    this.name = "DebtStoreError";
  }
}

export const STORAGE_KEY = "buku.debts.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type Read = { kind: "none" } | { kind: "ok"; debts: Debt[] } | { kind: "unreadable" };

/**
 * A store backed by `storage` (window.localStorage in the app). With no storage, or one
 * that can't be read, it works in memory only and `persistent` is false.
 *
 * Every change is applied to a fresh read of what's saved, so two tabs adding at the
 * same time both keep their debts instead of the later save wiping the earlier one.
 */
export function createDebtStore(storage: StorageLike | null, seed: Debt[]): DebtStore {
  // Storage that can't even be read is treated as missing: work in memory only.
  let usable: StorageLike | null = storage;
  let debts: Debt[] = [];
  let unreadable = false;
  load();

  function read(): Read {
    if (!usable) return { kind: "none" };
    let raw: string | null;
    try {
      raw = usable.getItem(STORAGE_KEY);
    } catch {
      usable = null;
      return { kind: "none" };
    }
    if (raw === null) return { kind: "none" }; // nothing saved yet
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isDebt)) return { kind: "ok", debts: parsed };
    } catch {
      // fall through
    }
    return { kind: "unreadable" };
  }

  function load() {
    const result = read();
    unreadable = result.kind === "unreadable";
    if (result.kind === "ok") debts = [...result.debts];
    else if (result.kind === "unreadable") debts = [];
    else if (!usable) debts = debts.length ? debts : [...seed]; // memory only: keep what we have
    else debts = [...seed]; // first visit: start from the sample debts
  }

  function write(next: Debt[]) {
    if (usable) {
      try {
        usable.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        throw new DebtStoreError();
      }
    }
    debts = next;
    unreadable = false;
  }

  /** Applies a change to what's saved right now, then saves it. */
  function change(apply: (current: Debt[]) => Debt[]) {
    const fresh = read();
    if (fresh.kind === "unreadable") {
      unreadable = true;
      throw new DebtStoreError("Saved tabs couldn't be read. Choose to start over before adding more.");
    }
    const current = fresh.kind === "ok" ? fresh.debts : debts;
    write(apply(current));
  }

  return {
    get persistent() {
      return usable !== null;
    },
    get unreadable() {
      return unreadable;
    },
    list: () => [...debts],
    add(debt) {
      change((current) => {
        if (current.some((d) => d.id === debt.id)) throw new DebtStoreError(`A debt with id ${debt.id} already exists.`);
        return [...current, debt];
      });
    },
    addMany(newDebts) {
      change((current) => {
        const ids = new Set(current.map((d) => d.id));
        for (const debt of newDebts) {
          if (ids.has(debt.id)) throw new DebtStoreError(`A debt with id ${debt.id} already exists.`);
          ids.add(debt.id);
        }
        return [...current, ...newDebts];
      });
    },
    update(id, patch) {
      let updated: Debt | undefined;
      change((current) =>
        current.map((d) => {
          if (d.id !== id) return d;
          updated = { ...d, ...patch, id };
          return updated;
        }),
      );
      return updated;
    },
    remove(id) {
      let removed: Debt | undefined;
      change((current) => {
        removed = current.find((d) => d.id === id);
        return removed ? current.filter((d) => d.id !== id) : current;
      });
      return removed;
    },
    reset() {
      write([...seed]);
    },
    clear() {
      write([]);
    },
    refresh() {
      load();
    },
  };
}

/** The browser's localStorage, or null when it's blocked (some private modes throw on access). */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "buku.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A short random id for a new debt. */
export function newDebtId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `D-${random}`;
}
