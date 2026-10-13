// The owner's reminder rules and any reminders they dragged to another day, kept on the
// device next to the debts (see debt-store.ts). Person 1's scheduler can take these over.

import { DEFAULT_RULES, normaliseRules, type ReminderRules } from "./reminders";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const RULES_KEY = "buku.reminderRules.v1";
export const MOVES_KEY = "buku.reminderMoves.v1";

export class ReminderStoreError extends Error {
  constructor(message = "Couldn't save on this device. Try again.") {
    super(message);
    this.name = "ReminderStoreError";
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isMoves(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((d) => typeof d === "string" && DAY.test(d));
}

function write(storage: StorageLike | null, key: string, value: unknown) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new ReminderStoreError();
  }
}

export type ReminderStore = {
  rules(): ReminderRules;
  /** Saves the rules, fixing anything out of range. */
  setRules(rules: ReminderRules): ReminderRules;
  /** Reminder id → the day the owner moved it to. */
  moves(): Record<string, string>;
  /** Moves one reminder to `day` (YYYY-MM-DD). */
  move(id: string, day: string): void;
  /** Puts every moved reminder back where the rules plan it. */
  clearMoves(): void;
};

export function createReminderStore(storage: StorageLike | null): ReminderStore {
  return {
    rules() {
      const saved = readJson(storage, RULES_KEY);
      return saved === undefined ? DEFAULT_RULES : normaliseRules(saved);
    },
    setRules(rules) {
      const clean = normaliseRules(rules);
      write(storage, RULES_KEY, clean);
      return clean;
    },
    moves() {
      const saved = readJson(storage, MOVES_KEY);
      return isMoves(saved) ? saved : {};
    },
    move(id, day) {
      if (!DAY.test(day)) throw new ReminderStoreError("That isn't a day.");
      write(storage, MOVES_KEY, { ...this.moves(), [id]: day });
    },
    clearMoves() {
      write(storage, MOVES_KEY, {});
    },
  };
}
