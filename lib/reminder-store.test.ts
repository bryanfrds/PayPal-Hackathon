import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./reminders";
import { MOVES_KEY, RULES_KEY, ReminderStoreError, createReminderStore } from "./reminder-store";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("createReminderStore", () => {
  it("starts with the default rules", () => {
    expect(createReminderStore(memory()).rules()).toEqual(DEFAULT_RULES);
  });

  it("saves rules, fixing out-of-range numbers", () => {
    const storage = memory();
    const store = createReminderStore(storage);
    const saved = store.setRules({ ...DEFAULT_RULES, everyDays: 0 });
    expect(saved.everyDays).toBe(1);
    expect(store.rules().everyDays).toBe(1);
    expect(JSON.parse(storage.data.get(RULES_KEY)!)).toMatchObject({ everyDays: 1 });
  });

  it("reads broken saved rules as the defaults", () => {
    expect(createReminderStore(memory({ [RULES_KEY]: "{oops" })).rules()).toEqual(DEFAULT_RULES);
  });

  it("remembers moved reminders and can put them all back", () => {
    const store = createReminderStore(memory());
    store.move("a:reminder:2026-08:1", "2026-10-19");
    store.move("b:reminder:2026-09:2", "2026-10-20");
    expect(store.moves()).toEqual({ "a:reminder:2026-08:1": "2026-10-19", "b:reminder:2026-09:2": "2026-10-20" });
    store.clearMoves();
    expect(store.moves()).toEqual({});
  });

  it("refuses a day that isn't YYYY-MM-DD", () => {
    expect(() => createReminderStore(memory()).move("x", "19 Oct")).toThrow(ReminderStoreError);
  });

  it("ignores saved moves with bad days", () => {
    expect(createReminderStore(memory({ [MOVES_KEY]: JSON.stringify({ x: "soon" }) })).moves()).toEqual({});
  });

  it("works without storage (private mode) and keeps defaults", () => {
    const store = createReminderStore(null);
    store.move("x", "2026-10-19");
    expect(store.rules()).toEqual(DEFAULT_RULES);
    expect(store.moves()).toEqual({});
  });

  it("says so when saving fails", () => {
    const store = createReminderStore({ getItem: () => null, setItem: () => { throw new Error("full"); } });
    expect(() => store.setRules(DEFAULT_RULES)).toThrow(ReminderStoreError);
  });
});
