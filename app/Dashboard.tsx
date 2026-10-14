"use client";

// Home: the shop's money at a glance. On a phone it's one column; on a laptop (1024px and up)
// it spreads into a grid, "Who owes you" becomes an AG Grid table and the month chart an
// AG Studio tile. Mock: "555 Buku - Home Redesign Mock.html".

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDay, tabPath } from "@/lib/customer-tab";
import { formatSen, todayLocal } from "@/lib/debts";
import { greeting, homeOverview, initials, monthTotals, owedBoard, type BoardRow } from "@/lib/home";
import { buildSchedule } from "@/lib/reminders";
import AccountSheet from "./components/AccountSheet";
import Avatar from "./components/Avatar";
import { BellIcon, ChartIcon, CheckIcon, ChevronIcon, PlusIcon, ReceiptIcon, ScanIcon, SendIcon, SparkIcon } from "./components/icons";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";
import { useIsWide } from "./useIsWide";
import { useReminders } from "./useReminders";
import { useShop } from "./useShop";

// Loaded only on wide screens, so phones don't download AG Grid or AG Studio for Home.
const HomeBoardGrid = dynamic(() => import("./home/HomeBoardGrid"), {
  ssr: false,
  loading: () => <p className="loading home-loading">Loading…</p>,
});
const HomeChart = dynamic(() => import("./home/HomeChart"), {
  ssr: false,
  loading: () => <p className="loading home-loading">Loading…</p>,
});

const SHOWN_ON_PHONE = 5;

const LATE_TEXT: Record<BoardRow["status"], string> = { overdue: "Overdue", sent: "Invoice sent", unpaid: "Not sent" };
const BAR_COLOUR: Record<BoardRow["status"], string> = { overdue: "var(--danger, #c23b22)", sent: "#2f55c4", unpaid: "#8c6512" };

function lateLabel(row: BoardRow): string {
  if (row.status === "overdue" && row.daysLate > 0) return `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"} late`;
  return LATE_TEXT[row.status];
}

