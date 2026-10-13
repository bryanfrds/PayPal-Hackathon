"use client";

// The Bryntum views of the reminder schedule: a Scheduler (one row per customer, drag a
// reminder to move it) on wide screens, and a Calendar (month with the day's list, or a
// list) on phones. Loaded only in the browser; see RemindersScreen.

import "@bryntum/calendar/calendar.css";
import "@bryntum/calendar/svalbard-light.css";
import "@bryntum/calendar/fontawesome/css/fontawesome.css";
import "@bryntum/calendar/fontawesome/css/solid.css";
import { useMemo } from "react";
import { StringHelper, type EventModel } from "@bryntum/calendar";
import { BryntumCalendar, BryntumScheduler } from "@bryntum/calendar-react";
import { formatSen } from "@/lib/debts";
import { addDays, type ScheduleItem } from "@/lib/reminders";

const COLOURS: Record<ScheduleItem["kind"], string> = {
  due: "#c23b22",
  invoice: "#2f55c4",
  reminder: "#141414",
};

/** Local midnight (or `hour`) on a YYYY-MM-DD day. */
function at(day: string, hour = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour);
}

/** The local YYYY-MM-DD of a date. */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function toEvents(items: ScheduleItem[]) {
  return items.map((item) => ({
    id: item.id,
    resourceId: item.slug,
    name: item.kind === "reminder" ? `${item.label} · ${item.customer}` : `${item.label} · ${item.customer}`,
    // Each item fills its day, so the bars line up with the day columns.
    startDate: at(item.day),
    endDate: at(addDays(item.day, 1)),
    allDay: true,
    eventColor: COLOURS[item.kind],
    // Only reminders move; due dates and invoices are facts.
    draggable: item.kind === "reminder",
    resizable: false,
    cls: `rb-${item.kind}${item.moved ? " rb-moved" : ""}`,
    kind: item.kind,
    short: item.kind === "reminder" ? item.label.replace(" reminder", "") : item.label,
    amount: `RM ${formatSen(item.amountSen)}`,
  }));
}

type Props = {
  items: ScheduleItem[];
  today: string;
  wide: boolean;
  onMove: (id: string, day: string) => void;
};

export default function ReminderBoard({ items, today, wide, onMove }: Props) {
  const events = useMemo(() => toEvents(items), [items]);
  const resources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) if (!seen.has(item.slug)) seen.set(item.slug, item.customer);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [items]);

  if (wide) {
    return (
      <div className="reminder-board reminder-board-wide">
        <BryntumScheduler
          resources={resources}
          events={events}
          startDate={at(addDays(today, -7))}
          endDate={at(addDays(today, 21))}
          viewPreset="weekAndDay"
          rowHeight={56}
          barMargin={10}
          eventStyle="rounded"
          columns={[{ text: "Customer", field: "name", width: 170 }]}
          // Text only: names come from the owner's notebook, so they're encoded, never HTML.
          eventRenderer={({ eventRecord }) => StringHelper.encodeHtml(String((eventRecord as EventModel & { short?: string }).short ?? eventRecord.name))}
          eventDragFeature={{ constrainDragToResource: true }}
          eventResizeFeature={false}
          eventEditFeature={false}
          eventDragCreateFeature={false}
          eventMenuFeature={false}
          scheduleMenuFeature={false}
          cellEditFeature={false}
          timeRangesFeature={{ showCurrentTimeLine: true }}
          onEventDrop={({ eventRecords }) => {
            const moved = eventRecords[0];
            if (moved?.startDate) onMove(String(moved.id), dayOf(moved.startDate as Date));
          }}
        />
      </div>
    );
  }

  return (
    <div className="reminder-board reminder-board-phone">
      <BryntumCalendar
        events={events}
        date={at(today)}
        mode="monthagenda"
        modes={{ day: null, week: null, year: null, month: null, monthagenda: { title: "Month" }, agenda: { title: "List" } }}
        sidebar={false}
        readOnly
      />
    </div>
  );
}
