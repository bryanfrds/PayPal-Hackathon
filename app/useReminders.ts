"use client";

// Reminder rules and moved reminders on this device, shared by every screen and re-rendering
// when they change (here or in another tab). See lib/reminder-store.ts.

import { useCallback, useSyncExternalStore } from "react";
import { browserStorage } from "@/lib/debt-store";
import { DEFAULT_RULES, type ReminderRules } from "@/lib/reminders";
import { MOVES_KEY, RULES_KEY, SENT_KEY, createReminderStore, type ReminderStore } from "@/lib/reminder-store";

type Snapshot = { rules: ReminderRules; moves: Record<string, string>; sent: Record<string, string> };

const EMPTY: Snapshot = { rules: DEFAULT_RULES, moves: {}, sent: {} };
let store: ReminderStore | null = null;
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function getStore(): ReminderStore {
  if (!store) {
    store = createReminderStore(browserStorage());
    snapshot = { rules: store.rules(), moves: store.moves(), sent: store.sent() };
  }
  return store;
}

function changed() {
  const s = getStore();
  snapshot = { rules: s.rules(), moves: s.moves(), sent: s.sent() };
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === RULES_KEY || event.key === MOVES_KEY || event.key === SENT_KEY) changed();
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

export function useReminders() {
  const data = useSyncExternalStore(
    subscribe,
    () => {
      getStore();
      return snapshot;
    },
    () => EMPTY,
  );
  /** Throws ReminderStoreError if it can't be saved. */
  const setRules = useCallback((rules: ReminderRules) => {
    getStore().setRules(rules);
    changed();
  }, []);
  /** Throws ReminderStoreError if it can't be saved. */
  const move = useCallback((id: string, day: string) => {
    getStore().move(id, day);
    changed();
  }, []);
  /** Throws ReminderStoreError if it can't be saved. */
  const clearMoves = useCallback(() => {
    getStore().clearMoves();
    changed();
  }, []);
  /** Throws ReminderStoreError if it can't be saved. */
  const markSent = useCallback((id: string, day: string) => {
    getStore().markSent(id, day);
    changed();
  }, []);
  return { ...data, setRules, move, clearMoves, markSent };
}
