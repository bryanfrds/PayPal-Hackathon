"use client";

// The customer's own tab, SPayLater-style: what they owe, bills by month, history and paying.
// Two sources, same screens:
// - /tab/<slug> on the owner's device: the ledger's own debts and invoices (localStorage);
// - /t/<token> on the customer's phone: a published snapshot, passed in with <TabSource>.
// The rules are in lib/customer-tab.ts.

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { formatSen, todayLocal, type Debt } from "@/lib/debts";
import {
  customerTab,
  daysBetween,
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
import { revokeTabLink, useTabLink } from "../../tabLinks";
import { useShop } from "../../useShop";
import { useT } from "../../useT";

/** A published tab's data, for the customer's own phone (app/t/[token]). */
export type TabSourceData = { debts: Debt[]; invoices: InvoiceRecord[]; shopName: string; base: string };

const TabSourceContext = createContext<TabSourceData | null>(null);

/** Gives the tab screens a published snapshot instead of this device's ledger. */
export function TabSource({ value, children }: { value: TabSourceData; children: ReactNode }) {
  return <TabSourceContext.Provider value={value}>{children}</TabSourceContext.Provider>;
}

/** Where this tab's pages live, and the shop's name, from whichever source is showing. */
function useTabSource(slug?: string) {
  const shared = useContext(TabSourceContext);
  const { name } = useShop();
  return {
    shared,
    base: shared?.base ?? (slug ? tabPath(slug) : ""),
    shopName: shared?.shopName ?? name,
  };
}

type Loaded = { tab: CustomerTab; today: string };

/** Loads the tab, and shows loading / not-found states so each screen only handles the happy path. */
function WithTab({ slug, children }: { slug: string; children: (loaded: Loaded) => ReactNode }) {
  const local = useDebts();
  const { shared, shopName } = useTabSource(slug);
  const debts = shared ? shared.debts : local.debts;
  const ready = shared ? true : local.ready;
  const unreadable = shared ? false : local.unreadable;
  const { t } = useT();
  if (!ready) {
    return (
      <p className="card loading" aria-busy="true">
        {t("tab.loading")}
      </p>
    );
  }
  if (unreadable) {
    return (
      <div className="card empty-state" role="alert">
        <h1 className="tab-empty-title">{t("tab.unreadableTitle")}</h1>
        <p>{t("tab.unreadableBody", { shop: shopName })}</p>
      </div>
    );
  }
  const today = todayLocal();
  const tab = customerTab(debts, slug, today);
  if (!tab) {
    return (
      <div className="card empty-state">
        <h1 className="tab-empty-title">{t("tab.notFoundTitle")}</h1>
        <p>{t("tab.notFoundBody", { shop: shopName })}</p>
      </div>
    );
  }
  return <>{children({ tab, today })}</>;
}

function TopBar({ title, back }: { title: string; back: string }) {
  const { t } = useT();
  return (
    <div className="tab-top">
      <Link href={back} className="tab-back" aria-label={t("common.back")}>
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
  const { t, formatDay } = useT();
  if (bill.status === "paid") return <span className="badge badge-paid badge-text">{t("status.paid")}</span>;
  if (bill.status === "overdue") {
    const late = daysBetween(bill.dueDate, today);
    return (
      <span className="badge badge-overdue badge-text">
        {late > 0 ? t("tab.overdueDays", { count: late }) : t("status.overdue")}
      </span>
    );
  }
  return <span className="badge badge-unpaid badge-text">{t("tab.dueOn", { date: formatDay(bill.dueDate) })}</span>;
}

function DebtRow({ debt, label }: { debt: Debt; label?: string }) {
  const { t, formatDay } = useT();
  const paid = debt.status === "paid";
  return (
    <li className="tab-row">
      <span className={`tab-icon${paid ? " tab-icon-paid" : ""}`} aria-hidden="true">
        {paid ? <CheckIcon /> : <BagIcon />}
      </span>
      <span className="tab-who">
        {label && <span className="tab-name">{label}</span>}
        <span className={label ? "tab-item" : "tab-name"}>{debt.item || t("tab.noItem")}</span>
        <span className="tab-item">
          {formatDay(debt.date)}
          {paid ? ` · ${t("status.paid")}` : ""}
        </span>
      </span>
      <span className="tab-amt">{rm(debt.amountSen)}</span>
    </li>
  );
}

function BillCard({ bill, today, slug, year }: { bill: Bill; today: string; slug: string; year: number }) {
  const { t, formatMonth } = useT();
  const { base } = useTabSource(slug);
  return (
    <li>
      <Link href={`${base}/bills/${bill.month}`} className="card bill-card">
        <span className="tab-who">
          <span className="bill-month">{formatMonth(bill.month, year)}</span>
          <BillBadge bill={bill} today={today} />
          <span className="tab-item">{t("tab.items", { count: bill.debts.length })}</span>
        </span>
        <span className="tab-amt">
          {rm(bill.status === "paid" ? bill.totalSen : bill.unpaidSen)}
          <ChevronIcon className="icon chev" />
        </span>
      </Link>
    </li>
  );
}

/**
 * On the owner's own device only (not the customer's shared page): when this tab is shared by
 * link, say so and offer to turn the link off.
 */
function OwnerLinkNotice({ slug, name }: { slug: string; name: string }) {
  const { shared } = useTabSource(slug);
  const link = useTabLink(slug);
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  if (shared || !link.url) return null;
  return (
    <div className="notice tab-link-notice">
      <p className="notice-text">{t("tab.sharedByLink", { name })}</p>
      <button type="button" className="button button-sm" onClick={async () => setFailed(!(await revokeTabLink(slug)))}>
        {t("tab.turnOffLink")}
      </button>
      {failed && (
        <p className="field-error" role="alert">
          {t("share.tabLink.turnOffFailed")}
        </p>
      )}
    </div>
  );
}

/* 1 · Your tab */
export function TabHome({ slug }: { slug: string }) {
  const { t, formatDay, formatMonth } = useT();
  const { base, shopName } = useTabSource(slug);
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
              <p className="dash-hello">{t("tab.hello", { name: tab.customerName })}</p>
              <h1 className="dash-shop">{shopName}</h1>
            </div>
            <OwnerLinkNotice slug={slug} name={tab.customerName} />

            <section className="tab-hero" aria-labelledby="owe-label">
              <p className="tab-hero-label" id="owe-label">
                {t("tab.youOwe")}
              </p>
              <p className="tab-hero-big">
                <small>RM</small>
                {formatSen(tab.owedSen)}
              </p>
              <div
                className="tab-limit"
                role="progressbar"
                aria-label={t("tab.limitAria")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={usedPct}
              >
                <b style={{ width: `${usedPct}%` }} />
              </div>
              <p className="tab-hero-label">
                {t("tab.limitLeft", { left: rm(tab.leftSen), limit: rm(tab.limitSen) })}
              </p>
            </section>

            <section className="card tab-bill">
              {tab.toPay.length === 0 ? (
                <>
                  <p className="tab-hero-label">{t("tab.toPay")}</p>
                  <p className="tab-bill-amt">RM 0.00</p>
                  <p className="tab-bill-due">{t("tab.allPaidThanks")}</p>
                </>
              ) : (
                <>
                  <p className="tab-hero-label">{t("tab.toPay")}</p>
                  <p className="tab-bill-amt">{rm(tab.owedSen)}</p>
                  <p className="tab-bill-due">
                    <span className={`dot ${overdue.length ? "dot-over" : "dot-due"}`} aria-hidden="true" />
                    {overdue.length > 0
                      ? t("tab.monthsOverdue", { months: overdue.map((b) => formatMonth(b.month, year)).join(", ") })
                      : null}
                    {overdue.length > 0 && next ? " · " : null}
                    {next ? t("tab.monthDue", { month: formatMonth(next.month, year), date: formatDay(next.dueDate) }) : null}
                  </p>
                  <Link href={`${base}/pay`} className="button button-primary tab-pay">
                    {t("tab.payNow")}
                  </Link>
                  <p className="tab-note">{t("tab.payNote")}</p>
                </>
              )}
              <div className="tab-links">
                <Link href={`${base}/bills`}>
                  <NoteIcon />
                  {t("tab.myBills")}
                </Link>
                <Link href={`${base}/history`}>
                  <ClockIcon />
                  {t("tab.history")}
                </Link>
              </div>
            </section>

            <div className="section-head">
              <h2>{t("tab.recent")}</h2>
            </div>
            <ul className="tab-list">
              {tab.history.slice(0, 3).map((debt) => (
                <DebtRow key={debt.id} debt={debt} />
              ))}
            </ul>
            <p className="powered">{t("common.poweredBy")}</p>
          </div>
        );
      }}
    </WithTab>
  );
}

