import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";
import { DEFAULT_RULES, addDays, buildSchedule, normaliseRules, reminderMessage, sendHourOn } from "./reminders";

function debt(over: Partial<Debt>): Debt {
  return {
    id: "T-1",
    customerName: "Mak Cik Siti",
    item: "Beras",
    amountSen: 4850,
    date: "2026-08-02",
    status: "overdue",
    source: "manual",
    createdAt: "2026-08-02T09:00:00.000Z",
    ...over,
  };
}

function invoice(over: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: "INV2-1",
    number: "0001",
    customerName: "Mak Cik Siti",
    slug: "mak-cik-siti",
    email: "a@b.co",
    debtIds: ["T-1"],
    amountSen: 4850,
    sentAt: "2026-10-12T08:00:00.000Z",
    ...over,
  };
}

const TODAY = "2026-10-13";
const reminders = (items: ReturnType<typeof buildSchedule>) => items.filter((i) => i.kind === "reminder");

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("sendHourOn", () => {
  it("moves a Friday midday reminder to 3pm", () => {
    const rules = { ...DEFAULT_RULES, sendHour: 13 };
    expect(sendHourOn("2026-10-16", rules)).toBe(15); // a Friday
    expect(sendHourOn("2026-10-15", rules)).toBe(13);
  });

  it("leaves Friday alone when the rule is off or the hour is outside prayers", () => {
    expect(sendHourOn("2026-10-16", { ...DEFAULT_RULES, sendHour: 13, skipFridayPrayers: false })).toBe(13);
    expect(sendHourOn("2026-10-16", DEFAULT_RULES)).toBe(10);
  });
});

describe("buildSchedule", () => {
  it("plans reminders after the bill's due date: 3 days, then every 4", () => {
    // August's bill is due 10 Sep.
    const items = buildSchedule([debt({})], [], DEFAULT_RULES, {}, "2026-09-01");
    expect(items.find((i) => i.kind === "due")).toMatchObject({ day: "2026-09-10", label: "Aug bill due" });
    expect(reminders(items).map((r) => [r.day, r.label])).toEqual([
      ["2026-09-13", "1st reminder"],
      ["2026-09-17", "2nd reminder"],
      ["2026-09-21", "3rd reminder"],
    ]);
  });

  it("starts from the invoice instead when it went out after the due date", () => {
    const items = buildSchedule([debt({})], [invoice({})], DEFAULT_RULES, {}, TODAY);
    expect(items.find((i) => i.kind === "invoice")).toMatchObject({ day: "2026-10-12", label: "Invoice 0001" });
    expect(reminders(items)[0].day).toBe("2026-10-15");
  });

  it("marks reminders on or before today as due now", () => {
    const items = buildSchedule([debt({ date: "2026-09-05" })], [], DEFAULT_RULES, {}, "2026-10-17");
    // September's bill: due 10 Oct, reminders 13, 17 and 21 Oct. Today is the 17th.
    expect(reminders(items).map((r) => [r.day, r.dueNow])).toEqual([
      ["2026-10-17", true],
      ["2026-10-21", false],
      ["2026-10-25", false],
    ]);
  });

  it("brings an overdue unsent reminder to today, and counts the rest from there", () => {
    const items = buildSchedule([debt({})], [], DEFAULT_RULES, {}, TODAY);
    expect(reminders(items).map((r) => [r.day, r.dueNow])).toEqual([
      ["2026-10-13", true],
      ["2026-10-17", false],
      ["2026-10-21", false],
    ]);
  });

  it("keeps a sent reminder on the day it went out and plans the next from it", () => {
    const first = "mak-cik-siti:reminder:2026-08:1";
    const items = buildSchedule([debt({})], [], DEFAULT_RULES, {}, TODAY, { [first]: "2026-10-11" });
    expect(reminders(items).map((r) => [r.day, r.sent, r.dueNow, r.label])).toEqual([
      ["2026-10-11", true, false, "1st reminder sent"],
      ["2026-10-15", false, false, "2nd reminder"],
      ["2026-10-19", false, false, "3rd reminder"],
    ]);
  });

  it("only chases invoiced tabs", () => {
    const items = buildSchedule(
      [debt({ status: "unpaid" }), debt({ id: "T-2", customerName: "Ah Hock", status: "paid" })],
      [],
      DEFAULT_RULES,
      {},
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("puts one customer's tabs together, paced by their oldest bill", () => {
    const items = buildSchedule(
      [debt({}), debt({ id: "T-2", date: "2026-09-20", amountSen: 1000, status: "sent" })],
      [],
      DEFAULT_RULES,
      {},
      TODAY,
    );
    expect(items.filter((i) => i.kind === "due")).toHaveLength(1);
    expect(reminders(items)).toHaveLength(3);
    expect(reminders(items)[0]).toMatchObject({ day: TODAY, amountSen: 5850 });
  });

  it("keeps a reminder on the day the owner moved it to", () => {
    const id = "mak-cik-siti:reminder:2026-08:2";
    const items = buildSchedule([debt({})], [], DEFAULT_RULES, { [id]: "2026-10-19" }, TODAY);
    expect(items.find((i) => i.id === id)).toMatchObject({ day: "2026-10-19", moved: true });
  });

  it("plans nothing when reminders are off, but still shows the due date", () => {
    const items = buildSchedule([debt({})], [], { ...DEFAULT_RULES, on: false }, {}, TODAY);
    expect(items.map((i) => i.kind)).toEqual(["due"]);
  });

  it("follows the count and spacing rules", () => {
    const items = buildSchedule([debt({})], [], { ...DEFAULT_RULES, firstAfterDays: 0, everyDays: 7, maxCount: 2 }, {}, "2026-09-01");
    expect(reminders(items).map((r) => r.day)).toEqual(["2026-09-10", "2026-09-17"]);
  });
});

describe("normaliseRules", () => {
  it("falls back to the defaults for anything missing or broken", () => {
    expect(normaliseRules(null)).toEqual(DEFAULT_RULES);
    expect(normaliseRules({ everyDays: "lots", on: "yes" })).toEqual(DEFAULT_RULES);
  });

  it("keeps numbers in range", () => {
    expect(normaliseRules({ everyDays: 0, maxCount: 99, sendHour: 3 })).toMatchObject({ everyDays: 1, maxCount: 10, sendHour: 7 });
  });
});

describe("reminderMessage", () => {
  it("includes the amount and the pay link when there is one", () => {
    expect(reminderMessage("Kak Lina", 4100, "https://www.paypal.com/invoice/p/#X")).toContain("RM 41.00");
    expect(reminderMessage("Kak Lina", 4100, "https://www.paypal.com/invoice/p/#X")).toContain("https://www.paypal.com/invoice/p/#X");
  });
});
