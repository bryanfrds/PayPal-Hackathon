"use client";

// One shared debt store for the whole app in this browser, and a hook that re-renders
// a screen whenever the debts change.

import { useCallback, useSyncExternalStore } from "react";
import { browserStorage, createDebtStore, type DebtStore } from "@/lib/debt-store";
import type { Debt } from "@/lib/debts";
import { SAMPLE_DEBTS } from "./ledger/sample-data";

let store: DebtStore | null = null;
let snapshot: Debt[] = [];
const listeners = new Set<() => void>();

function getStore(): DebtStore {
  if (!store) {
    store = createDebtStore(browserStorage(), SAMPLE_DEBTS);
    snapshot = store.list();
  }
  return store;
}

function changed() {
  snapshot = getStore().list();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  getStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Debt[] = [];

export type DebtsApi = {
  debts: Debt[];
  /** False during the server render and the first browser paint, before the store is read. */
  ready: boolean;
  /** False when entries won't be kept after the page closes. */
  persistent: boolean;
  /** These throw DebtStoreError if the save fails; the debts are then unchanged. */
  add(debt: Debt): void;
  remove(id: string): Debt | undefined;
  reset(): void;
};

export function useDebts(): DebtsApi {
  const debts = useSyncExternalStore(
    subscribe,
    () => {
      getStore();
      return snapshot;
    },
    () => EMPTY,
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const add = useCallback((debt: Debt) => {
    getStore().add(debt);
    changed();
  }, []);
  const remove = useCallback((id: string) => {
    const removed = getStore().remove(id);
    changed();
    return removed;
  }, []);
  const reset = useCallback(() => {
    getStore().reset();
    changed();
  }, []);

  return { debts, ready, persistent: ready ? getStore().persistent : true, add, remove, reset };
}
