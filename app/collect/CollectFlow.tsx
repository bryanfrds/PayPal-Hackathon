"use client";

// Collect: pick who to bill, add missing emails, preview, then send one PayPal invoice per
// customer, with a result (and a safe Retry) for each. Sending goes through /api/invoices.

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  collectGroups,
  EMAIL_DOMAINS,
  isValidEmail,
  pickPreview,
  sendRequest,
  SHOP_ITEMS,
  withDomain,
  type CollectGroup,
  type PendingSend,
} from "@/lib/collect";
import { CollectStoreError } from "@/lib/collect-store";
import { customerSlug, tabPath } from "@/lib/customer-tab";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen } from "@/lib/debts";
import { customerSummaries } from "@/lib/home";
import type { T } from "@/lib/i18n";
import Avatar from "../components/Avatar";
import StatusBadge from "../components/StatusBadge";
import { BackIcon, CheckIcon, ChevronIcon, CloseIcon, MailIcon, PlusIcon, SendIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useIsWide } from "../useIsWide";
import { useShop } from "../useShop";
import { useDebts } from "../useDebts";
import { useT } from "../useT";


type Phase = "list" | "review" | "send";
type Tab = "toSend" | "sent" | "paid";

const rm = (sen: number) => `RM ${formatSen(sen)}`;

