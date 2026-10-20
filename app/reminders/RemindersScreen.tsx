"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatSen, todayLocal } from "@/lib/debts";
import { ReminderStoreError } from "@/lib/reminder-store";
import { buildSchedule, earliestMoveDay, isDay, reminderMessage, settledCustomers, type ScheduleItem } from "@/lib/reminders";
import { isPayPalUrl } from "@/lib/customer-pay";
import { invoicesToRemind } from "@/lib/payments";
import { remindByEmail } from "./remind-email";
import { colourIndex, initials } from "@/lib/home";
import { ChatIcon, CheckIcon, MailIcon } from "../components/icons";
import { palette } from "../components/palette";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useReminders } from "../useReminders";
import { useT } from "../useT";

// Bryntum measures the DOM, so it only runs in the browser.
function BoardLoading() {
  const { t } = useT();
  return <p className="card loading">{t("reminders.loading")}</p>;
}

const ReminderBoard = dynamic(() => import("./ReminderBoard"), {
  ssr: false,
  loading: () => <BoardLoading />,
});

/** Wider than this, the Scheduler (one row per customer); narrower, the Calendar. */
const WIDE_MIN = 700;

/** History length: the latest sent reminders, and settled customers. Older ones are counted, not listed. */
const HISTORY_SENT_MAX = 20;
const HISTORY_PAID_MAX = 5;

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

