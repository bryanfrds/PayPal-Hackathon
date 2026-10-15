"use client";

// The Bryntum views of the reminder schedule: a Scheduler (one row per customer, drag a
// reminder to move it) on wide screens, and a Calendar (month with the day's list, or a
// list) on phones.
//
// Bryntum is loaded as a static file from /vendor/bryntum (copied there by
// scripts/copy-bryntum.mjs), not bundled: its 5 MB module makes the production build run out
// of memory. Only types are imported from the package.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Calendar, Scheduler } from "@bryntum/calendar";
import { formatSen } from "@/lib/debts";
import type { Language, T } from "@/lib/i18n";
import { addDays, type ScheduleItem } from "@/lib/reminders";
import { useResolvedTheme } from "../usePrefs";
import { useT } from "../useT";

type BryntumCalendarModule = typeof import("@bryntum/calendar");

const BASE = "/vendor/bryntum";
// "theme" is the light or dark Svalbard sheet, swapped by setBryntumTheme when the app's theme changes.
const STYLES = ["calendar.css", "theme", "fontawesome/css/fontawesome.css", "fontawesome/css/solid.css"];
const THEME_SHEET = { light: "svalbard-light.css", dark: "svalbard-dark.css" } as const;
const THEME_LINK_ID = "bryntum-theme";
let themeSheet: string = THEME_SHEET.light;

let loading: Promise<BryntumCalendarModule> | null = null;

/** Points Bryntum's theme stylesheet at the light or dark sheet (now, or when it loads). */
function setBryntumTheme(mode: keyof typeof THEME_SHEET) {
  themeSheet = THEME_SHEET[mode];
  const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  if (link) link.href = `${BASE}/${themeSheet}`;
}

/** Adds Bryntum's stylesheets and script once, and resolves with its classes. */
function loadBryntum(): Promise<BryntumCalendarModule> {
  if (loading) return loading;
  loading = new Promise<BryntumCalendarModule>((resolve, reject) => {
    for (const href of STYLES) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      if (href === "theme") link.id = THEME_LINK_ID;
      link.href = `${BASE}/${href === "theme" ? themeSheet : href}`;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = `${BASE}/calendar.umd.js`;
    script.async = true;
    script.onload = () => {
      const lib = (window as unknown as { bryntum?: { calendar?: BryntumCalendarModule } }).bryntum?.calendar;
      if (lib) resolve(lib);
      else reject(new Error("Bryntum didn't load"));
    };
    script.onerror = () => reject(new Error("Bryntum didn't load"));
    document.head.appendChild(script);
  }).catch((error) => {
    // Let the next visit try again.
    loading = null;
    throw error;
  });
  return loading;
}

// Bryntum's own words (month and day names, tooltips) for the languages it ships a locale for.
// Tamil, Filipino and Bengali have none, so Bryntum's own text stays English for them.
const BRYNTUM_LOCALES: Partial<Record<Language, string>> = { ms: "Ms", zh: "ZhCn", id: "Id", th: "Th", vi: "Vi" };
const localeLoads = new Map<string, Promise<void>>();

/** Adds a Bryntum locale script once (after the main script, which it registers with). */
function loadLocale(name: string): Promise<void> {
  const known = localeLoads.get(name);
  if (known) return known;
  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${BASE}/locales/calendar.locale.${name}.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Bryntum locale didn't load"));
    document.head.appendChild(script);
  }).catch((error) => {
    localeLoads.delete(name);
    throw error;
  });
  localeLoads.set(name, load);
  return load;
}

/** Switches Bryntum to the app's language, or to English where it has no locale. Never fails: English is the fallback. */
async function applyBryntumLocale(lib: BryntumCalendarModule, lang: Language): Promise<void> {
  const name = BRYNTUM_LOCALES[lang];
  try {
    if (name) await loadLocale(name);
    await lib.LocaleManager.applyLocale(name ?? "En");
  } catch {
    try {
      await lib.LocaleManager.applyLocale("En");
    } catch {
      // Bryntum keeps whatever it had.
    }
  }
}

const COLOURS: Record<ScheduleItem["kind"], string> = {
  due: "#c23b22",
  invoice: "#2f55c4",
  reminder: "#141414",
};
// Dark: reminders can't be near-black on a dark board; this grey keeps white text readable.
const DARK_COLOURS: Record<ScheduleItem["kind"], string> = { ...COLOURS, reminder: "#5c5852" };