export default function CollectFlow() {
  const { debts, ready } = useDebts();
  const { emails, invoices, pending } = useCollect();
  const { t, formatDay } = useT();
  const [phase, setPhase] = useState<Phase>("list");
  const [tab, setTab] = useState<Tab>("toSend");
  // Customers switched off; everyone with an email is on by default.
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [emailFor, setEmailFor] = useState<CollectGroup | null>(null);
  // Frozen when sending starts, so the list doesn't shift as debts are marked sent.
  const [batch, setBatch] = useState<CollectGroup[]>([]);
  const wide = useIsWide();
  // Laptop: whose invoice the side pane shows. Falls back to the first one being sent.
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  const groups = collectGroups(debts, emails, pending);
  const chosen = groups.filter((g) => g.email && !off.has(g.slug));

  if (phase === "review") {
    return (
      <Review
        groups={chosen}
        onBack={() => setPhase("list")}
        onSend={() => {
          setBatch(chosen);
          setPhase("send");
        }}
      />
    );
  }
  if (phase === "send") {
    return (
      <Send
        groups={batch}
        onDone={() => {
          setOff(new Set());
          setTab("sent");
          setPhase("list");
        }}
      />
    );
  }

  const sentDebtCustomers = customerSummaries(debts.filter((d) => d.status === "sent"));
  const recordSlugs = new Set(invoices.map((r) => r.slug));
  const olderSent = sentDebtCustomers.filter((c) => !recordSlugs.has(customerSlug(c.customerName)));
  const paidCustomers = paidSummaries(debts);
  const total = groups.reduce((sum, g) => sum + g.totalSen, 0);
  const chosenTotal = chosen.reduce((sum, g) => sum + g.totalSen, 0);
  const preview = pickPreview(groups, chosen, previewSlug);
  const previewGroup = preview?.group;
  const showPane = wide && tab === "toSend" && ready && groups.length > 0;

  return (
    <div className={`collect collect-home${showPane ? " collect-wide" : ""}`}>
      <div className="collect-top">
        <h1>{t("collect.title")}</h1>
      </div>

      <div className="collect-cols">
      <div className="collect-left">

      <section className="collect-hero" aria-labelledby="collect-hero-label">
        <p id="collect-hero-label">{t("collect.heroLabel")}</p>
        <p className="collect-hero-big">
          <small>RM</small>
          {ready ? formatSen(total) : "—"}
        </p>
        {ready && groups.length > 0 && (
          <div className="collect-stack">
            {groups.slice(0, 4).map((g) => (
              <Avatar key={g.slug} name={g.customerName} />
            ))}
            <span>{t("collect.notInvoiced", { count: groups.length })}</span>
          </div>
        )}
      </section>

      <div className="collect-tabs" role="tablist" aria-label={t("collect.tabsLabel")}>
        <TabButton id="toSend" tab={tab} onTab={setTab} label={t("collect.tab.toSend")} count={groups.length} />
        <TabButton id="sent" tab={tab} onTab={setTab} label={t("collect.tab.sent")} count={invoices.length + olderSent.length} />
        <TabButton id="paid" tab={tab} onTab={setTab} label={t("collect.tab.paid")} count={paidCustomers.length} />
      </div>

      <div role="tabpanel" id={`collect-panel-${tab}`} aria-labelledby={`collect-tab-${tab}`}>
        {!ready ? (
          <p className="card loading" aria-busy="true">
            {t("common.loading")}
          </p>
        ) : tab === "toSend" ? (
          groups.length === 0 ? (
            <div className="card empty-state">
              <h2>{t("collect.empty.title")}</h2>
              <p>{t("collect.empty.body")}</p>
            </div>
          ) : (
            <ul className="collect-list">
              {groups.map((g) => (
                <CustomerCard
                  key={g.slug}
                  group={g}
                  on={Boolean(g.email) && !off.has(g.slug)}
                  onToggle={(on) =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(g.slug);
                      else next.add(g.slug);
                      return next;
                    })
                  }
                  onAddEmail={() => setEmailFor(g)}
                  previewing={showPane && previewGroup?.slug === g.slug}
                  onPreview={showPane ? () => setPreviewSlug(g.slug) : undefined}
                />
              ))}
            </ul>
          )
        ) : tab === "sent" ? (
          invoices.length + olderSent.length === 0 ? (
            <div className="card empty-state">
              <p>{t("collect.sent.empty")}</p>
            </div>
          ) : (
            <ul className="collect-list">
              {invoices.map((r) => (
                <li key={r.id}>
                  <Link href={`/collect/${encodeURIComponent(r.id)}`} className="card collect-row">
                    <Avatar name={r.customerName} />
                    <span className="tab-who">
                      <span className="tab-name">{r.customerName}</span>
                      <span className="tab-item">
                        {r.number
                          ? t("collect.sent.rowNumber", { number: r.number, day: formatDay(r.sentAt.slice(0, 10), { year: false }) })
                          : t("collect.sent.row", { day: formatDay(r.sentAt.slice(0, 10), { year: false }) })}
                      </span>
                    </span>
                    <span className="tab-amt">
                      {rm(r.amountSen)}
                      <ChevronIcon className="icon chev" />
                    </span>
                  </Link>
                </li>
              ))}
              {olderSent.map((c) => (
                <li key={c.customerName}>
                  <Link href={tabPath(customerSlug(c.customerName))} className="card collect-row">
                    <Avatar name={c.customerName} />
                    <span className="tab-who">
                      <span className="tab-name">{c.customerName}</span>
                      <span className="tab-item">{t("collect.sent.before")}</span>
                    </span>
                    <span className="tab-amt">
                      {rm(c.owedSen)}
                      <ChevronIcon className="icon chev" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : paidCustomers.length === 0 ? (
          <div className="card empty-state">
            <p>{t("collect.paid.empty")}</p>
          </div>
        ) : (
          <ul className="collect-list">
            {paidCustomers.map((c) => (
              <li key={c.slug}>
                <Link href={tabPath(c.slug)} className="card collect-row">
                  <Avatar name={c.customerName} />
                  <span className="tab-who">
                    <span className="tab-name">{c.customerName}</span>
                    <span className="tab-item">
                      {t("collect.paid.tabs", { count: c.count })}
                    </span>
                  </span>
                  <span className="tab-amt">
                    {rm(c.paidSen)}
                    <StatusBadge status="paid" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      </div>

      {showPane && preview && previewGroup && (
        <aside className="collect-pane" aria-label={t("collect.pane.label")}>
          {/* Announced when Preview switches whose invoice is shown. */}
          <p className="visually-hidden" aria-live="polite">
            {t(preview.willSend ? "collect.pane.showing" : "collect.pane.showingOff", { name: previewGroup.customerName })}
          </p>
          {!preview.willSend && (
            <p className="collect-pane-off" role="note">
              {preview.reason === "noEmail"
                ? t("collect.pane.offNoEmail", { name: previewGroup.customerName })
                : t("collect.pane.offSwitched", { name: previewGroup.customerName })}
            </p>
          )}
          {/* Focusable so a long invoice can be scrolled with the keyboard. */}
          <div
            className={`collect-pane-paper${preview.willSend ? "" : " collect-pane-paper-off"}`}
            tabIndex={0}
            role="region"
            aria-label={t("collect.pane.paper", { name: previewGroup.customerName })}
          >
            <Paper group={previewGroup} label={t("collect.pane.paperLabel", { name: previewGroup.customerName })} />
          </div>
          <div className="card collect-sendbox">
            <p className="collect-sendbox-total">
              <b>{rm(chosenTotal)}</b>
              <span>{t("collect.invoicesNoCharge", { count: chosen.length })}</span>
            </p>
            <button
              type="button"
              className="button button-primary collect-sendbox-go"
              disabled={chosen.length === 0}
              onClick={() => {
                setBatch(chosen);
                setPhase("send");
              }}
            >
              <SendIcon />
              {t("collect.sendButton", { count: chosen.length })}
            </button>
            <p className="collect-sendbox-note">
              {t("collect.sendNote")}
              {groups.some((g) => !g.email) ? ` ${t("collect.sendNoteNoEmail")}` : ""}
            </p>
          </div>
        </aside>
      )}
      </div>

      {tab === "toSend" && ready && groups.length > 0 && !showPane && (
        <div className="collect-bar">
          <p>
            <small>{t("collect.invoices", { count: chosen.length })}</small>
            <b>{rm(chosenTotal)}</b>
          </p>
          <button type="button" disabled={chosen.length === 0} onClick={() => setPhase("review")}>
            {t("collect.review")}
            <ChevronIcon />
          </button>
        </div>
      )}

      {emailFor && (
        <EmailSheet
          group={emailFor}
          onClose={() => setEmailFor(null)}
          onSaved={(slug) => {
            setOff((prev) => {
              const next = new Set(prev);
              next.delete(slug);
              return next;
            });
            setEmailFor(null);
          }}
        />
      )}
    </div>
  );
}

function paidSummaries(debts: ReturnType<typeof useDebts>["debts"]) {
  const bySlug = new Map<string, { customerName: string; slug: string; paidSen: number; count: number }>();
  for (const d of debts) {
    if (d.status !== "paid") continue;
    const slug = customerSlug(d.customerName);
    const row = bySlug.get(slug) ?? { customerName: d.customerName, slug, paidSen: 0, count: 0 };
    row.paidSen += d.amountSen;
    row.count += 1;
    bySlug.set(slug, row);
  }
  return [...bySlug.values()].sort((a, b) => b.paidSen - a.paidSen);
}

function TabButton({ id, tab, onTab, label, count }: { id: Tab; tab: Tab; onTab: (t: Tab) => void; label: string; count: number }) {
  const selected = tab === id;
  return (
    <button
      type="button"
      role="tab"
      id={`collect-tab-${id}`}
      aria-selected={selected}
      aria-controls={selected ? `collect-panel-${id}` : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={() => onTab(id)}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        const order: Tab[] = ["toSend", "sent", "paid"];
        const i = order.indexOf(id);
        const next = e.key === "ArrowRight" ? order[(i + 1) % 3] : e.key === "ArrowLeft" ? order[(i + 2) % 3] : null;
        if (next) {
          onTab(next);
          document.getElementById(`collect-tab-${next}`)?.focus();
        }
      }}
    >
      {label}
      <b>{count}</b>
    </button>
  );
}

function CustomerCard({
  group,
  on,
  onToggle,
  onAddEmail,
  previewing,
  onPreview,
}: {
  group: CollectGroup;
  on: boolean;
  onToggle: (on: boolean) => void;
  onAddEmail: () => void;
  /** Laptop only: this card's invoice is the one in the side pane. */
  previewing?: boolean;
  onPreview?: () => void;
}) {
  const { t } = useT();
  const missing = !group.email;
  return (
    <li className={`card collect-card${missing ? " collect-card-missing" : ""}${previewing ? " collect-card-previewing" : ""}`}>
      <Avatar name={group.customerName} />
      <span className="tab-who">
        <span className="tab-name">{group.customerName}</span>
        <StatusBadge status={group.status} />
        {group.pending ? (
          <span className="collect-pending">{t("collect.card.pending", { email: group.email ?? "" })}</span>
        ) : missing ? (
          <button type="button" className="collect-add-email" onClick={onAddEmail}>
            <PlusIcon />
            {t("collect.card.addEmail")}
          </button>
        ) : (
          <button type="button" className="collect-email" onClick={onAddEmail} aria-label={t("collect.card.changeEmail", { name: group.customerName, email: group.email ?? "" })}>
            {group.email}
          </button>
        )}
      </span>
      <span className="collect-amt">{rm(group.totalSen)}</span>
      {onPreview && (
        <button
          type="button"
          className="collect-preview-btn"
          aria-pressed={previewing}
          aria-label={t("collect.card.previewLabel", { name: group.customerName })}
          onClick={onPreview}
        >
          {t("collect.card.preview")}
        </button>
      )}
      <button
        type="button"
        role="switch"
        className="collect-switch"
        aria-checked={on}
        disabled={missing}
        aria-label={missing ? t("collect.card.switchNoEmail", { name: group.customerName }) : t("collect.card.switch", { name: group.customerName, amount: rm(group.totalSen) })}
        onClick={() => onToggle(!on)}
      />
    </li>
  );
}

function EmailSheet({ group, onClose, onSaved }: { group: CollectGroup; onClose: () => void; onSaved: (slug: string) => void }) {
  const { setEmail } = useCollect();
  const { t } = useT();
  const [value, setValue] = useState(group.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      // Keep Tab inside the sheet while it's open.
      const items = sheetRef.current?.querySelectorAll<HTMLElement>("button, input");
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  function save() {
    if (!isValidEmail(value)) {
      setError(t("collect.email.invalid"));
      inputRef.current?.focus();
      return;
    }
    try {
      setEmail(group.slug, value);
    } catch (e) {
      setError(e instanceof CollectStoreError ? e.message : t("collect.saveFailed"));
      return;
    }
    onSaved(group.slug);
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="email-sheet-title" ref={sheetRef}>
        <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who">
          <Avatar name={group.customerName} className="avatar avatar-lg" />
          <h2 id="email-sheet-title">{t("collect.email.title", { name: group.customerName })}</h2>
          <p>{t("collect.email.intro")}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="visually-hidden" htmlFor="email-sheet-input">
            {t("collect.email.label")}
          </label>
          <div className={`sheet-input${error ? " sheet-input-error" : ""}`}>
            <MailIcon />
            <input
              ref={inputRef}
              id="email-sheet-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("collect.email.placeholder")}
              value={value}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "email-sheet-error" : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
          </div>
          {error && (
            <p className="field-error" id="email-sheet-error" role="alert">
              {error}
            </p>
          )}
          <div className="sheet-chips" aria-label={t("collect.email.endings")}>
            {EMAIL_DOMAINS.map((domain) => (
              <button
                key={domain}
                type="button"
                onClick={() => {
                  const next = withDomain(value, domain);
                  if (next) setValue(next);
                  inputRef.current?.focus();
                }}
              >
                @{domain}
              </button>
            ))}
          </div>
          <button type="submit" className="button button-primary tab-pay">
            {t("collect.email.save")}
          </button>
        </form>
        <p className="tab-note">{t("collect.email.note")}</p>
      </div>
    </div>
  );
}


/** One invoice, drawn like the paper the customer gets. Used by Review (phone) and the side pane (laptop). */
function Paper({ group: g, label }: { group: CollectGroup; label: string }) {
  const { name: shopName } = useShop();
  const { t, formatDay } = useT();
  return (
    <article className="paper" aria-label={label}>
      <div className="paper-head">
        <p className="paper-from">
          {shopName}
          <small>{t("invoice.via")}</small>
        </p>
        <span className="paper-tag">{t("invoice.tag")}</span>
      </div>
      <p className="paper-to">
        {t("invoice.billTo")}<b>{g.customerName}</b>
        {g.email ?? t("invoice.noEmail")}
      </p>
      <ul className="paper-lines">
        {g.debts.map((d) => (
          <li key={d.id}>
            <span>
              {/* Same fallback as the real PayPal line, so the preview matches the invoice. */}
              {d.item || SHOP_ITEMS}
              <small>{formatDay(d.date)}</small>
            </span>
            <span>{formatSen(d.amountSen)}</span>
          </li>
        ))}
      </ul>
      <p className="paper-total">
        <span>{t("invoice.total")}</span>
        <b>{rm(g.totalSen)}</b>
      </p>
      <p className="paper-pay">{t("invoice.payNote")}</p>
      <div className="paper-perf" aria-hidden="true" />
    </article>
  );
}

/* Review: one paper-style preview per invoice, swipe between them */

function Review({ groups, onBack, onSend }: { groups: CollectGroup[]; onBack: () => void; onSend: () => void }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const total = groups.reduce((sum, g) => sum + g.totalSen, 0);

  useEffect(() => titleRef.current?.focus(), []);

  function go(i: number) {
    const rail = railRef.current;
    const card = rail?.children[i] as HTMLElement | undefined;
    if (rail && card) rail.scrollTo({ left: card.offsetLeft - rail.offsetLeft, behavior: "smooth" });
  }

  return (
    <div className="collect">
      <div className="tab-top">
        <button type="button" className="tab-back" aria-label={t("common.back")} onClick={onBack}>
          <BackIcon />
        </button>
        <h1 ref={titleRef} tabIndex={-1}>
          {t("collect.review.title", { count: groups.length })}
        </h1>
        <span className="tab-back" aria-hidden="true" />
      </div>

      <div
        className="paper-rail"
        ref={railRef}
        onScroll={(e) => {
          const rail = e.currentTarget;
          const first = rail.children[0] as HTMLElement | undefined;
          const second = rail.children[1] as HTMLElement | undefined;
          // Distance between cards (card width plus the gap), so the dot is right for any count.
          const step = first && second ? second.offsetLeft - first.offsetLeft : rail.clientWidth;
          setIndex(Math.round(rail.scrollLeft / Math.max(1, step)));
        }}
      >
        {groups.map((g, i) => (
          <Paper key={g.slug} group={g} label={t("collect.review.paperLabel", { n: i + 1, total: groups.length, name: g.customerName })} />
        ))}
      </div>

      {groups.length > 1 && (
        <div className="paper-dots" aria-hidden="true">
          {groups.map((g, i) => (
            <i key={g.slug} className={i === index ? "on" : undefined} />
          ))}
        </div>
      )}

      {groups.length > 1 && (
        <div className="paper-chips">
          {groups.map((g, i) => (
            <button key={g.slug} type="button" aria-current={i === index || undefined} onClick={() => go(i)}>
              <Avatar name={g.customerName} />
              {rm(g.totalSen)}
            </button>
          ))}
        </div>
      )}

      <div className="collect-bar">
        <p>
          <small>{t("collect.invoicesNoCharge", { count: groups.length })}</small>
          <b>{rm(total)}</b>
        </p>
        <button type="button" onClick={onSend}>
          <SendIcon />
          {t("collect.review.sendAll")}
        </button>
      </div>
    </div>
  );
}

/* Send: one request per customer, each with its own result and Retry */

type Saved = { id: string; number?: string; payerLink?: string };
type Result =
  | { state: "waiting" | "sending" }
  | { state: "sent"; id: string; number?: string }
  | { state: "saveFailed"; saved: Saved; request: PendingSend }
  | { state: "failed"; message: string };

function resultText(r: Result, t: T): string {
  switch (r.state) {
    case "waiting":
      return t("collect.send.waiting");
    case "sending":
      return t("collect.send.sending");
    case "failed":
      return r.message;
    case "sent":
      return r.number ? t("collect.send.sentNumber", { number: r.number }) : t("collect.send.sent");
    case "saveFailed":
      return t("collect.send.saveFailed");
  }
}

function Send({ groups, onDone }: { groups: CollectGroup[]; onDone: () => void }) {
  const { updateMany } = useDebts();
  const { invoices, addInvoice, setPending, clearPending } = useCollect();
  const { t } = useT();
  // Invoices already sent for each customer's tabs, fixed when the batch starts. A retry
  // then rebuilds exactly the same request id, even if another tab saved an invoice since.
  const [previous] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      groups.map((g) => {
        const ids = new Set(g.debts.map((d) => d.id));
        return [g.slug, invoices.filter((r) => r.debtIds.some((id) => ids.has(id))).map((r) => r.id)];
      }),
    ),
  );
  // Customers with a request in flight, so a double-tap on Retry can't send twice at once.
  const inFlight = useRef<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>(() =>
    Object.fromEntries(groups.map((g) => [g.slug, { state: "waiting" } as Result])),
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  /** Saves a sent invoice on this device: the record, the debts marked sent, the pending send cleared. */
  function saveSent(g: CollectGroup, saved: Saved, request: PendingSend) {
    try {
      addInvoice({
        id: saved.id,
        number: saved.number,
        customerName: request.customerName,
        slug: request.slug,
        email: request.email,
        debtIds: request.debtIds,
        amountSen: request.amountSen,
        sentAt: new Date().toISOString(),
        payerLink: saved.payerLink,
      });
      updateMany(request.debtIds, { status: "sent" });
      clearPending(request.slug);
    } catch (e) {
      if (!(e instanceof CollectStoreError || e instanceof DebtStoreError)) throw e;
      setResults((prev) => ({ ...prev, [g.slug]: { state: "saveFailed", saved, request } }));
      return;
    }
    setResults((prev) => ({ ...prev, [g.slug]: { state: "sent", id: saved.id, number: saved.number } }));
  }

  async function sendOne(g: CollectGroup) {
    if (inFlight.current.has(g.slug)) return;
    inFlight.current.add(g.slug);
    try {
      await attempt(g);
    } finally {
      inFlight.current.delete(g.slug);
    }
  }

  async function attempt(g: CollectGroup) {
    setResults((prev) => ({ ...prev, [g.slug]: { state: "sending" } }));
    // Not translated: the PayPal request (and its retry ID) must not change with the app language.
    const request = sendRequest(g, new Date(), previous[g.slug]);
    try {
      // Saved first, so if the answer is lost the retry sends exactly this again.
      setPending(request);
    } catch {
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: t("collect.send.deviceFailed") } }));
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerName: request.customerName, email: request.email, lines: request.lines, requestId: request.requestId, debtIds: request.debtIds }),
      });
    } catch {
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: t("collect.send.offline") } }));
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string; number?: string; payerLink?: string; error?: string };
    if (!response.ok || !data.id) {
      // PayPal said no for sure (bad email, cancelled…): nothing went out, so a corrected
      // invoice may use a new request. Otherwise the outcome is unknown: keep the pending send.
      if (response.status >= 400 && response.status < 500) {
        try {
          clearPending(request.slug);
        } catch {
          // Harmless: the retry would resend the same request.
        }
      }
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: data.error ?? t("collect.send.noAnswer") } }));
      return;
    }
    saveSent(g, { id: data.id, number: data.number, payerLink: data.payerLink }, request);
  }

  async function sendAll(list: CollectGroup[]) {
    for (const g of list) await sendOne(g);
    titleRef.current?.focus();
  }

  // If the owner leaves mid-send, the loop finishes in the background and still saves each
  // result, so nothing is lost; it just isn't shown.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendAll(groups);
    // Runs once per batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = groups.map((g) => ({ g, r: results[g.slug] }));
  const sent = list.filter((x) => x.r.state === "sent");
  const failed = list.filter((x) => x.r.state === "failed" || x.r.state === "saveFailed");
  const busy = list.some((x) => x.r.state === "sending" || x.r.state === "waiting");
  const pct = groups.length === 0 ? 0 : sent.length / groups.length;
  // Gone out on PayPal, whether or not this device managed to save it.
  const out = list.filter((x) => x.r.state === "sent" || x.r.state === "saveFailed");
  const unsaved = list.filter((x) => x.r.state === "saveFailed").length;
  const notSent = list.filter((x) => x.r.state === "failed").length;
  const outTotal = out.reduce((sum, x) => sum + x.g.totalSen, 0);
  const R = 64;
  const C = 2 * Math.PI * R;

  return (
    <div className="collect">
      <div className="send-ring" role="progressbar" aria-label={t("collect.send.progress")} aria-valuemin={0} aria-valuemax={groups.length} aria-valuenow={sent.length}>
        <svg viewBox="0 0 150 150" aria-hidden="true">
          <circle cx="75" cy="75" r={R} className="send-ring-track" />
          <circle cx="75" cy="75" r={R} className="send-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <p>
          <b>
            {sent.length}/{groups.length}
          </b>
          <small>{t("collect.send.ringSent")}</small>
        </p>
      </div>

      <div className="send-head" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          {busy ? t("collect.send.busyTitle") : out.length > 0 ? t("collect.send.onItsWay", { amount: rm(outTotal) }) : t("collect.send.nothingSent")}
        </h1>
        <p>
          {busy
            ? t("collect.send.busyBody")
            : [
                notSent > 0 && t("collect.send.notSent", { count: notSent }),
                unsaved > 0 && t("collect.send.unsaved", { count: unsaved }),
                notSent === 0 && unsaved === 0 && t("collect.send.emailed", { count: sent.length }),
              ]
                .filter(Boolean)
                .join(" ")}
        </p>
      </div>

      <ul className="collect-list">
        {list.map(({ g, r }) => (
          <li key={g.slug} className={`card send-row${r.state === "failed" || r.state === "saveFailed" ? " send-row-failed" : ""}`}>
            <span className={`send-dot send-dot-${r.state === "saveFailed" ? "failed" : r.state}`} aria-hidden="true">
              {r.state === "sent" ? <CheckIcon /> : r.state === "failed" || r.state === "saveFailed" ? <CloseIcon /> : null}
            </span>
            <span className="tab-who">
              <span className="tab-name">{g.customerName}</span>
              <span className={`tab-item${r.state === "failed" || r.state === "saveFailed" ? " send-error" : ""}`}>
                {resultText(r, t)}
              </span>
            </span>
            {r.state === "saveFailed" ? (
              <button type="button" className="send-retry" onClick={() => saveSent(g, r.saved, r.request)}>
                {t("common.save")}
              </button>
            ) : r.state === "failed" ? (
              <button type="button" className="send-retry" onClick={() => void sendOne(g)}>
                {t("collect.send.retry")}
              </button>
            ) : (
              <span className="tab-amt">{rm(g.totalSen)}</span>
            )}
          </li>
        ))}
      </ul>

      {!busy && (
        <div className="collect-bar collect-bar-light">
          <p>
            <small>{failed.length > 0 ? t("collect.send.needRetry", { count: failed.length }) : t("collect.send.allDone")}</small>
            <b>{t("collect.send.ofSent", { sent: sent.length, total: groups.length })}</b>
          </p>
          {failed.length > 0 && (
            <button
              type="button"
              className="collect-bar-ghost"
              onClick={() => {
                for (const x of failed) if (x.r.state === "saveFailed") saveSent(x.g, x.r.saved, x.r.request);
                void sendAll(failed.filter((x) => x.r.state === "failed").map((x) => x.g));
              }}
            >
              {t("collect.send.retryCount", { count: failed.length })}
            </button>
          )}
          <button type="button" onClick={onDone}>
            {t("collect.send.done")}
          </button>
        </div>
      )}
    </div>
  );
}