/** "Today", or "Tue 13 Oct" in the owner's language (`locale` from useT). */
function formatDay(day: string, today: string, locale: string, todayWord: string): string {
  if (day === today) return todayWord;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

export default function RemindersScreen() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent, move, markSent, unmarkSent } = useReminders();
  const { t, locale, formatNumber } = useT();
  // What went out last. Undo is offered when it may not have gone out: WhatsApp (the owner
  // may not have pressed send) or a PayPal email without a clear answer.
  const [justSent, setJustSent] = useState<{ item: ScheduleItem; via: "whatsapp" | "paypal"; maybe?: boolean } | null>(null);
  // The reminder PayPal is emailing right now, so a second tap can't send it twice.
  const [emailing, setEmailing] = useState<string | null>(null);
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
  const dayText = (day: string) => formatDay(day, today, locale, t("reminders.today"));
  const items = useMemo(() => buildSchedule(debts, invoices, rules, moves, today, sent, t), [debts, invoices, rules, moves, today, sent, t]);
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
  const sentReminders = useMemo(() => items.filter((i) => i.kind === "reminder" && i.sent), [items]);
  // Whole tab paid (anything not "paid" still counts as owed), most recently paid first.
  const paidCustomers = useMemo(() => settledCustomers(debts, invoices), [debts, invoices]);
  // History shows the latest sent reminders first, capped so it doesn't grow forever.
  const historySent = useMemo(
    () =>
      [...sentReminders]
        .sort((a, b) => (sent[b.id] || b.day).localeCompare(sent[a.id] || a.day))
        .slice(0, HISTORY_SENT_MAX),
    [sentReminders, sent],
  );
  const historyPaid = paidCustomers.slice(0, HISTORY_PAID_MAX);
  const historyHidden = sentReminders.length - historySent.length + (paidCustomers.length - historyPaid.length);
  const payLinks = useMemo(() => {
    const links = new Map<string, string>();
    for (const inv of invoices) if (inv.payerLink && isPayPalUrl(inv.payerLink) && !links.has(inv.slug)) links.set(inv.slug, inv.payerLink);
    return links;
  }, [invoices]);
  // Each customer's open PayPal invoices, which PayPal can send reminders about.
  const toRemind = useMemo(() => invoicesToRemind(debts, invoices), [debts, invoices]);

  // First day each reminder can move to, for the drag check and the date boxes.
  const earliest = useMemo(() => Object.fromEntries(reminders.map((r) => [r.id, earliestMoveDay(items, r, today)])), [items, reminders, today]);

  /** Saves a move, or says why not. Returns whether it was saved. */
  function onMove(id: string, day: string): boolean {
    const min = earliest[id];
    if (!isDay(day) || !min) {
      setError(t("reminders.notADay"));
      return false;
    }
    if (day < min) {
      setError(t("reminders.pickLater", { day: dayText(min) }));
      return false;
    }
    try {
      move(id, day);
      setError(null);
      setJustSent(null);
      return true;
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : t("reminders.moveFailed"));
      return false;
    }
  }

  function onSent(item: ScheduleItem) {
    try {
      markSent(item.id, today);
      setJustSent({ item, via: "whatsapp" });
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : t("reminders.markFailed"));
    }
  }

  /**
   * Has PayPal email the customer a reminder about each of their open invoices. If any may
   * have gone out, the reminder counts as sent, so it isn't sent twice.
   */
  async function onEmail(item: ScheduleItem, invoiceIds: string[]) {
    if (emailing) return;
    setEmailing(item.id);
    setError(null);
    setJustSent(null);
    try {
      const outcomes = [];
      for (const id of invoiceIds) outcomes.push(await remindByEmail(id));
      const problems = [...new Set(outcomes.flatMap((o) => (o.kind === "sent" ? [] : [o.message])))];
      if (outcomes.some((o) => o.kind !== "refused")) {
        try {
          markSent(item.id, today);
        } catch {
          setError(t("reminders.emailSaveFailed", { name: item.customer }));
          return;
        }
        setJustSent({ item, via: "paypal", maybe: outcomes.some((o) => o.kind !== "sent") });
      }
      if (problems.length > 0) setError(problems.join(" "));
    } finally {
      setEmailing(null);
    }
  }

  function undoSent(item: ScheduleItem) {
    try {
      unmarkSent(item.id);
      setJustSent(null);
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : t("reminders.undoFailed"));
    }
  }

  const wide = width !== null && width >= WIDE_MIN;

  return (
    <div className="reminders">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t("reminders.title")}</h1>
          <p className="page-intro">
            {rules.on
              ? t("reminders.intro", { first: formatNumber(rules.firstAfterDays), every: formatNumber(rules.everyDays) })
              : t("reminders.introOff")}
          </p>
        </div>
        <div className="page-actions">
          <Link href="/reminders/rules" className="button">
            {t("reminders.rules")}
          </Link>
          <Link href="/nudge" className="button button-primary">
            {t("reminders.askNudge")}
          </Link>
        </div>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {justSent?.via === "paypal" && !justSent.maybe && (
        <p className="notice notice-success" role="status">
          {t("reminders.emailSentNotice", { name: justSent.item.customer })}
        </p>
      )}

      {justSent && (justSent.via === "whatsapp" || justSent.maybe) && (
        <p className="notice notice-success" role="status">
          {justSent.via === "paypal"
            ? t("reminders.markedMaybe", { name: justSent.item.customer, label: justSent.item.label })
            : t("reminders.markedSent", { name: justSent.item.customer, label: justSent.item.label })}{" "}
          <button type="button" className="link-button" onClick={() => undoSent(justSent.item)}>
            {t("reminders.undo")}
          </button>
        </p>
      )}

      <div ref={boxRef} className="reminder-box">
        {!ready || width === null ? (
          <p className="card loading" aria-busy="true">
            {t("reminders.loading")}
          </p>
        ) : items.length === 0 ? (
          <div className="card empty-state">
            <h2>{t("reminders.empty.title")}</h2>
            <p>{t("reminders.empty.body")}</p>
            <Link href="/collect" className="button button-primary">
              {t("reminders.empty.go")}
            </Link>
          </div>
        ) : (
          <>
            <ReminderBoard items={items} today={today} wide={wide} earliest={earliest} onMove={onMove} />
            {wide && <p className="reminder-hint">{t("reminders.hint")}</p>}
          </>
        )}
      </div>

      {ready && sendNow.length > 0 && (
        <section className="card reminder-list" aria-labelledby="send-now">
          <h2 id="send-now">{t("reminders.sendNow")}</h2>
          <ul>
            {sendNow.map((item) => {
              const [bg, fg] = AVATAR_COLOURS[colourIndex(item.customer, AVATAR_COLOURS.length)];
              const text = reminderMessage(item.customer, item.amountSen, payLinks.get(item.slug), t);
              const open = toRemind[item.slug] ?? [];
              const busy = emailing === item.id;
              return (
                <li key={item.id} className="reminder-row">
                  <span className="avatar" {...palette(bg, fg)} aria-hidden="true">
                    {initials(item.customer)}
                  </span>
                  <span className="reminder-main">
                    <span className="reminder-name">{item.customer}</span>
                    <span className="reminder-meta">
                      {item.label} · <span className="nowrap">RM {formatSen(item.amountSen)}</span>
                      {item.day < today ? ` · ${t("reminders.since", { day: dayText(item.day) })}` : ""}
                    </span>
                  </span>
                  <span className="reminder-actions">
                    {open.length > 0 && (
                      <button
                        type="button"
                        className="button reminder-send"
                        disabled={emailing !== null}
                        aria-busy={busy}
                        onClick={() => onEmail(item, open.map((r) => r.id))}
                        aria-label={t("reminders.emailLabel", { name: item.customer })}
                      >
                        <MailIcon />
                        {busy ? t("reminders.sending") : t("reminders.email")}
                      </button>
                    )}
                    {/* Not while PayPal is emailing this customer, so they don't get both. */}
                    <a className="button button-primary reminder-send" href={whatsAppLink(text)} target="_blank" rel="noopener noreferrer"
                      aria-disabled={busy || undefined}
                      onClick={(event) => {
                        if (busy) event.preventDefault();
                        else onSent(item);
                      }}
                      aria-label={t("reminders.whatsappLabel", { name: item.customer })}>
                      <ChatIcon />
                      WhatsApp
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="reminder-foot">{t("reminders.sendFoot")}</p>
        </section>
      )}

      {ready && upcoming.length > 0 && (
        <section className="card reminder-list" aria-labelledby="coming-up">
          <h2 id="coming-up">{t("reminders.comingUp")}</h2>
          <ul>
            {upcoming.map((item) => (
              <li key={item.id} className="reminder-row">
                <span className="reminder-when">
                  {dayText(item.day)}
                  <small>{String(item.hour).padStart(2, "0")}:00</small>
                </span>
                <span className="reminder-main">
                  <span className="reminder-name">{item.customer}</span>
                  <span className="reminder-meta">
                    {item.label} · <span className="nowrap">RM {formatSen(item.amountSen)}</span>
                    {item.moved ? ` · ${t("reminders.moved")}` : ""}
                  </span>
                </span>
                {/* Same as dragging on the Scheduler, for keyboards, screen readers and phones. */}
                <DateMove
                  key={`${item.id}:${item.day}`}
                  day={item.day}
                  min={earliest[item.id] ?? today}
                  label={t("reminders.moveLabel", { name: item.customer, label: item.label })}
                  onMove={(day) => onMove(item.id, day)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready && (sentReminders.length > 0 || paidCustomers.length > 0) && (
        <section className="card reminder-list" aria-labelledby="reminder-history">
          <h2 id="reminder-history">{t("reminders.history.title")}</h2>
          <ul>
            {historySent.map((item) => (
              <li key={`sent-${item.id}`} className="reminder-row">
                <span className="reminder-when reminder-when-done">
                  <CheckIcon />
                  <small>{dayText(sent[item.id] || item.day)}</small>
                </span>
                <span className="reminder-main">
                  <span className="reminder-name">{item.customer}</span>
                  <span className="reminder-meta">
                    {item.label} · <span className="nowrap">RM {formatSen(item.amountSen)}</span> · {t("reminders.history.sent")}
                  </span>
                </span>
                <span className="reminder-actions">
                  <Link
                    href={`/tab/${item.slug}`}
                    className="button button-sm"
                    aria-label={t("reminders.history.viewTabLabel", { name: item.customer })}
                  >
                    {t("reminders.history.viewTab")}
                  </Link>
                </span>
              </li>
            ))}
            {historyPaid.map((c) => (
              <li key={`paid-${c.slug}`} className="reminder-row">
                <span className="reminder-when reminder-when-done">
                  <CheckIcon />
                  <small>{t("status.paid")}</small>
                </span>
                <span className="reminder-main">
                  <span className="reminder-name">{c.customerName}</span>
                  <span className="reminder-meta">
                    {t("reminders.history.settled", { amount: `RM ${formatSen(c.totalPaidSen)}` })}
                  </span>
                </span>
                <span className="reminder-actions">
                  <Link
                    href={`/tab/${c.slug}`}
                    className="button button-sm"
                    aria-label={t("reminders.history.viewTabLabel", { name: c.customerName })}
                  >
                    {t("reminders.history.viewTab")}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
          {historyHidden > 0 && <p className="reminder-foot">{t("reminders.history.more", { count: historyHidden })}</p>}
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