/** Local midnight on a YYYY-MM-DD day. */
function at(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The local YYYY-MM-DD of a date. */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function toEvents(items: ScheduleItem[], dark: boolean, t: T) {
  const colours = dark ? DARK_COLOURS : COLOURS;
  return items.map((item) => ({
    id: item.id,
    resourceId: item.slug,
    name: `${item.label} · ${item.customer} · RM ${formatSen(item.amountSen)}`,
    // Each item fills its day, so the bars line up with the day columns.
    startDate: at(item.day),
    endDate: at(addDays(item.day, 1)),
    allDay: true,
    eventColor: item.sent ? "#8a8579" : colours[item.kind],
    // Only reminders still to go out can move; due dates, invoices and sent ones are facts.
    draggable: item.kind === "reminder" && !item.sent,
    resizable: false,
    cls: item.moved ? "rb-moved" : "",
    // Short words fit a day cell; the full name is in the tooltip.
    short: item.kind === "reminder" ? (item.sent ? `${item.n} ✓` : `${item.n}`) : item.kind === "due" ? t("reminders.board.due") : t("reminders.board.invoice"),
  }));
}

function toResources(items: ScheduleItem[]) {
  const seen = new Map<string, string>();
  for (const item of items) if (!seen.has(item.slug)) seen.set(item.slug, item.customer);
  return [...seen].map(([id, name]) => ({ id, name }));
}

// Two weeks, one column per day: week on top, "Tue 13" underneath.
const DAYS_PRESET = {
  base: "dayAndWeek",
  tickWidth: 46,
  headers: [
    { unit: "week", dateFormat: "D MMM" },
    { unit: "day", dateFormat: "ddd D" },
  ],
};

type Props = {
  items: ScheduleItem[];
  today: string;
  wide: boolean;
  /** Reminder id → the first day it can move to. */
  earliest: Record<string, string>;
  onMove: (id: string, day: string) => boolean;
};

export default function ReminderBoard({ items, today, wide, earliest, onMove }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Scheduler | Calendar | null>(null);
  const onMoveRef = useRef(onMove);
  const earliestRef = useRef(earliest);
  const [failed, setFailed] = useState(false);
  const mode = useResolvedTheme();
  const { t, lang } = useT();
  const events = useMemo(() => toEvents(items, mode === "dark", t), [items, mode, t]);
  const resources = useMemo(() => toResources(items), [items]);
  // The view is built once per layout and day; data changes go into its stores below.
  const latest = useRef({ events, resources });

  useEffect(() => {
    onMoveRef.current = onMove;
    earliestRef.current = earliest;
    latest.current = { events, resources };
  });

  // Before the first load too, so the right sheet is the one that loads.
  useEffect(() => {
    setBryntumTheme(mode);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    loadBryntum()
      .then(async (lib) => {
        await applyBryntumLocale(lib, lang);
        return lib;
      })
      .then((lib) => {
        const host = hostRef.current;
        if (cancelled || !host) return;
        const { events: ev, resources: res } = latest.current;
        viewRef.current = wide
          ? new lib.Scheduler({
              appendTo: host,
              resources: res,
              events: ev,
              startDate: at(addDays(today, -3)),
              endDate: at(addDays(today, 11)),
              forceFit: true,
              viewPreset: DAYS_PRESET,
              rowHeight: 56,
              barMargin: 10,
              eventStyle: "filled",
              columns: [{ text: t("reminders.board.customer"), field: "name", width: 170 }],
              // Text only: names come from the owner's notebook, so they're encoded, never HTML.
              eventRenderer: ({ eventRecord }) =>
                lib.StringHelper.encodeHtml(String((eventRecord as unknown as { short?: string }).short ?? eventRecord.name)),
              features: {
                eventDrag: {
                  constrainDragToResource: true,
                  // Not into the past, and not onto or before the reminder ahead of it.
                  validatorFn: ({ eventRecords, startDate }: { eventRecords: { id: string | number }[]; startDate: Date }) =>
                    dayOf(startDate) >= (earliestRef.current[String(eventRecords[0]?.id)] ?? today),
                },
                eventResize: false,
                eventEdit: false,
                eventDragCreate: false,
                eventMenu: false,
                scheduleMenu: false,
                cellEdit: false,
              },
              listeners: {
                eventDrop: ({ eventRecords }) => {
                  const moved = eventRecords[0];
                  if (moved?.startDate) onMoveRef.current(String(moved.id), dayOf(new Date(moved.startDate)));
                },
              },
            })
          : new lib.Calendar({
              appendTo: host,
              events: ev,
              date: at(today),
              mode: "monthagenda",
              modes: { day: null, week: null, year: null, month: null, monthagenda: { title: t("reminders.board.month") }, agenda: { title: t("reminders.board.list") } },
              sidebar: false,
              readOnly: true,
            });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Rebuilt in a new language so Bryntum's own words and the column title switch too.
  }, [wide, today, lang, t]);

  // New schedule (moved, sent, rules changed): swap the data in place.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.eventStore.data = events;
    if ("resourceStore" in view && view.resourceStore) view.resourceStore.data = resources;
  }, [events, resources]);

  if (failed) {
    return (
      <p className="notice notice-error" role="alert">
        {t("reminders.board.failed")}
      </p>
    );
  }
  return <div ref={hostRef} className={`reminder-board ${wide ? "reminder-board-wide" : "reminder-board-phone"}`} />;
}
