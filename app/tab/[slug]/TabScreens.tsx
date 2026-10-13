"use client";

// The customer's own tab, SPayLater-style: what they owe, bills by month, history and paying.
// Reads the same debts as the shop's ledger (see lib/customer-tab.ts for the rules).

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatSen, todayLocal, type Debt } from "@/lib/debts";
import {
  customerTab,
  daysBetween,
  formatDay,
  formatMonth,
  initialPayCount,
  payableSen,
  tabPath,
  toggleBill,
  type Bill,
  type CustomerTab,
} from "@/lib/customer-tab";
import Logo from "../../components/Logo";
import { BackIcon, BagIcon, CheckIcon, ChevronIcon, ClockIcon, NoteIcon } from "../../components/icons";
import { invoicePayState, isPayPalUrl, payPlan, type InvoicePayState } from "@/lib/customer-pay";
import type { InvoiceRecord } from "@/lib/collect-store";
import { useCollect } from "../../useCollect";
import { useDebts } from "../../useDebts";

const SHOP_NAME = "Kedai Ah Seng";

type Loaded = { tab: CustomerTab; today: string };

/** Loads the tab, and shows loading / not-found states so each screen only handles the happy path. */
function WithTab({ slug, children }: { slug: string; children: (loaded: Loaded) => ReactNode }) {
  const { debts, ready, unreadable } = useDebts();
  if (!ready) {
    return (
      <p className="card loading" aria-busy="true">
        Loading your tab…
      </p>
    );
  }
  if (unreadable) {
    return (
      <div className="card empty-state" role="alert">
        <h1 className="tab-empty-title">Your tab couldn&apos;t be loaded</h1>
        <p>Something went wrong reading the saved tabs. Ask {SHOP_NAME} to check the app.</p>
      </div>
    );
  }
  const today = todayLocal();
  const tab = customerTab(debts, slug, today);
  if (!tab) {
    return (
      <div className="card empty-state">
        <h1 className="tab-empty-title">We can&apos;t find this tab</h1>
        <p>The link may be old, or the shop has removed it. Ask {SHOP_NAME} to send it again.</p>
      </div>
    );
  }
  return <>{children({ tab, today })}</>;
}

function TopBar({ title, back }: { title: string; back: string }) {
  return (
    <div className="tab-top">
      <Link href={back} className="tab-back" aria-label="Back">
        <BackIcon />
      </Link>
      <h1>{title}</h1>
      <span className="tab-back" aria-hidden="true" />
    </div>
  );
}

function rm(sen: number) {
  return `RM ${formatSen(sen)}`;
}

function BillBadge({ bill, today }: { bill: Bill; today: string }) {
  if (bill.status === "paid") return <span className="badge badge-paid badge-text">Paid</span>;
  if (bill.status === "overdue") {
    const late = daysBetween(bill.dueDate, today);
    return (
      <span className="badge badge-overdue badge-text">
        {late > 0 ? `Overdue ${late} ${late === 1 ? "day" : "days"}` : "Overdue"}
      </span>
    );
  }
  return <span className="badge badge-unpaid badge-text">Due {formatDay(bill.dueDate)}</span>;
}

function DebtRow({ debt, label }: { debt: Debt; label?: string }) {
  const paid = debt.status === "paid";
  return (
    <li className="tab-row">
      <span className={`tab-icon${paid ? " tab-icon-paid" : ""}`} aria-hidden="true">
        {paid ? <CheckIcon /> : <BagIcon />}
      </span>
      <span className="tab-who">
        {label && <span className="tab-name">{label}</span>}
        <span className={label ? "tab-item" : "tab-name"}>{debt.item || "No item written"}</span>
        <span className="tab-item">
          {formatDay(debt.date)}
          {paid ? " · Paid" : ""}
        </span>
      </span>
      <span className="tab-amt">{rm(debt.amountSen)}</span>
    </li>
  );
}

