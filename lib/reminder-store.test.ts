import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "./reminders";
import { MOVES_KEY, RULES_KEY, ReminderStoreError, createReminderStore, getActivity, getRules, saveRules } from "./reminder-store";

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

  it("remembers which reminders were sent and when", () => {
    const store = createReminderStore(memory());
    store.markSent("a:reminder:2026-08:1", "2026-10-13");
    expect(store.sent()).toEqual({ "a:reminder:2026-08:1": "2026-10-13" });
    expect(() => store.markSent("x", "today")).toThrow(ReminderStoreError);
  });

  it("refuses a day that isn't YYYY-MM-DD", () => {
    expect(() => createReminderStore(memory()).move("x", "19 Oct")).toThrow(ReminderStoreError);
  });

  it("ignores saved moves with bad days", () => {
    expect(createReminderStore(memory({ [MOVES_KEY]: JSON.stringify({ x: "soon" }) })).moves()).toEqual({});
  });

  it("without storage (private mode) reads the defaults and refuses to pretend it saved", () => {
    const store = createReminderStore(null);
    expect(store.rules()).toEqual(DEFAULT_RULES);
    expect(store.moves()).toEqual({});
    expect(() => store.move("x", "2026-10-19")).toThrow(ReminderStoreError);
  });

  it("can take back a sent mark", () => {
    const store = createReminderStore(memory());
    store.markSent("a", "2026-10-13");
    store.markSent("b", "2026-10-13");
    store.unmarkSent("a");
    expect(store.sent()).toEqual({ b: "2026-10-13" });
  });

  it("says so when saving fails", () => {
    const store = createReminderStore({ getItem: () => null, setItem: () => { throw new Error("full"); } });
    expect(() => store.setRules(DEFAULT_RULES)).toThrow(ReminderStoreError);
  });
});

describe("server reminder adapters", () => {
  it("maps server rule names to the reminder UI", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      enabled: false,
      firstAfterDays: 5,
      minIntervalDays: 6,
      maxAttempts: 2,
      sendHour: 14,
      skipFridayPrayers: false,
      requireApproval: true,
    }));
    await expect(getRules(fetchImpl)).resolves.toEqual({
      on: false,
      firstAfterDays: 5,
      everyDays: 6,
      maxCount: 2,
      sendHour: 14,
      skipFridayPrayers: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/reminder-rules");
  });

  it("saves UI rules using server field names", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => Response.json(JSON.parse(String(init?.body))));
    await saveRules({ ...DEFAULT_RULES, everyDays: 7, maxCount: 4 }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/reminder-rules", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        firstAfterDays: 3,
        minIntervalDays: 7,
        maxAttempts: 4,
        sendHour: 10,
        skipFridayPrayers: true,
      }),
    }));
  });

  it("loads scheduler activity and reports failed requests", async () => {
    const activity = [{ id: "decision-1", action: "requested" }];
    await expect(getActivity(20, vi.fn(async () => Response.json({ activity })))).resolves.toEqual(activity);
    await expect(getRules(vi.fn(async () => Response.json({ error: "offline" }, { status: 503 })))).rejects.toThrow("offline");
  });
});