function BoardList({ rows }: { rows: BoardRow[] }) {
  return (
    <ul className="card home-board">
      {rows.map((row) => (
        <li key={row.slug}>
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
              <span className={`badge badge-${row.status}`}>{lateLabel(row)}</span>
            </span>
          </Link>
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
  const [accountOpen, setAccountOpen] = useState(false);
  const today = todayLocal();

  const schedule = useMemo(() => buildSchedule(debts, invoices, rules, moves, today, sent), [debts, invoices, rules, moves, today, sent]);
  const o = useMemo(() => homeOverview(debts, schedule, today), [debts, schedule, today]);
  const board = useMemo(() => owedBoard(debts, today), [debts, today]);
  const months = useMemo(() => monthTotals(debts, today), [debts, today]);
  const monthMax = Math.max(1, ...months.map((m) => Math.max(m.owedSen, m.collectedSen)));
  const todo = (o.remindNow.length > 0 ? 1 : 0) + (o.notInvoiced.count > 0 ? 1 : 0);

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <p className="dash-hello">{ready ? greeting(new Date().getHours()) : " "}</p>
          <h1 className="dash-shop">{shopName}</h1>
        </div>
        <div className="home-head-actions">
          <Link href="/scan" className="button home-wide-only">
            <ScanIcon />
            Scan notebook
          </Link>
          <Link href="/collect" className="button home-wide-only">
            <SendIcon />
            Collect
          </Link>
          <Link href="/add" className="button button-primary home-wide-only">
            <PlusIcon />
            Add debt
          </Link>
          <button
            type="button"
            className="avatar avatar-me home-phone-only home-acct"
            aria-label={`Account: ${shopName}`}
            onClick={() => setAccountOpen(true)}
          >
            {initials(shopName)}
          </button>
        </div>
      </div>

      <div className="home-top">
        <section className="home-hero" aria-labelledby="owed-label" aria-busy={!ready}>
          <p className="home-hero-label" id="owed-label">
            Still owed to you
          </p>
          <div className="home-hero-row">
            <p className="home-hero-big">
              <small>RM</small>
              {ready ? formatSen(o.owedSen) : "—"}
            </p>
            {/* Like Shopee's "Scan & Pay": the scanner is always one tap away on a phone. */}
            <Link href="/scan" className="home-hero-scan home-phone-only">
              <ScanIcon />
              Scan
            </Link>
          </div>
          <div
            className="home-meter"
            role="img"
            aria-label={ready ? `${o.collectedPct}% of all tabs collected, ${o.overduePct}% overdue` : "Loading"}
          >
            <b style={{ width: `${ready ? o.collectedPct : 0}%` }} />
            <b className="home-meter-late" style={{ width: `${ready ? o.overduePct : 0}%` }} />
          </div>
          <p className="home-meter-label">
            <span>
              {ready ? (
                <>
                  <strong>RM {formatSen(o.paidSen)}</strong> collected
                  {o.overdueSen > 0 && <span className="home-late"> · RM {formatSen(o.overdueSen)} overdue</span>}
                </>
              ) : (
                "Loading your tabs…"
              )}
            </span>
            <span>{ready ? `${o.collectedPct}%` : ""}</span>
          </p>
        </section>

        <div className="home-stats">
          <div className="home-stat">
            <p className="home-stat-k">Collected</p>
            <p className="home-stat-v">{ready ? `RM ${formatSen(o.paidSen)}` : "—"}</p>
            <p className="home-stat-d home-good">
              {ready ? `${o.paidTabs.count} ${o.paidTabs.count === 1 ? "tab" : "tabs"} paid` : " "}
            </p>
          </div>
          <div className="home-stat">
            <p className="home-stat-k">Overdue</p>
            <p className="home-stat-v">
              {ready ? `${o.overdueTabs} ${o.overdueTabs === 1 ? "tab" : "tabs"}` : "—"}
            </p>
            <p className="home-stat-d home-late">
              {ready ? `RM ${formatSen(o.overdueSen)}` : " "}
              <span className="home-wide-only">{ready && o.oldestDaysLate > 0 ? ` · oldest ${o.oldestDaysLate} days` : ""}</span>
            </p>
          </div>
          <div className="home-stat home-phone-only">
            <p className="home-stat-k">Customers</p>
            <p className="home-stat-v">{ready ? o.customersOwing : "—"}</p>
            <p className="home-stat-d">owe you now</p>
          </div>
          <div className="home-stat home-wide-only">
            <p className="home-stat-k">Reminders today</p>
            <p className="home-stat-v">{ready ? o.remindNow.length : "—"}</p>
            <p className="home-stat-d">{!ready ? " " : o.nextReminder ? `next: ${formatDay(o.nextReminder).replace(/ \d{4}$/, "")}` : "none planned"}</p>
          </div>
        </div>
      </div>

      <nav className="home-acts home-phone-only" aria-label="Quick actions">
        <Link href="/add" className="home-act home-act-primary">
          <span>
            <PlusIcon />
          </span>
          Add debt
        </Link>
        <Link href="/collect" className="home-act">
          <span>
            <SendIcon />
          </span>
          Collect
        </Link>
        <Link href="/reminders" className="home-act">
          <span>
            <BellIcon />
          </span>
          Remind
        </Link>
        <Link href="/insights" className="home-act">
          <span>
            <ChartIcon />
          </span>
          Insights
        </Link>
      </nav>

      <div className="home-body">
        <div className="home-main">
          <div className="section-head">
            <h2>Who owes you</h2>
            <Link href="/ledger">See all</Link>
          </div>
          {!ready ? (
            <p className="card loading" aria-busy="true">
              Loading your tabs…
            </p>
          ) : board.length === 0 ? (
            <div className="card empty-state">
              <h2>Nobody owes you</h2>
              <p>Every tab is paid. Add a new one when someone buys on credit.</p>
              <Link href="/add" className="button button-primary">
                + Add debt
              </Link>
            </div>
          ) : wide ? (
            <HomeBoardGrid rows={board} />
          ) : (
            <BoardList rows={board.slice(0, SHOWN_ON_PHONE)} />
          )}
        </div>

        <div className="home-side">
          <div className="section-head">
            <h2>Today</h2>
            <span className="home-count">{todo === 0 ? "All done" : `${todo} ${todo === 1 ? "thing" : "things"}`}</span>
          </div>
          <ul className="card home-todo">
            {o.remindNow.length > 0 && (
              <li className="home-todo-row">
                <span className="home-todo-ic home-todo-late" aria-hidden="true">
                  <BellIcon />
                </span>
                <span className="home-todo-main">
                  <span className="home-todo-n">
                    {o.remindNow.length} {o.remindNow.length === 1 ? "reminder" : "reminders"} to send
                  </span>
                  <span className="home-todo-w">{o.remindNow.join(", ")}</span>
                </span>
                <Link href="/reminders" className="home-todo-go">
                  Send
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
                    {o.notInvoiced.count} {o.notInvoiced.count === 1 ? "tab" : "tabs"} not invoiced
                  </span>
                  <span className="home-todo-w">
                    RM {formatSen(o.notInvoiced.sen)} · {o.notInvoiced.names.join(", ")}
                  </span>
                </span>
                <Link href="/collect" className="home-todo-go home-todo-go-light">
                  Collect
                </Link>
              </li>
            )}
            {o.paidTabs.count > 0 && (
              <li className="home-todo-row">
                <span className="home-todo-ic home-todo-good" aria-hidden="true">
                  <CheckIcon />
                </span>
                <span className="home-todo-main">
                  <span className="home-todo-n">
                    {o.paidTabs.count} {o.paidTabs.count === 1 ? "tab" : "tabs"} paid · RM {formatSen(o.paidTabs.sen)}
                  </span>
                  <span className="home-todo-w">Marked paid in your ledger</span>
                </span>
              </li>
            )}
            {todo === 0 && o.paidTabs.count === 0 && (
              <li className="home-todo-row">
                <span className="home-todo-main">
                  <span className="home-todo-w">Nothing to do right now.</span>
                </span>
              </li>
            )}
          </ul>

          <Link href="/nudge" className="card home-nudge home-phone-only">
            <span className="home-nudge-dot" aria-hidden="true">
              <SparkIcon />
            </span>
            <span className="home-nudge-q">
              <strong>Ask Nudge</strong>
              <span>&ldquo;Who should I remind today?&rdquo;</span>
            </span>
            <ChevronIcon />
          </Link>

          <section className="card home-chart" aria-labelledby="month-chart">
            <div className="home-chart-head">
              <h2 id="month-chart">Owed vs collected</h2>
              <span className="home-chart-sub">by month written down</span>
            </div>
            {wide ? (
              <HomeChart debts={debts} />
            ) : (
              <>
                <div className="home-bars" role="img" aria-label={months.map((m) => `${m.label}: RM ${formatSen(m.collectedSen)} collected, RM ${formatSen(m.owedSen)} owed`).join("; ")}>
                  {months.map((m) => (
                    <div key={m.month}>
                      <i style={{ height: `${(m.collectedSen / monthMax) * 100}%` }} />
                      <i className="home-bar-owed" style={{ height: `${(m.owedSen / monthMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="home-bar-labels" aria-hidden="true">
                  {months.map((m) => (
                    <span key={m.month}>{m.label}</span>
                  ))}
                </div>
                <p className="home-legend" aria-hidden="true">
                  <span className="home-key" /> Collected <span className="home-key home-key-owed" /> Still owed
                </p>
              </>
            )}
          </section>
        </div>
      </div>

      <p className="powered">Invoices and payments by PayPal</p>
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