/* 2 · My bills */
export function TabBills({ slug }: { slug: string }) {
  const [view, setView] = useState<"toPay" | "paid">("toPay");
  const { t } = useT();
  const { base } = useTabSource(slug);
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const year = Number(today.slice(0, 4));
        const bills = view === "toPay" ? tab.toPay : tab.paid;
        return (
          <div className="tab-page">
            <TopBar title={t("tab.myBills")} back={base} />
            <div className="segmented" role="group" aria-label={t("tab.whichBills")}>
              <button type="button" aria-pressed={view === "toPay"} onClick={() => setView("toPay")}>
                {t("tab.toPay")}
              </button>
              <button type="button" aria-pressed={view === "paid"} onClick={() => setView("paid")}>
                {t("status.paid")}
              </button>
            </div>
            {bills.length === 0 ? (
              <div className="card empty-state">
                <p>{view === "toPay" ? t("tab.nothingToPay") : t("tab.noPaidBills")}</p>
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
  const { t, formatDay, formatMonth } = useT();
  const { base } = useTabSource(slug);
  return (
    <WithTab slug={slug}>
      {({ tab, today }) => {
        const bill = [...tab.toPay, ...tab.paid].find((b) => b.month === month);
        if (!bill) {
          return (
            <div className="tab-page">
              <TopBar title={t("tab.bill")} back={`${base}/bills`} />
              <div className="card empty-state">
                <p>{t("tab.noBill")}</p>
              </div>
            </div>
          );
        }
        const first = bill.debts[0].date;
        const last = bill.debts[bill.debts.length - 1].date;
        return (
          <div className="tab-page">
            <TopBar title={t("tab.monthBill", { month: formatMonth(bill.month, Number(today.slice(0, 4))) })} back={`${base}/bills`} />
            <section className="card bill-breakdown">
              <div className="bill-left">
                <p className="tab-hero-label">{t("tab.leftToPay")}</p>
                <p className="bill-left-amt">
                  <small>RM</small>
                  {formatSen(bill.unpaidSen)}
                </p>
                <BillBadge bill={bill} today={today} />
              </div>
              <dl>
                <div>
                  <dt>{t("tab.tookOnTab")}</dt>
                  <dd>+ {rm(bill.totalSen)}</dd>
                </div>
                <div>
                  <dt>{t("status.paid")}</dt>
                  <dd>{bill.paidSen ? `− ${rm(bill.paidSen)}` : "RM 0.00"}</dd>
                </div>
                <div className="bill-total">
                  <dt>{t("tab.leftToPay")}</dt>
                  <dd>{rm(bill.unpaidSen)}</dd>
                </div>
              </dl>
            </section>
            <p className="bill-meta">
              <span>{t("tab.items", { count: bill.debts.length })}</span>
              <span>{first === last ? formatDay(first) : `${formatDay(first)} – ${formatDay(last)}`}</span>
            </p>
            <ul className="tab-list">
              {bill.debts.map((debt) => (
                <DebtRow key={debt.id} debt={debt} />
              ))}
            </ul>
            {bill.unpaidSen > 0 && (
              <Link href={`${base}/pay?upto=${bill.month}`} className="button button-primary tab-pay">
                {t("tab.payThisBill")}
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
  const { t, formatMonth } = useT();
  const { base } = useTabSource(slug);
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
            <TopBar title={t("tab.history")} back={base} />
            <div className="chips" role="group" aria-label={t("tab.show")}>
              {(
                [
                  ["all", t("tab.filterAll")],
                  ["owed", t("tab.filterOwed")],
                  ["paid", t("status.paid")],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            {months.length === 0 ? (
              <div className="card empty-state">
                <p>{t("tab.nothingHere")}</p>
              </div>
            ) : (
              months.map((group) => (
                <section key={group.month}>
                  <h2 className="month-head">{formatMonth(group.month, year)}</h2>
                  <ul className="tab-list">
                    {group.debts.map((debt) => (
                      <DebtRow key={debt.id} debt={debt} label={t("tab.tookOnTab")} />
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
  const local = useCollect();
  const { shared, base, shopName } = useTabSource(slug);
  const invoices = shared ? shared.invoices : local.invoices;
  const { t, formatMonth } = useT();
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
      <TopBar title={t("tab.amountToPay")} back={base} />
      <section className="card pay-total">
        <p className="tab-hero-label">{t("tab.totalUnpaid")}</p>
        <p className="bill-left-amt">
          <small>RM</small>
          {formatSen(tab.owedSen)}
        </p>
      </section>
      {tab.toPay.length === 0 ? (
        <div className="card empty-state">
          <p>{t("tab.nothingToPay")}</p>
        </div>
      ) : (
        <fieldset className="card pay-pick">
          <legend>
            {t("tab.chooseBills")}
            <span>{t("tab.chooseBillsHint")}</span>
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
            {t("tab.yourInvoices")}
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
          {plan.invoices.length === 1 ? t("tab.coversMoreOne") : t("tab.coversMoreMany")}
        </p>
      )}
      {count > 0 && plan.notInvoiced.length > 0 && (
        <p className="notice notice-warning pay-not-invoiced">
          {t("tab.notInvoiced", { amount: rm(plan.notInvoicedSen), shop: shopName })}
        </p>
      )}
      <div className="paybar">
        <p className="paybar-sum">
          <span>{t("tab.toPayNow")}</span>
          <b>{rm(toPayNow)}</b>
        </p>
        {single ? (
          <PayLink record={single.record} label={t("tab.payWithPayPal", { amount: rm(single.amountSen) })} wide describedBy="pay-why" />
        ) : (
          <button type="button" className="button button-primary tab-pay" disabled aria-describedby="pay-why">
            {count === 0 ? t("tab.tickBill") : plan.invoices.length > 0 ? t("tab.payAbove") : t("tab.notInvoicedYet")}
          </button>
        )}
        <p className="tab-note" id="pay-why">
          {single
            ? t("tab.whySingle")
            : plan.invoices.length > 0
              ? t("tab.whyMany")
              : count === 0
                ? t("tab.whyNone")
                : t("tab.whyNotSent")}
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
  short,
  wide,
  describedBy,
}: {
  record: InvoiceRecord;
  label: string;
  /** The label is just "Pay": the aria-label names the invoice and amount. */
  short?: boolean;
  wide?: boolean;
  describedBy?: string;
}) {
  const { t } = useT();
  const { shopName } = useTabSource();
  const live = useInvoiceLive(record.id);
  const link = [live.payerLink, record.payerLink].find(isPayPalUrl);
  const name = record.number ? t("tab.invoiceName", { number: record.number }) : t("tab.yourInvoice");
  let content: ReactNode;
  if (live.state === "paid") {
    content = (
      <span className={`pay-done${wide ? " pay-done-wide" : ""}`}>
        <CheckIcon />
        {t("tab.paidOnPayPal")}
      </span>
    );
  } else if (live.state === "processing") {
    content = <span className="pay-state">{t("tab.processing")}</span>;
  } else if (live.state === "closed") {
    content = <span className="pay-state">{t("tab.cancelled", { shop: shopName })}</span>;
  } else if (!link) {
    content = <span className="pay-state">{t("tab.askLink", { shop: shopName })}</span>;
  } else {
    content = (
      <a
        className={`button button-primary${wide ? " tab-pay" : " pay-small"}`}
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("tab.newTab", { label: short ? t("tab.payInvoiceAria", { name, amount: rm(record.amountSen) }) : label })}
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
  const { t, formatDay } = useT();
  return (
    <li className="tab-row">
      <span className="tab-icon" aria-hidden="true">
        <NoteIcon />
      </span>
      <span className="tab-who">
        <span className="tab-name">{record.number ? t("tab.invoiceNumber", { number: record.number }) : t("tab.paypalInvoice")}</span>
        <span className="tab-item">
          {t("tab.sentOn", { amount: rm(record.amountSen), date: formatDay(record.sentAt.slice(0, 10), { year: false }) })}
        </span>
      </span>
      <PayLink record={record} label={t("tab.pay")} short />
    </li>
  );
}

export function TabPay({ slug, upto }: { slug: string; upto?: string }) {
  return <WithTab slug={slug}>{(loaded) => <PayPicker {...loaded} slug={slug} upto={upto} />}</WithTab>;
}
