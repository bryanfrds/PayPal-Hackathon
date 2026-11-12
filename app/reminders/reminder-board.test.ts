import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n";
import type { ScheduleItem } from "@/lib/reminders";
import { toEvents } from "./ReminderBoard";

const t = translator("en");

function item(kind: ScheduleItem["kind"], id: string): ScheduleItem {
  return {
    id,
    kind,
    customer: "Kak Lina",
    slug: "kak-lina",
    day: "2026-10-20",
    hour: kind === "reminder" ? 10 : 0,
    amountSen: 2240,
    n: kind === "reminder" ? 1 : 0,
    dueNow: false,
    moved: false,
    sent: false,
    label: kind,
  };
}

const items = [item("reminder", "r1"), item("due", "d1"), item("invoice", "i1")];
const byId = (wide: boolean) => new Map(toEvents(items, false, t, wide).map((event) => [event.id, event]));

describe("reminder board events", () => {
  it("on phones, times a reminder at its send hour (no length, so the list shows just 10:00)", () => {
    const reminder = byId(false).get("r1")!;
    expect(reminder.allDay).toBe(false);
    expect(reminder.startDate).toEqual(new Date(2026, 9, 20, 10, 0));
    expect(reminder.endDate).toEqual(reminder.startDate);
  });

  it("on phones, keeps due dates and invoices all-day", () => {
    for (const id of ["d1", "i1"]) {
      const event = byId(false).get(id)!;
      expect(event.allDay).toBe(true);
      expect(event.startDate).toEqual(new Date(2026, 9, 20));
      expect(event.endDate).toEqual(new Date(2026, 9, 21));
    }
  });

  it("on the wide board, keeps everything all-day so bars line up with the day columns", () => {
    for (const event of byId(true).values()) {
      expect(event.allDay).toBe(true);
      expect(event.startDate).toEqual(new Date(2026, 9, 20));
      expect(event.endDate).toEqual(new Date(2026, 9, 21));
    }
  });
});
