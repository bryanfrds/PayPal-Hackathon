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
  withDomain,
  type CollectGroup,
  type PendingSend,
} from "@/lib/collect";
import { CollectStoreError } from "@/lib/collect-store";
import { customerSlug, formatDay, tabPath } from "@/lib/customer-tab";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen } from "@/lib/debts";
import { customerSummaries } from "@/lib/home";
import Avatar from "../components/Avatar";
import StatusBadge from "../components/StatusBadge";
import { BackIcon, CheckIcon, ChevronIcon, CloseIcon, MailIcon, PlusIcon, SendIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useIsWide } from "../useIsWide";
import { useDebts } from "../useDebts";

const SHOP_NAME = "Kedai Ah Seng";

type Phase = "list" | "review" | "send";
type Tab = "toSend" | "sent" | "paid";

const rm = (sen: number) => `RM ${formatSen(sen)}`;

export default function CollectFlow() {
  const { debts, ready } = useDebts();
  const { emails, invoices, pending } = useCollect();
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
        <h1>Collect</h1>
      </div>

      <div className="collect-cols">
      <div className="collect-left">

      <section className="collect-hero" aria-labelledby="collect-hero-label">
        <p id="collect-hero-label">Ready to collect</p>
        <p className="collect-hero-big">
          <small>RM</small>
          {ready ? formatSen(total) : "—"}
        </p>
        {ready && groups.length > 0 && (
          <div className="collect-stack">
            {groups.slice(0, 4).map((g) => (
              <Avatar key={g.slug} name={g.customerName} />
            ))}
            <span>{groups.length === 1 ? "1 customer" : `${groups.length} customers`} not invoiced yet</span>
          </div>
        )}
      </section>

      <div className="collect-tabs" role="tablist" aria-label="Invoices">
        <TabButton id="toSend" tab={tab} onTab={setTab} label="To send" count={groups.length} />
        <TabButton id="sent" tab={tab} onTab={setTab} label="Sent" count={invoices.length + olderSent.length} />
        <TabButton id="paid" tab={tab} onTab={setTab} label="Paid" count={paidCustomers.length} />
      </div>

      <div role="tabpanel" id={`collect-panel-${tab}`} aria-labelledby={`collect-tab-${tab}`}>
        {!ready ? (
          <p className="card loading" aria-busy="true">
            Loading…
          </p>
        ) : tab === "toSend" ? (
          groups.length === 0 ? (
            <div className="card empty-state">
              <h2>Nothing to invoice</h2>
              <p>Every tab already has an invoice. New tabs show up here.</p>
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
              <p>No invoices sent yet.</p>
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
                        {r.number ? `Invoice ${r.number} · ` : ""}sent {formatDay(r.sentAt.slice(0, 10)).replace(/ \d{4}$/, "")}
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
                      <span className="tab-item">Sent before this app</span>
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
            <p>No payments yet.</p>
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
                      {c.count} {c.count === 1 ? "tab" : "tabs"} paid
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
        <aside className="collect-pane" aria-label="Invoice preview">
          {/* Announced when Preview switches whose invoice is shown. */}
          <p className="visually-hidden" aria-live="polite">
            Showing {previewGroup.customerName}'s invoice{preview.willSend ? "" : ", not being sent"}
          </p>
          {!preview.willSend && (
            <p className="collect-pane-off" role="note">
              {preview.reason === "noEmail"
                ? `Not being sent: add ${previewGroup.customerName}'s email first.`
                : `Not being sent: ${previewGroup.customerName} is switched off.`}
            </p>
          )}
          {/* Focusable so a long invoice can be scrolled with the keyboard. */}
          <div
            className={`collect-pane-paper${preview.willSend ? "" : " collect-pane-paper-off"}`}
            tabIndex={0}
            role="region"
            aria-label={`${previewGroup.customerName}'s invoice`}
          >
            <Paper group={previewGroup} label={`Preview of ${previewGroup.customerName}'s invoice`} />
          </div>
          <div className="card collect-sendbox">
            <p className="collect-sendbox-total">
              <b>{rm(chosenTotal)}</b>
              <span>{chosen.length === 1 ? "1 invoice" : `${chosen.length} invoices`} · nothing is charged</span>
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
              {chosen.length === 1 ? "Send 1 PayPal invoice" : `Send ${chosen.length} PayPal invoices`}
            </button>
            <p className="collect-sendbox-note">
              Each customer gets their own invoice by email.
              {groups.some((g) => !g.email) ? " Customers without an email are left out until you add one." : ""}
            </p>
          </div>
        </aside>
      )}
      </div>

      {tab === "toSend" && ready && groups.length > 0 && !showPane && (
        <div className="collect-bar">
          <p>
            <small>{chosen.length === 1 ? "1 invoice" : `${chosen.length} invoices`}</small>
            <b>{rm(chosenTotal)}</b>
          </p>
          <button type="button" disabled={chosen.length === 0} onClick={() => setPhase("review")}>
            Review
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
  const missing = !group.email;
  return (
    <li className={`card collect-card${missing ? " collect-card-missing" : ""}${previewing ? " collect-card-previewing" : ""}`}>
      <Avatar name={group.customerName} />
      <span className="tab-who">
        <span className="tab-name">{group.customerName}</span>
        <StatusBadge status={group.status} />
        {group.pending ? (
          <span className="collect-pending">Last send didn&apos;t finish · {group.email}</span>
        ) : missing ? (
          <button type="button" className="collect-add-email" onClick={onAddEmail}>
            <PlusIcon />
            Add email
          </button>
        ) : (
          <button type="button" className="collect-email" onClick={onAddEmail} aria-label={`Change ${group.customerName}'s email, ${group.email}`}>
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
          aria-label={`Preview ${group.customerName}'s invoice`}
          onClick={onPreview}
        >
          Preview
        </button>
      )}
      <button
        type="button"
        role="switch"
        className="collect-switch"
        aria-checked={on}
        disabled={missing}
        aria-label={missing ? `Add an email to invoice ${group.customerName}` : `Invoice ${group.customerName}, ${rm(group.totalSen)}`}
        onClick={() => onToggle(!on)}
      />
    </li>
  );
}

function EmailSheet({ group, onClose, onSaved }: { group: CollectGroup; onClose: () => void; onSaved: (slug: string) => void }) {
  const { setEmail } = useCollect();
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
      setError("That doesn't look like an email. Check for the @ and the ending.");
      inputRef.current?.focus();
      return;
    }
    try {
      setEmail(group.slug, value);
    } catch (e) {
      setError(e instanceof CollectStoreError ? e.message : "Couldn't save. Try again.");
      return;
    }
    onSaved(group.slug);
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="email-sheet-title" ref={sheetRef}>
        <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who">
          <Avatar name={group.customerName} className="avatar avatar-lg" />
          <h2 id="email-sheet-title">{group.customerName}&apos;s email</h2>
          <p>PayPal sends the invoice here, with a Pay button.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="visually-hidden" htmlFor="email-sheet-input">
            Email
          </label>
          <div className={`sheet-input${error ? " sheet-input-error" : ""}`}>
            <MailIcon />
            <input
              ref={inputRef}
              id="email-sheet-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@gmail.com"
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
          <div className="sheet-chips" aria-label="Common endings">
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
            Save and include
          </button>
        </form>
        <p className="tab-note">Saved on this device for next time.</p>
      </div>
    </div>
  );
}


/** One invoice, drawn like the paper the customer gets. Used by Review (phone) and the side pane (laptop). */
function Paper({ group: g, label }: { group: CollectGroup; label: string }) {
  return (
    <article className="paper" aria-label={label}>
      <div className="paper-head">
        <p className="paper-from">
          {SHOP_NAME}
          <small>Invoice via PayPal</small>
        </p>
        <span className="paper-tag">INVOICE</span>
      </div>
      <p className="paper-to">
        Bill to<b>{g.customerName}</b>
        {g.email ?? "No email yet"}
      </p>
      <ul className="paper-lines">
        {g.debts.map((d) => (
          <li key={d.id}>
            <span>
              {d.item || "Shop items"}
              <small>{formatDay(d.date)}</small>
            </span>
            <span>{formatSen(d.amountSen)}</span>
          </li>
        ))}
      </ul>
      <p className="paper-total">
        <span>Total (MYR)</span>
        <b>{rm(g.totalSen)}</b>
      </p>
      <p className="paper-pay">The customer gets PayPal&apos;s Pay button here: PayPal or card.</p>
      <div className="paper-perf" aria-hidden="true" />
    </article>
  );
}

/* Review: one paper-style preview per invoice, swipe between them */

function Review({ groups, onBack, onSend }: { groups: CollectGroup[]; onBack: () => void; onSend: () => void }) {
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
        <button type="button" className="tab-back" aria-label="Back" onClick={onBack}>
          <BackIcon />
        </button>
        <h1 ref={titleRef} tabIndex={-1}>
          Review {groups.length === 1 ? "1 invoice" : `${groups.length} invoices`}
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
          <Paper key={g.slug} group={g} label={`Invoice ${i + 1} of ${groups.length}, ${g.customerName}`} />
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
          <small>{groups.length === 1 ? "1 invoice" : `${groups.length} invoices`} · nothing is charged</small>
          <b>{rm(total)}</b>
        </p>
        <button type="button" onClick={onSend}>
          <SendIcon />
          Send all
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

function resultText(r: Result): string {
  switch (r.state) {
    case "waiting":
      return "Waiting";
    case "sending":
      return "Sending…";
    case "failed":
      return r.message;
    case "sent":
      return `Sent${r.number ? ` · Invoice ${r.number}` : ""}`;
    case "saveFailed":
      return "Sent on PayPal, but this device couldn't save it.";
  }
}

function Send({ groups, onDone }: { groups: CollectGroup[]; onDone: () => void }) {
  const { updateMany } = useDebts();
  const { invoices, addInvoice, setPending, clearPending } = useCollect();
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
    const request = sendRequest(g, new Date(), previous[g.slug]);
    try {
      // Saved first, so if the answer is lost the retry sends exactly this again.
      setPending(request);
    } catch {
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: "This device couldn't save. Try again." } }));
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerName: request.customerName, email: request.email, lines: request.lines, requestId: request.requestId }),
      });
    } catch {
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: "No internet connection. Try again." } }));
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
      setResults((prev) => ({ ...prev, [g.slug]: { state: "failed", message: data.error ?? "PayPal didn't answer. Try again." } }));
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
      <div className="send-ring" role="progressbar" aria-label="Invoices sent" aria-valuemin={0} aria-valuemax={groups.length} aria-valuenow={sent.length}>
        <svg viewBox="0 0 150 150" aria-hidden="true">
          <circle cx="75" cy="75" r={R} className="send-ring-track" />
          <circle cx="75" cy="75" r={R} className="send-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <p>
          <b>
            {sent.length}/{groups.length}
          </b>
          <small>sent</small>
        </p>
      </div>

      <div className="send-head" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          {busy ? "Sending invoices…" : out.length > 0 ? `${rm(outTotal)} on its way` : "Nothing was sent"}
        </h1>
        <p>
          {busy
            ? "PayPal is emailing each customer."
            : [
                notSent > 0 && `${notSent === 1 ? "1 invoice" : `${notSent} invoices`} couldn't be sent. Retry is safe: it never sends twice.`,
                unsaved > 0 && `${unsaved === 1 ? "1 invoice was" : `${unsaved} invoices were`} sent but not saved on this device. Tap Save.`,
                notSent === 0 && unsaved === 0 && `PayPal has emailed ${sent.length === 1 ? "1 customer" : `${sent.length} customers`}.`,
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
                {resultText(r)}
              </span>
            </span>
            {r.state === "saveFailed" ? (
              <button type="button" className="send-retry" onClick={() => saveSent(g, r.saved, r.request)}>
                Save
              </button>
            ) : r.state === "failed" ? (
              <button type="button" className="send-retry" onClick={() => void sendOne(g)}>
                Retry
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
            <small>{failed.length > 0 ? `${failed.length} need a retry` : "All done"}</small>
            <b>
              {sent.length} of {groups.length} sent
            </b>
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
              Retry {failed.length}
            </button>
          )}
          <button type="button" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
