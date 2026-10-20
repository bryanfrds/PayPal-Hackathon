"use client";

// Home: the shop's money at a glance. On a phone it's one column; on a laptop (1024px and up)
// it spreads into a grid, "Who owes you" becomes an AG Grid table and the month chart an
// AG Studio tile. Mock: "555 Buku - Home Redesign Mock.html".

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { tabPath } from "@/lib/customer-tab";
import { formatSen, todayLocal } from "@/lib/debts";
import { greeting, homeOverview, initials, lateLabel, monthTotals, owedBoard, type BoardRow } from "@/lib/home";
import { buildSchedule } from "@/lib/reminders";
import AccountSheet from "./components/AccountSheet";
import Avatar from "./components/Avatar";
import QuickTour from "./components/QuickTour";
import { ShareButton, ShareTip, useShareTip } from "./components/ShareButton";
import ShareSheet from "./components/ShareSheet";
import { BellIcon, ChartIcon, ChevronIcon, PlusIcon, ReceiptIcon, ScanIcon, SendIcon, SparkIcon } from "./components/icons";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";
import { useIsWide } from "./useIsWide";
import { useReminders } from "./useReminders";
import { useShop } from "./useShop";
import { useT } from "./useT";

// Loaded only on wide screens, so phones don't download AG Grid or AG Studio for Home.
function GridLoading() {
  const { t } = useT();
  return <p className="loading home-loading">{t("common.loading")}</p>;
}
const HomeBoardGrid = dynamic(() => import("./home/HomeBoardGrid"), {
  ssr: false,
  loading: () => <GridLoading />,
});
const HomeChart = dynamic(() => import("./home/HomeChart"), {
  ssr: false,
  loading: () => <GridLoading />,
});

const SHOWN_ON_PHONE = 5;

const BAR_COLOUR: Record<BoardRow["status"], string> = { overdue: "var(--overdue)", sent: "var(--sent)", unpaid: "var(--unpaid)" };

