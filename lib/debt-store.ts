// Where debts are kept. For now that's the browser (localStorage) on the shop owner's
// device, so manual entry and the ledger work before there's a backend. A server store
// can replace this later behind the same interface.

import { isDebt, type Debt } from "./debts";

export interface DebtStore {
  /** Every debt, newest record last. */
  list(): Debt[];
  /** Saves a new debt. Throws DebtStoreError if it can't be saved. */
  add(debt: Debt): void;
  /** Changes some fields of a debt. Returns the updated debt, or undefined if there's none with that id. */
  update(id: string, patch: Partial<Omit<Debt, "id">>): Debt | undefined;
  /** Removes a debt and returns it (so it can be restored), or undefined if there's none with that id. */
  remove(id: string): Debt | undefined;
  /** Puts the sample debts back, for demos. */
  reset(): void;
  /** False when nothing is saved between visits (private browsing, storage blocked). */
  readonly persistent: boolean;
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

/**
 * A store backed by `storage` (window.localStorage in the app). With no storage, or one
 * that can't be read, it works in memory only and `persistent` is false.
 */
export function createDebtStore(storage: StorageLike | null, seed: Debt[]): DebtStore {
  // Storage that can't even be read is treated as missing: work in memory only.
  let usable: StorageLike | null = storage;
  let debts: Debt[] = readSaved() ?? [...seed];

  function save(next: Debt[]): void {
    if (usable) {
      try {
        usable.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        throw new DebtStoreError();
      }
    }
    debts = next;
  }

  return {
    get persistent() {
      return usable !== null;
    },
    list: () => [...debts],
    add(debt) {
      if (debts.some((d) => d.id === debt.id)) throw new DebtStoreError(`A debt with id ${debt.id} already exists.`);
      save([...debts, debt]);
    },
    update(id, patch) {
      const current = debts.find((d) => d.id === id);
      if (!current) return undefined;
      const updated: Debt = { ...current, ...patch, id };
      save(debts.map((d) => (d.id === id ? updated : d)));
      return updated;
    },
    remove(id) {
      const removed = debts.find((d) => d.id === id);
      if (!removed) return undefined;
      save(debts.filter((d) => d.id !== id));
      return removed;
    },
    reset() {
      save([...seed]);
    },
  };

  function readSaved(): Debt[] | null {
    if (!usable) return null;
    let raw: string | null;
    try {
      raw = usable.getItem(STORAGE_KEY);
    } catch {
      usable = null;
      return null;
    }
    if (raw === null) return null; // first visit: start from the sample debts
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      // Keep whatever is still valid rather than losing everything to one bad record.
      return parsed.filter(isDebt);
    } catch {
      return null;
    }
  }
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
