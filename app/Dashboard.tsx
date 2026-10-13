"use client";

import Link from "next/link";
import { formatSen } from "@/lib/debts";
import { customerSlug, formatDay, tabPath } from "@/lib/customer-tab";
import StatusBadge from "./components/StatusBadge";
import { colourIndex, customerSummaries, greeting, initials, summariseHome, type CustomerSummary } from "@/lib/home";
import { useDebts } from "./useDebts";
import { BellIcon, PlusIcon, ScanIcon } from "./components/icons";

const CUSTOMERS_SHOWN = 5;

// Soft avatar colours; a name always gets the same one.
const AVATAR_COLOURS = [
  ["#fde8df", "#b4441f"],
  ["#e3ecfb", "#2f55c4"],
  ["#e6f3ea", "#2b7a46"],
  ["#f6efdc", "#8c6512"],
  ["#efe6f8", "#6b3fa0"],
  ["#e0f2f1", "#1d6f69"],
] as const;

function avatarColours(name: string) {
  return AVATAR_COLOURS[colourIndex(name, AVATAR_COLOURS.length)];
}

function CustomerRow({ row }: { row: CustomerSummary }) {
  const [bg, fg] = avatarColours(row.customerName);
  return (
    <li className="tab-row">
      {/* Opens the customer's own tab page, the one the shop sends them a link to. */}
      <Link href={tabPath(customerSlug(row.customerName))} className="tab-row-link">
        <span className="avatar" style={{ background: bg, color: fg }} aria-hidden="true">
          {initials(row.customerName)}
        </span>
        <span className="tab-who">
          <span className="tab-name">{row.customerName}</span>
          <span className="tab-item">
            {row.count} {row.count === 1 ? "item" : "items"} · since {formatDay(row.since).replace(/ \d{4}$/, "")}
          </span>
        </span>
        <span className="tab-amt">
          RM {formatSen(row.owedSen)}
          <StatusBadge status={row.status} />
        </span>
      </Link>
    </li>
  );
}

export default function Dashboard() {
  const { debts, ready } = useDebts();
  const { owedSen, paidSen, collectedPct } = summariseHome(debts);
  const customers = customerSummaries(debts);
  const overdueCustomers = customers.filter((c) => c.status === "overdue").length;

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <p className="dash-hello">{ready ? `${greeting(new Date().getHours())}` : " "}</p>
          <h1 className="dash-shop">Kedai Ah Seng</h1>
        </div>
        <span className="avatar avatar-me" aria-hidden="true">
          AS
        </span>
      </div>

      <section className="hero" aria-labelledby="owed-label" aria-busy={!ready}>
        <p className="hero-label" id="owed-label">
          Still owed to you
        </p>
        <div className="hero-row">
          <p className="hero-big">
            <small>RM</small>
            {ready ? formatSen(owedSen) : "—"}
          </p>
          {/* Like Shopee's "Scan & Pay": the scanner is always one tap away. */}
          <Link href="/scan" className="hero-scan">
            <ScanIcon />
            Scan
          </Link>
        </div>
        <p className="hero-sub">
          {ready
            ? `${customers.length} ${customers.length === 1 ? "customer" : "customers"} · ${overdueCustomers} overdue`
            : "Loading your tabs…"}
        </p>
        <div
          className="meter"
          role="progressbar"
          aria-label="Share of all tabs already paid"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ready ? collectedPct : undefined}
        >
          <b style={{ width: `${ready ? collectedPct : 0}%` }} />
        </div>
        <p className="meter-label">
          <span>{ready ? `RM ${formatSen(paidSen)} collected` : "—"}</span>
          <span>{ready ? `${collectedPct}%` : ""}</span>
        </p>
      </section>

      <nav className="quick-actions" aria-label="Quick actions">
        <Link href="/add" className="quick quick-primary">
          <PlusIcon />
          Add debt
        </Link>
        <Link href="/collect" className="quick">
          <BellIcon />
          Remind
        </Link>
      </nav>

      <div className="section-head">
        <h2>Who owes you</h2>
        <Link href="/ledger">See all</Link>
      </div>

      {!ready ? (
        <p className="card loading" aria-busy="true">
          Loading your tabs…
        </p>
      ) : customers.length === 0 ? (
        <div className="card empty-state">
          <h2>Nobody owes you</h2>
          <p>Every tab is paid. Add a new one when someone buys on credit.</p>
          <Link href="/add" className="button button-primary">
            + Add debt
          </Link>
        </div>
      ) : (
        <ul className="tab-list">
          {customers.slice(0, CUSTOMERS_SHOWN).map((row) => (
            <CustomerRow key={row.customerName} row={row} />
          ))}
        </ul>
      )}

      <p className="powered">Invoices and payments by PayPal</p>
    </div>
  );
}
