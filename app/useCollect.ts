"use client";

// Customer emails and sent invoices on this device, shared by every screen, re-rendering
// when they change (here or in another tab). See lib/collect-store.ts.

import { useCallback, useSyncExternalStore } from "react";
import { browserStorage } from "@/lib/debt-store";
import { createCollectStore, EMAILS_KEY, INVOICES_KEY, type CollectStore, type InvoiceRecord } from "@/lib/collect-store";

type Snapshot = { emails: Record<string, string>; invoices: InvoiceRecord[] };

let store: CollectStore | null = null;
let snapshot: Snapshot = { emails: {}, invoices: [] };
const EMPTY: Snapshot = { emails: {}, invoices: [] };
const listeners = new Set<() => void>();

function getStore(): CollectStore {
  if (!store) {
    store = createCollectStore(browserStorage());
    snapshot = { emails: store.emails(), invoices: store.invoices() };
  }
  return store;
}

function changed() {
  const s = getStore();
  snapshot = { emails: s.emails(), invoices: s.invoices() };
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === EMAILS_KEY || event.key === INVOICES_KEY) changed();
}

function subscribe(listener: () => void) {
  getStore();
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useCollect() {
  const data = useSyncExternalStore(
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
  /** Throws CollectStoreError if it can't be saved. */
  const setEmail = useCallback((slug: string, email: string) => {
    getStore().setEmail(slug, email);
    changed();
  }, []);
  /** Throws CollectStoreError if it can't be saved. */
  const addInvoice = useCallback((record: InvoiceRecord) => {
    getStore().addInvoice(record);
    changed();
  }, []);
  return { ...data, ready, setEmail, addInvoice };
}
