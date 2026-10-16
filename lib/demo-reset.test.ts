import { describe, expect, it } from "vitest";
import { createDebtStore } from "./debt-store";
import { DEMO_KEYS, resetDemoData } from "./demo-reset";
import { PREFS_KEY } from "./preferences";
import type { Debt } from "./debts";

function memory(initial: Record<string, string>) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

const SAMPLE: Debt[] = [
  { id: "S1", customerName: "Kak Lina", item: "Milo", amountSen: 1000, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00.000Z" },
];

describe("resetDemoData", () => {
  it("clears debts, invoices, pending sends, emails and reminder state", () => {
    const all = Object.fromEntries(DEMO_KEYS.map((k) => [k, "x"]));
    const s = memory({ ...all, "buku.shop.v1": '{"name":"Kedai Saya"}', [PREFS_KEY]: '{"theme":"dark"}', "buku.tip.whatsapp.v1": "1" });
    expect(resetDemoData(s)).toBe(true);
    for (const k of DEMO_KEYS) expect(s.data[k]).toBeUndefined();
    // Shop name, preferences and the one-time tip stay.
    expect(s.data["buku.shop.v1"]).toBe('{"name":"Kedai Saya"}');
    expect(s.data[PREFS_KEY]).toBe('{"theme":"dark"}');
    expect(s.data["buku.tip.whatsapp.v1"]).toBe("1");
  });

  it("covers every demo store's keys", () => {
    expect([...DEMO_KEYS].sort()).toEqual(
      [
        "buku.debts.v1",
        "buku.emails.v1",
        "buku.invoices.v1",
        "buku.pending.v1",
        "buku.reminderMoves.v1",
        "buku.reminderRules.v1",
        "buku.reminderSent.v1",
      ].sort(),
    );
  });

  it("brings the sample tabs back, like a first visit", () => {
    const s = memory({ "buku.debts.v1": JSON.stringify([{ ...SAMPLE[0], id: "MINE", customerName: "Someone" }]) });
    resetDemoData(s);
    expect(createDebtStore(s, SAMPLE).list()).toEqual(SAMPLE);
  });

  it("reports failure without storage or when a removal throws", () => {
    expect(resetDemoData(null)).toBe(false);
    const flaky = {
      removeItem: (k: string) => {
        if (k === "buku.invoices.v1") throw new Error("blocked");
      },
    };
    expect(resetDemoData(flaky)).toBe(false);
  });

  it("clears scan draft keys from sessionStorage when provided", () => {
    const local = memory({});
    const session = memory({ "buku.scan.draft.photo.v1": "draft_data", "other.key": "keep_this" });
    expect(resetDemoData(local, session)).toBe(true);
    expect(session.data["buku.scan.draft.photo.v1"]).toBeUndefined();
    expect(session.data["other.key"]).toBe("keep_this");
  });
});