function BillCard({ bill, today, slug, year }: { bill: Bill; today: string; slug: string; year: number }) {
  return (
    <li>
      <Link href={`${tabPath(slug)}/bills/${bill.month}`} className="card bill-card">
        <span className="tab-who">
          <span className="bill-month">{formatMonth(bill.month, year)}</span>
          <BillBadge bill={bill} today={today} />
          <span className="tab-item">
            {bill.debts.length} {bill.debts.length === 1 ? "item" : "items"}
          </span>
        </span>
        <span className="tab-amt">
          {rm(bill.status === "paid" ? bill.totalSen : bill.unpaidSen)}
          <ChevronIcon className="icon chev" />
        </span>
      </Link>
    </li>
  );
}

/* 1 · Your tab */
export function TabHome({ slug }: { slug: string }) {
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const usedPct = Math.min(100, Math.round(((tab.limitSen - tab.leftSen) / tab.limitSen) * 100));
        const overdue = tab.toPay.filter((b) => b.status === "overdue");
        const next = tab.toPay.find((b) => b.status === "due");
        const year = Number(today.slice(0, 4));
        return (
          <div className="tab-page">
            <div className="app-head">
              <Logo />
            </div>
            <div className="tab-intro">
              <p className="dash-hello">{tab.customerName}, your tab at</p>
              <h1 className="dash-shop">{SHOP_NAME}</h1>
            </div>

            <section className="tab-hero" aria-labelledby="owe-label">
              <p className="tab-hero-label" id="owe-label">
                You owe
              </p>
              <p className="tab-hero-big">
                <small>RM</small>
                {formatSen(tab.owedSen)}
              </p>
              <div
                className="tab-limit"
                role="progressbar"
                aria-label="Share of your credit limit used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={usedPct}
              >
                <b style={{ width: `${usedPct}%` }} />
              </div>
              <p className="tab-hero-label">
                {rm(tab.leftSen)} left of your {rm(tab.limitSen)} limit
              </p>
            </section>

            <section className="card tab-bill">
              {tab.toPay.length === 0 ? (
                <>
                  <p className="tab-hero-label">To pay</p>
                  <p className="tab-bill-amt">RM 0.00</p>
                  <p className="tab-bill-due">You&apos;re all paid up. Terima kasih!</p>
                </>
              ) : (
                <>
                  <p className="tab-hero-label">To pay</p>
                  <p className="tab-bill-amt">{rm(tab.owedSen)}</p>
                  <p className="tab-bill-due">
                    <span className={`dot ${overdue.length ? "dot-over" : "dot-due"}`} aria-hidden="true" />
                    {overdue.length > 0
                      ? `${overdue.map((b) => formatMonth(b.month, year)).join(", ")} overdue`
                      : null}
                    {overdue.length > 0 && next ? " · " : null}
                    {next ? `${formatMonth(next.month, year)} due ${formatDay(next.dueDate)}` : null}
                  </p>
                  <Link href={`${tabPath(slug)}/pay`} className="button button-primary tab-pay">
                    Pay now
                  </Link>
                  <p className="tab-note">Pick which bills to pay, then pay through PayPal.</p>
                </>
              )}
              <div className="tab-links">
                <Link href={`${tabPath(slug)}/bills`}>
                  <NoteIcon />
                  My bills
                </Link>
                <Link href={`${tabPath(slug)}/history`}>
                  <ClockIcon />
                  History
                </Link>
              </div>
            </section>

            <div className="section-head">
              <h2>Recent</h2>
            </div>
            <ul className="tab-list">
              {tab.history.slice(0, 3).map((debt) => (
                <DebtRow key={debt.id} debt={debt} />
              ))}
            </ul>
            <p className="powered">Invoices and payments by PayPal</p>
          </div>
        );
      }}
    </WithTab>
  );
}

