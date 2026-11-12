// The owner's reminder rules and any reminders they dragged to another day, kept on the
// device next to the debts (see debt-store.ts). Person 1's scheduler can take these over.

import { DEFAULT_RULES, normaliseRules, type ReminderRules } from "./reminders";
import type { ReminderDecision, ReminderRuleRecord } from "./person1-types";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const RULES_KEY = "buku.reminderRules.v1";
export const MOVES_KEY = "buku.reminderMoves.v1";
export const SENT_KEY = "buku.reminderSent.v1";

export class ReminderStoreError extends Error {
  constructor(message = "Couldn't save on this device. Try again.") {
    super(message);
    this.name = "ReminderStoreError";
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) throw new ReminderStoreError(typeof body?.error === "string" ? body.error : "Couldn't reach the reminder server. Try again.");
  if (!body) throw new ReminderStoreError("The reminder server returned an invalid response.");
  return body;
}

function fromServer(rules: ReminderRuleRecord): ReminderRules {
  return normaliseRules({
    on: rules.enabled,
    firstAfterDays: rules.firstAfterDays,
    everyDays: rules.minIntervalDays,
    maxCount: rules.maxAttempts,
    sendHour: rules.sendHour,
    skipFridayPrayers: rules.skipFridayPrayers,
  });
}

export async function getRules(fetchImpl: typeof fetch = fetch): Promise<ReminderRules> {
  return fromServer(await responseJson<ReminderRuleRecord>(await fetchImpl("/api/reminder-rules")));
}

export async function saveRules(rules: ReminderRules, fetchImpl: typeof fetch = fetch): Promise<ReminderRules> {
  const clean = normaliseRules(rules);
  const saved = await responseJson<ReminderRuleRecord>(await fetchImpl("/api/reminder-rules", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: clean.on,
      firstAfterDays: clean.firstAfterDays,
      minIntervalDays: clean.everyDays,
      maxAttempts: clean.maxCount,
      sendHour: clean.sendHour,
      skipFridayPrayers: clean.skipFridayPrayers,
    }),
  }));
  return fromServer(saved);
}

export async function getActivity(limit = 50, fetchImpl: typeof fetch = fetch): Promise<ReminderDecision[]> {
  const body = await responseJson<{ activity: ReminderDecision[] }>(
    await fetchImpl(`/api/reminders/activity?limit=${Math.min(100, Math.max(1, Math.round(limit)))}`),
  );
  return body.activity;
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

/** Reminder id → YYYY-MM-DD, for both moved and sent reminders. */
function isMoves(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((d) => typeof d === "string" && DAY.test(d));
}

function write(storage: StorageLike | null, key: string, value: unknown) {
  // Private mode or blocked storage: say so, rather than look saved and lose it.
  if (!storage) throw new ReminderStoreError("This browser isn't saving data (private mode or storage blocked), so this wasn't kept.");
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
  /** Reminder id → the day the owner sent it. */
  sent(): Record<string, string>;
  /** Records that one reminder went out on `day` (YYYY-MM-DD). */
  markSent(id: string, day: string): void;
  /** Takes back a "sent" mark, e.g. when the owner cancelled in WhatsApp. */
  unmarkSent(id: string): void;
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
    sent() {
      const saved = readJson(storage, SENT_KEY);
      return isMoves(saved) ? saved : {};
    },
    markSent(id, day) {
      if (!DAY.test(day)) throw new ReminderStoreError("That isn't a day.");
      write(storage, SENT_KEY, { ...this.sent(), [id]: day });
    },
    unmarkSent(id) {
      const rest = { ...this.sent() };
      delete rest[id];
      write(storage, SENT_KEY, rest);
    },
  };
}
