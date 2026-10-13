"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatSen, todayLocal } from "@/lib/debts";
import { ReminderStoreError } from "@/lib/reminder-store";
import { buildSchedule, earliestMoveDay, isDay, reminderMessage, type ScheduleItem } from "@/lib/reminders";
import { isPayPalUrl } from "@/lib/customer-pay";
import { colourIndex, initials } from "@/lib/home";
import { ChatIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useReminders } from "../useReminders";

// Bryntum measures the DOM, so it only runs in the browser.
const ReminderBoard = dynamic(() => import("./ReminderBoard"), {
  ssr: false,
  loading: () => <p className="card loading">Loading the schedule…</p>,
});

/** Wider than this, the Scheduler (one row per customer); narrower, the Calendar. */
const WIDE_MIN = 700;

const AVATAR_COLOURS = [
  ["#f6efdc", "#8c6512"],
  ["#efe6f8", "#6b3fa0"],
  ["#e6f3ea", "#2b7a46"],
  ["#e0f2f1", "#1d6f69"],
  ["#e3ecfb", "#2f55c4"],
  ["#ffe9e4", "#c23b22"],
];

function whatsAppLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function formatDay(day: string, today: string): string {
  if (day === today) return "Today";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" });
}

export default function RemindersScreen() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent, move, markSent, unmarkSent } = useReminders();
  const [justSent, setJustSent] = useState<ScheduleItem | null>(null);
  // The Undo offer fades after a while; acting again clears it sooner.
  useEffect(() => {
    if (!justSent) return;
    const timer = setTimeout(() => setJustSent(null), 15_000);
    return () => clearTimeout(timer);
  }, [justSent]);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const today = todayLocal();
  const items = useMemo(() => buildSchedule(debts, invoices, rules, moves, today, sent), [debts, invoices, rules, moves, today, sent]);
  const reminders = useMemo(() => items.filter((i) => i.kind === "reminder"), [items]);
  // One row per customer: their earliest reminder that should already have gone out.
  const sendNow = useMemo(() => {
    const seen = new Set<string>();
    const out: ScheduleItem[] = [];
    for (const item of reminders) {
      if (!item.dueNow || seen.has(item.slug)) continue;
      seen.add(item.slug);
      out.push(item);
    }
    return out;
  }, [reminders]);
  const upcoming = reminders.filter((i) => !i.dueNow && !i.sent).slice(0, 6);
  const payLinks = useMemo(() => {
    const links = new Map<string, string>();
    for (const inv of invoices) if (inv.payerLink && isPayPalUrl(inv.payerLink) && !links.has(inv.slug)) links.set(inv.slug, inv.payerLink);
    return links;
  }, [invoices]);

  // First day each reminder can move to, for the drag check and the date boxes.
  const earliest = useMemo(() => Object.fromEntries(reminders.map((r) => [r.id, earliestMoveDay(items, r, today)])), [items, reminders, today]);

  /** Saves a move, or says why not. Returns whether it was saved. */
  function onMove(id: string, day: string): boolean {
    const min = earliest[id];
    if (!isDay(day) || !min) {
      setError("That isn't a day. Pick one from the calendar.");
      return false;
    }
    if (day < min) {
      setError(`Pick ${formatDay(min, today)} or later: not in the past, and after the reminder before it.`);
      return false;
    }
    try {
      move(id, day);
      setError(null);
      setJustSent(null);
      return true;
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : "Couldn't move that reminder. Try again.");
      return false;
    }
  }

  function onSent(item: ScheduleItem) {
    try {
      markSent(item.id, today);
      setJustSent(item);
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : "Couldn't mark it sent. Try again.");
    }
  }

  const wide = width !== null && width >= WIDE_MIN;

  return (
    <div className="reminders">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reminders</h1>
          <p className="page-intro">
            {rules.on
              ? `Friendly nudges for tabs with a PayPal invoice: ${rules.firstAfterDays} days after the bill is due, then every ${rules.everyDays}.`
              : "Reminders are off. Turn them on in Rules."}
          </p>
        </div>
        <Link href="/reminders/rules" className="button">
          Rules
        </Link>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {justSent && (
        <p className="notice notice-success" role="status">
          Marked {justSent.customer}'s {justSent.label} as sent. The next one is planned from today.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              try {
                unmarkSent(justSent.id);
                setJustSent(null);
              } catch (e) {
                setError(e instanceof ReminderStoreError ? e.message : "Couldn't undo. Try again.");
              }
            }}
          >
            Undo
          </button>
        </p>
      )}

      <div ref={boxRef} className="reminder-box">
        {!ready || width === null ? (
          <p className="card loading" aria-busy="true">
            Loading the schedule…
          </p>
        ) : items.length === 0 ? (
          <div className="card empty-state">
            <h2>Nobody to remind</h2>
            <p>Reminders start once a tab has a PayPal invoice. Send invoices from Collect.</p>
            <Link href="/collect" className="button button-primary">
              Go to Collect
            </Link>
          </div>
        ) : (
          <>
            <ReminderBoard items={items} today={today} wide={wide} earliest={earliest} onMove={onMove} />
            {wide && <p className="reminder-hint">Drag a black reminder to another day to move it, or pick a new day under Coming up.</p>}
          </>
        )}
      </div>

      {ready && sendNow.length > 0 && (
        <section className="card reminder-list" aria-labelledby="send-now">
          <h2 id="send-now">Send now</h2>
          <ul>
            {sendNow.map((item) => {
              const [bg, fg] = AVATAR_COLOURS[colourIndex(item.customer, AVATAR_COLOURS.length)];
              const text = reminderMessage(item.customer, item.amountSen, payLinks.get(item.slug));
              return (
                <li key={item.id} className="reminder-row">
                  <span className="avatar" style={{ background: bg, color: fg }} aria-hidden="true">
                    {initials(item.customer)}
                  </span>
                  <span className="reminder-main">
                    <span className="reminder-name">{item.customer}</span>
                    <span className="reminder-meta">
                      {item.label} · RM {formatSen(item.amountSen)}
                      {item.day < today ? ` · since ${formatDay(item.day, today)}` : ""}
                    </span>
                  </span>
                  <a className="button button-primary reminder-send" href={whatsAppLink(text)} target="_blank" rel="noopener noreferrer" onClick={() => onSent(item)}
                    aria-label={`WhatsApp ${item.customer}`}>
                    <ChatIcon />
                    WhatsApp
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="reminder-foot">Opens WhatsApp with a friendly note and their PayPal pay link. Pick the customer there and send; it's marked sent here and the next one is planned from today.</p>
        </section>
      )}

      {ready && upcoming.length > 0 && (
        <section className="card reminder-list" aria-labelledby="coming-up">
          <h2 id="coming-up">Coming up</h2>
          <ul>
            {upcoming.map((item) => (
              <li key={item.id} className="reminder-row">
                <span className="reminder-when">
                  {formatDay(item.day, today)}
                  <small>{String(item.hour).padStart(2, "0")}:00</small>
                </span>
                <span className="reminder-main">
                  <span className="reminder-name">{item.customer}</span>
                  <span className="reminder-meta">
                    {item.label} · RM {formatSen(item.amountSen)}
                    {item.moved ? " · moved" : ""}
                  </span>
                </span>
                {/* Same as dragging on the Scheduler, for keyboards, screen readers and phones. */}
                <DateMove
                  key={`${item.id}:${item.day}`}
                  day={item.day}
                  min={earliest[item.id] ?? today}
                  label={`Move ${item.customer}'s ${item.label}`}
                  onMove={(day) => onMove(item.id, day)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * A date box that saves when you leave it or press Enter, not on every keystroke: typing a
 * date passes through half-finished ones ("0052-02-10") that mustn't be saved.
 */
function DateMove({ day, min, label, onMove }: { day: string; min: string; label: string; onMove: (day: string) => boolean }) {
  const [draft, setDraft] = useState(day);

  function commit() {
    if (draft === day) return;
    if (!onMove(draft)) setDraft(day);
  }

  return (
    <input
      type="date"
      className="reminder-date"
      min={min}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(day);
      }}
    />
  );
}