/* 2 · My bills */
export function TabBills({ slug }: { slug: string }) {
  const [view, setView] = useState<"toPay" | "paid">("toPay");
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const year = Number(today.slice(0, 4));
        const bills = view === "toPay" ? tab.toPay : tab.paid;
        return (
          <div className="tab-page">
            <TopBar title="My bills" back={tabPath(slug)} />
            <div className="segmented" role="group" aria-label="Which bills">
              <button type="button" aria-pressed={view === "toPay"} onClick={() => setView("toPay")}>
                To pay
              </button>
              <button type="button" aria-pressed={view === "paid"} onClick={() => setView("paid")}>
                Paid
              </button>
            </div>
            {bills.length === 0 ? (
              <div className="card empty-state">
                <p>{view === "toPay" ? "Nothing to pay. You're all paid up." : "No paid bills yet."}</p>
              </div>
            ) : (
              <ul className="bill-list">
                {bills.map((bill) => (
                  <BillCard key={bill.month} bill={bill} today={today} slug={slug} year={year} />
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </WithTab>
  );
}

/* 3 · Bill detail */
export function TabBillDetail({ slug, month }: { slug: string; month: string }) {
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const bill = [...tab.toPay, ...tab.paid].find((b) => b.month === month);
        if (!bill) {
          return (
            <div className="tab-page">
              <TopBar title="Bill" back={`${tabPath(slug)}/bills`} />
              <div className="card empty-state">
                <p>There&apos;s no bill for that month.</p>
              </div>
            </div>
          );
        }
        const first = bill.debts[0].date;
        const last = bill.debts[bill.debts.length - 1].date;
        return (
          <div className="tab-page">
            <TopBar title={`${formatMonth(bill.month, Number(today.slice(0, 4)))} bill`} back={`${tabPath(slug)}/bills`} />
            <section className="card bill-breakdown">
              <div className="bill-left">
                <p className="tab-hero-label">Left to pay</p>
                <p className="bill-left-amt">
                  <small>RM</small>
                  {formatSen(bill.unpaidSen)}
                </p>
                <BillBadge bill={bill} today={today} />
              </div>
              <dl>
                <div>
                  <dt>Took on tab</dt>
                  <dd>+ {rm(bill.totalSen)}</dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>{bill.paidSen ? `− ${rm(bill.paidSen)}` : "RM 0.00"}</dd>
                </div>
                <div className="bill-total">
                  <dt>Left to pay</dt>
                  <dd>{rm(bill.unpaidSen)}</dd>
                </div>
              </dl>
            </section>
            <p className="bill-meta">
              <span>
                {bill.debts.length} {bill.debts.length === 1 ? "item" : "items"}
              </span>
              <span>{first === last ? formatDay(first) : `${formatDay(first)} – ${formatDay(last)}`}</span>
            </p>
            <ul className="tab-list">
              {bill.debts.map((debt) => (
                <DebtRow key={debt.id} debt={debt} />
              ))}
            </ul>
            {bill.unpaidSen > 0 && (
              <Link href={`${tabPath(slug)}/pay?upto=${bill.month}`} className="button button-primary tab-pay">
                Pay this bill
              </Link>
            )}
          </div>
        );
      }}
    </WithTab>
  );
}

/* 4 · History */
type HistoryFilter = "all" | "owed" | "paid";

export function TabHistory({ slug }: { slug: string }) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const year = Number(today.slice(0, 4));
        const shown = tab.history.filter((d) =>
          filter === "all" ? true : filter === "paid" ? d.status === "paid" : d.status !== "paid",
        );
        const months: { month: string; debts: Debt[] }[] = [];
        for (const debt of shown) {
          const month = debt.date.slice(0, 7);
          const group = months.at(-1);
          if (group?.month === month) group.debts.push(debt);
          else months.push({ month, debts: [debt] });
        }
        return (
          <div className="tab-page">
            <TopBar title="History" back={tabPath(slug)} />
            <div className="chips" role="group" aria-label="Show">
              {(
                [
                  ["all", "All"],
                  ["owed", "Still owed"],
                  ["paid", "Paid"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            {months.length === 0 ? (
              <div className="card empty-state">
                <p>Nothing here.</p>
              </div>
            ) : (
              months.map((group) => (
                <section key={group.month}>
                  <h2 className="month-head">{formatMonth(group.month, year)}</h2>
                  <ul className="tab-list">
                    {group.debts.map((debt) => (
                      <DebtRow key={debt.id} debt={debt} label="Took on tab" />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        );
      }}
    </WithTab>
  );
}

/* 5 · Amount to pay */
function PayPicker({ tab, today, slug, upto }: Loaded & { slug: string; upto?: string }) {
  // From a bill's page, tick that bill and every older one (older bills must be paid first).
  const [count, setCount] = useState(() => initialPayCount(tab.toPay, upto));
  const total = payableSen(tab.toPay, count);
  const year = Number(today.slice(0, 4));
  const { invoices } = useCollect();
  const plan = payPlan(
    tab.toPay.slice(0, count).flatMap((b) => b.debts),
    invoices,
  );
  const single = plan.invoices.length === 1 && plan.notInvoiced.length === 0 ? plan.invoices[0] : null;
  // Paying is per PayPal invoice, so the amount shown is what paying actually costs.
  const toPayNow = count > 0 && plan.invoices.length > 0 ? plan.totalSen : total;
  const coversMore = plan.invoices.some((i) => i.coversMore);
  return (
    <div className="tab-page tab-page-paybar">
      <TopBar title="Amount to pay" back={tabPath(slug)} />
      <section className="card pay-total">
        <p className="tab-hero-label">Total unpaid</p>
        <p className="bill-left-amt">
          <small>RM</small>
          {formatSen(tab.owedSen)}
        </p>
      </section>
      {tab.toPay.length === 0 ? (
        <div className="card empty-state">
          <p>Nothing to pay. You&apos;re all paid up.</p>
        </div>
      ) : (
        <fieldset className="card pay-pick">
          <legend>
            Choose bills to pay
            <span>Oldest first. You can&apos;t skip a month.</span>
          </legend>
          {tab.toPay.map((bill, index) => (
            <label key={bill.month} className="pay-row">
              <input type="checkbox" checked={index < count} onChange={() => setCount(toggleBill(count, index))} />
              <span className="tab-who">
                <span className="tab-name">{formatMonth(bill.month, year)}</span>
                <BillBadge bill={bill} today={today} />
              </span>
              <span className="tab-amt">{rm(bill.unpaidSen)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {count > 0 && (plan.invoices.length > 1 || (plan.invoices.length > 0 && plan.notInvoiced.length > 0)) && (
        <section className="pay-invoices" aria-labelledby="pay-invoices-title">
          <h2 id="pay-invoices-title" className="month-head">
            Your PayPal invoices
          </h2>
          <ul className="tab-list">
            {plan.invoices.map(({ record }) => (
              <InvoicePayRow key={record.id} record={record} />
            ))}
          </ul>
        </section>
      )}
      {count > 0 && coversMore && (
        <p className="notice pay-not-invoiced">
          {plan.invoices.length === 1 ? "Your PayPal invoice" : "One of your PayPal invoices"} also covers later bills, so paying it
          pays those too.
        </p>
      )}
      {count > 0 && plan.notInvoiced.length > 0 && (
        <p className="notice notice-warning pay-not-invoiced">
          {rm(plan.notInvoicedSen)} of this hasn&apos;t been invoiced yet, so it can&apos;t be paid online. Ask {SHOP_NAME}{" "}
          to send the PayPal invoice.
        </p>
      )}
      <div className="paybar">
        <p className="paybar-sum">
          <span>To pay now</span>
          <b>{rm(toPayNow)}</b>
        </p>
        {single ? (
          <PayLink record={single.record} label={`Pay ${rm(single.amountSen)} with PayPal`} wide describedBy="pay-why" />
        ) : (
          <button type="button" className="button button-primary tab-pay" disabled aria-describedby="pay-why">
            {count === 0 ? "Tick a bill to pay" : plan.invoices.length > 0 ? "Pay the invoices above" : "Not invoiced yet"}
          </button>
        )}
        <p className="tab-note" id="pay-why">
          {single
            ? "Opens PayPal in a new tab. Pay with your PayPal account or a card."
            : plan.invoices.length > 0
              ? "Each invoice opens on PayPal. Pay with your PayPal account or a card."
              : count === 0
                ? "Choose which bills to pay first."
                : "The shop hasn't sent a PayPal invoice for these yet."}
        </p>
      </div>
    </div>
  );
}

type InvoiceLive = { state: InvoicePayState | "checking"; payerLink?: string };

/** Asks PayPal where an invoice stands (read-only), again whenever the customer comes back to the page. */
function useInvoiceLive(id: string): InvoiceLive {
  const [live, setLive] = useState<InvoiceLive>({ state: "checking" });
  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch(`/api/invoices/${encodeURIComponent(id)}`)
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as { status?: string; payerLink?: string };
          if (cancelled) return;
          setLive(res.ok ? { state: invoicePayState(data.status), payerLink: data.payerLink } : { state: "unknown" });
        })
        .catch(() => {
          if (!cancelled) setLive((prev) => ({ ...prev, state: "unknown" }));
        });
    }
    check();
    // Back from paying in the PayPal tab: refresh so a paid invoice stops offering Pay.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id]);
  return live;
}

function PayLink({
  record,
  label,
  wide,
  describedBy,
}: {
  record: InvoiceRecord;
  label: string;
  wide?: boolean;
  describedBy?: string;
}) {
  const live = useInvoiceLive(record.id);
  const link = [live.payerLink, record.payerLink].find(isPayPalUrl);
  const name = record.number ? `invoice ${record.number}` : "your invoice";
  let content: ReactNode;
  if (live.state === "paid") {
    content = (
      <span className={`pay-done${wide ? " pay-done-wide" : ""}`}>
        <CheckIcon />
        Paid on PayPal
      </span>
    );
  } else if (live.state === "processing") {
    content = <span className="pay-state">PayPal is processing the payment</span>;
  } else if (live.state === "closed") {
    content = <span className="pay-state">This invoice was cancelled. Ask {SHOP_NAME}.</span>;
  } else if (!link) {
    content = <span className="pay-state">Ask {SHOP_NAME} for the PayPal link.</span>;
  } else {
    content = (
      <a
        className={`button button-primary${wide ? " tab-pay" : " pay-small"}`}
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label === "Pay" ? `Pay ${name}, ${rm(record.amountSen)}, on PayPal` : label} (opens in a new tab)`}
        aria-describedby={describedBy}
      >
        {label}
      </a>
    );
  }
  // Announces the change when PayPal reports the invoice paid.
  return (
    <span role="status" className={wide ? "pay-status-wide" : undefined}>
      {content}
    </span>
  );
}

function InvoicePayRow({ record }: { record: InvoiceRecord }) {
  return (
    <li className="tab-row">
      <span className="tab-icon" aria-hidden="true">
        <NoteIcon />
      </span>
      <span className="tab-who">
        <span className="tab-name">{record.number ? `Invoice ${record.number}` : "PayPal invoice"}</span>
        <span className="tab-item">
          {rm(record.amountSen)} · sent {formatDay(record.sentAt.slice(0, 10)).replace(/ \d{4}$/, "")}
        </span>
      </span>
      <PayLink record={record} label="Pay" />
    </li>
  );
}

export function TabPay({ slug, upto }: { slug: string; upto?: string }) {
  return <WithTab slug={slug}>{(loaded) => <PayPicker {...loaded} slug={slug} upto={upto} />}</WithTab>;
}