function BoardList({ rows, onShare }: { rows: BoardRow[]; onShare: (slug: string, button: HTMLButtonElement) => void }) {
  const { t } = useT();
  return (
    <ul className="card home-board">
      {rows.map((row) => (
        <li key={row.slug} className="home-board-item">
          {/* Opens the customer's own tab page, the one the shop sends them a link to. */}
          <Link href={tabPath(row.slug)} className="home-board-row">
            <Avatar name={row.customerName} />
            <span className="home-board-main">
              <span className="home-board-name">{row.customerName}</span>
              <span className="home-board-track" aria-hidden="true">
                <b style={{ width: `${row.sharePct}%`, background: BAR_COLOUR[row.status] }} />
              </span>
            </span>
            <span className="home-board-amt">
              RM {formatSen(row.owedSen)}
              <span className={`badge badge-${row.status}`}>{lateLabel(row, t)}</span>
            </span>
          </Link>
          {/* A sibling of the link, so the row still opens the tab and this only opens the share sheet. */}
          <ShareButton customerName={row.customerName} onOpen={(button) => onShare(row.slug, button)} />
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent } = useReminders();
  const wide = useIsWide();
  const { name: shopName } = useShop();
  const { t, lang, locale, formatDay, formatNumber } = useT();
  // Display-only numbers in the language's digits (Bengali uses its own). Amounts never go through this.
  const percent = (pct: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(pct / 100);
  const [accountOpen, setAccountOpen] = useState(false);
  // Who the WhatsApp sheet is for, and the button that opened it (focus goes back there).
  const [share, setShare] = useState<{ slug: string; opener: HTMLElement } | null>(null);
  const [showTip, dismissTip] = useShareTip();
  const openShare = useCallback(
    (slug: string, opener: HTMLButtonElement) => {
      setShare({ slug, opener });
      dismissTip();
    },
    [dismissTip],
  );
  const today = todayLocal();

  const schedule = useMemo(() => buildSchedule(debts, invoices, rules, moves, today, sent), [debts, invoices, rules, moves, today, sent]);
  const o = useMemo(() => homeOverview(debts, schedule, today), [debts, schedule, today]);
  const board = useMemo(() => owedBoard(debts, today), [debts, today]);
  const months = useMemo(() => monthTotals(debts, today), [debts, today]);
  const monthMax = Math.max(1, ...months.map((m) => Math.max(m.owedSen, m.collectedSen)));
  // Short month names under the phone's bars: "Oct" in English, the local short form elsewhere.
  const monthLabel = (m: (typeof months)[number]) =>
    lang === "en"
      ? m.label
      : new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`));
  // One per row in the Today list, so the "N things" above it always matches what's shown.
  // Paid tabs aren't a job: they're on the Collected tile instead.
  const todo = (o.remindNow.length > 0 ? 1 : 0) + (o.notInvoiced.count > 0 ? 1 : 0);

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <p className="dash-hello">{ready ? greeting(new Date().getHours(), t) : " "}</p>
          <h1 className="dash-shop">{shopName}</h1>
        </div>
        <div className="home-head-actions">
          <Link href="/scan" className="button home-wide-only">
            <ScanIcon />
            {t("home.scanNotebook")}
          </Link>
          <Link href="/collect" className="button home-wide-only">
            <SendIcon />
            {t("home.collect")}
          </Link>
          <Link href="/add" className="button button-primary home-wide-only">
            <PlusIcon />
            {t("home.addDebt")}
          </Link>
          <button
            type="button"
            className="avatar avatar-me home-phone-only home-acct"
            aria-label={t("nav.account", { name: shopName })}
            onClick={() => setAccountOpen(true)}
            data-tour="settings-phone"
          >
            {initials(shopName)}
          </button>
        </div>
      </div>

      <div className="home-top">
        <section className="home-hero" aria-labelledby="owed-label" aria-busy={!ready} data-tour="home-hero">
          <p className="home-hero-label" id="owed-label">
            {t("home.stillOwed")}
          </p>
          <div className="home-hero-row">
            <p className="home-hero-big">
              <small>RM</small>
              {ready ? formatSen(o.owedSen) : "—"}
            </p>
            {/* Like Shopee's "Scan & Pay": the scanner is always one tap away on a phone. */}
            <Link href="/scan" className="home-hero-scan home-phone-only">
              <ScanIcon />
              {t("home.scan")}
            </Link>
          </div>
          <div
            className="home-meter"
            role="img"
            aria-label={ready ? t("home.meterAria", { collected: o.collectedPct, overdue: o.overduePct }) : t("common.loading")}
          >
            <b style={{ width: `${ready ? o.collectedPct : 0}%` }} />
            <b className="home-meter-late" style={{ width: `${ready ? o.overduePct : 0}%` }} />
          </div>
          <p className="home-meter-label">
            <span>
              {ready ? (
                <>
                  <strong>RM {formatSen(o.paidSen)}</strong> {t("home.meterCollected")}
                  {o.overdueSen > 0 && <span className="home-late"> {t("home.meterOverdue", { amount: formatSen(o.overdueSen) })}</span>}
                </>
              ) : (
                t("home.loadingTabs")
              )}
            </span>
            <span>{ready ? percent(o.collectedPct) : ""}</span>
          </p>
        </section>

        <div className="home-stats">
          <div className="home-stat">
            <p className="home-stat-k">{t("home.collected")}</p>
            <p className="home-stat-v">{ready ? `RM ${formatSen(o.paidSen)}` : "—"}</p>
            <p className="home-stat-d home-good">
              {ready ? t("home.tabsPaid", { count: o.paidTabs.count }) : " "}
            </p>
          </div>
          <div className="home-stat">
            <p className="home-stat-k">{t("status.overdue")}</p>
            <p className="home-stat-v">
              {ready ? t("home.tabs", { count: o.overdueTabs }) : "—"}
            </p>
            <p className="home-stat-d home-late">
              {ready ? `RM ${formatSen(o.overdueSen)}` : " "}
              <span className="home-wide-only">{ready && o.oldestDaysLate > 0 ? ` ${t("home.oldest", { days: o.oldestDaysLate })}` : ""}</span>
            </p>
          </div>
          <div className="home-stat home-phone-only">
            <p className="home-stat-k">{t("home.customers")}</p>
            <p className="home-stat-v">{ready ? formatNumber(o.customersOwing) : "—"}</p>
            <p className="home-stat-d">{t("home.oweYouNow")}</p>
          </div>
          <div className="home-stat home-wide-only">
            <p className="home-stat-k">{t("home.remindersToday")}</p>
            <p className="home-stat-v">{ready ? formatNumber(o.remindNow.length) : "—"}</p>
            <p className="home-stat-d">{!ready ? " " : o.nextReminder ? t("home.nextReminder", { day: formatDay(o.nextReminder, { year: false }) }) : t("home.nonePlanned")}</p>
          </div>
        </div>
      </div>

      <nav className="home-acts home-phone-only" aria-label={t("home.quickActions")}>
        <Link href="/add" className="home-act home-act-primary">
          <span>
            <PlusIcon />
          </span>
          {t("home.addDebt")}
        </Link>
        <Link href="/collect" className="home-act">
          <span>
            <SendIcon />
          </span>
          {t("home.collect")}
        </Link>
        <Link href="/reminders" className="home-act" data-tour="home-reminders">
          <span>
            <BellIcon />
          </span>
          {t("home.remind")}
        </Link>
        <Link href="/insights" className="home-act">
          <span>
            <ChartIcon />
          </span>
          {t("nav.insights")}
        </Link>
      </nav>

      <div className="home-body">
        <div className="home-main">
          <div className="section-head">
            <h2>{t("home.whoOwes")}</h2>
            <Link href="/ledger">{t("home.seeAll")}</Link>
          </div>
          {!ready ? (
            <p className="card loading" aria-busy="true">
              {t("home.loadingTabs")}
            </p>
          ) : board.length === 0 ? (
            <div className="card empty-state">
              <h2>{t("home.nobodyOwes")}</h2>
              <p>{t("home.allPaid")}</p>
              <Link href="/add" className="button button-primary">
                + {t("home.addDebt")}
              </Link>
            </div>
          ) : (
            <>
              {showTip && <ShareTip onDismiss={dismissTip} />}
              {wide ? (
                <HomeBoardGrid rows={board} onShare={openShare} />
              ) : (
                <BoardList rows={board.slice(0, SHOWN_ON_PHONE)} onShare={openShare} />
              )}
            </>
          )}
        </div>

        <div className="home-side">
          <div className="section-head">
            <h2>{t("home.today")}</h2>
            <span className="home-count">{todo === 0 ? t("home.allDone") : t("home.things", { count: todo })}</span>
          </div>
          <ul className="card home-todo">
            {o.remindNow.length > 0 && (
              <li className="home-todo-row">
                <span className="home-todo-ic home-todo-late" aria-hidden="true">
                  <BellIcon />
                </span>
                <span className="home-todo-main">
                  <span className="home-todo-n">
                    {t("home.remindersToSend", { count: o.remindNow.length })}
                  </span>
                  <span className="home-todo-w">{o.remindNow.join(", ")}</span>
                </span>
                <Link href="/reminders" className="home-todo-go">
                  {t("home.send")}
                </Link>
              </li>
            )}
            {o.notInvoiced.count > 0 && (
              <li className="home-todo-row">
                <span className="home-todo-ic home-todo-wait" aria-hidden="true">
                  <ReceiptIcon />
                </span>
                <span className="home-todo-main">
                  <span className="home-todo-n">
                    {t("home.notInvoiced", { count: o.notInvoiced.count })}
                  </span>
                  <span className="home-todo-w">
                    RM {formatSen(o.notInvoiced.sen)} · {o.notInvoiced.names.join(", ")}
                  </span>
                </span>
                <Link href="/collect" className="home-todo-go home-todo-go-light">
                  {t("home.collect")}
                </Link>
              </li>
            )}
            {todo === 0 && (
              <li className="home-todo-row">
                <span className="home-todo-main">
                  <span className="home-todo-w">{t("home.nothingToDo")}</span>
                </span>
              </li>
            )}
          </ul>

          <Link href="/nudge" className="card home-nudge home-phone-only">
            <span className="home-nudge-dot" aria-hidden="true">
              <SparkIcon />
            </span>
            <span className="home-nudge-q">
              <strong>{t("nav.askNudge")}</strong>
              <span>{t("nav.nudgeQuestion")}</span>
            </span>
            <ChevronIcon />
          </Link>

          <section className="card home-chart" aria-labelledby="month-chart">
            <div className="home-chart-head">
              <h2 id="month-chart">{t("home.chartTitle")}</h2>
              <span className="home-chart-sub">{t("home.chartSub")}</span>
            </div>
            {wide ? (
              <HomeChart debts={debts} />
            ) : (
              <>
                <div className="home-bars" role="img" aria-label={months.map((m) => t("home.barsAria", { month: monthLabel(m), collected: formatSen(m.collectedSen), owed: formatSen(m.owedSen) })).join("; ")}>
                  {months.map((m) => (
                    <div key={m.month}>
                      <i style={{ height: `${(m.collectedSen / monthMax) * 100}%` }} />
                      <i className="home-bar-owed" style={{ height: `${(m.owedSen / monthMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="home-bar-labels" aria-hidden="true">
                  {months.map((m) => (
                    <span key={m.month}>{monthLabel(m)}</span>
                  ))}
                </div>
                <p className="home-legend" aria-hidden="true">
                  <span className="home-key" /> {t("home.collected")} <span className="home-key home-key-owed" /> {t("home.stillOwedKey")}
                </p>
              </>
            )}
          </section>
        </div>
      </div>

      <p className="powered">{t("common.poweredBy")}</p>
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
      {share && <ShareSheet slug={share.slug} returnFocusTo={share.opener} onClose={() => setShare(null)} />}
      {/* First visit only (or replayed from Settings). Home only: never on /tab, sign-in or the scanner. */}
      <QuickTour />
    </div>
  );
}

