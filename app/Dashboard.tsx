"use client";

import Link from "next/link";
import { formatSen, sortDebts, type Debt } from "@/lib/debts";
import { customerSlug } from "@/lib/customer-tab";
import { colourIndex, greeting, initials, summariseHome } from "@/lib/home";
import { useDebts } from "./useDebts";
import { BellIcon, PlusIcon, ScanIcon } from "./components/icons";

const OPEN_TABS_SHOWN = 5;

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

function TabRow({ debt }: { debt: Debt }) {
  const [bg, fg] = avatarColours(debt.customerName);
  return (
    <li className="tab-row">
      {/* Opens the customer's own tab page, the one the shop sends them a link to. */}
      <Link href={`/tab/${customerSlug(debt.customerName)}`} className="tab-row-link">
        <span className="avatar" style={{ background: bg, color: fg }} aria-hidden="true">
          {initials(debt.customerName)}
        </span>
        <span className="tab-who">
          <span className="tab-name">{debt.customerName}</span>
          <span className="tab-item">{debt.item || "No item written"}</span>
        </span>
        <span className="tab-amt">
          RM {formatSen(debt.amountSen)}
          <span className={`badge badge-${debt.status}`}>{debt.status}</span>
        </span>
      </Link>
    </li>
  );
}

export default function Dashboard() {
  const { debts, ready } = useDebts();
  const { owedSen, openCount, overdueCount, paidSen, collectedPct } = summariseHome(debts);
  const openTabs = sortDebts(debts.filter((d) => d.status !== "paid"));

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <p className="dash-hello">{ready ? `${greeting(new Date().getHours())} 👋` : " "}</p>
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
        <p className="hero-big">
          <small>RM</small>
          {ready ? formatSen(owedSen) : "—"}
        </p>
        <p className="hero-sub">
          {ready
            ? `${openCount} open ${openCount === 1 ? "tab" : "tabs"} · ${overdueCount} overdue`
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
        <Link href="/scan" className="quick">
          <ScanIcon />
          Scan buku
        </Link>
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
        <h2>Open tabs</h2>
        <Link href="/ledger">See all</Link>
      </div>

      {!ready ? (
        <p className="card loading" aria-busy="true">
          Loading your tabs…
        </p>
      ) : openTabs.length === 0 ? (
        <div className="card empty-state">
          <h2>Nobody owes you</h2>
          <p>Every tab is paid. Add a new one when someone buys on credit.</p>
          <Link href="/add" className="button button-primary">
            + Add debt
          </Link>
        </div>
      ) : (
        <ul className="tab-list">
          {openTabs.slice(0, OPEN_TABS_SHOWN).map((debt) => (
            <TabRow key={debt.id} debt={debt} />
          ))}
        </ul>
      )}

      <p className="powered">Invoices and payments by PayPal</p>
    </div>
  );
}
