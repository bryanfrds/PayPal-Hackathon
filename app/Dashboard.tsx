"use client";

import Link from "next/link";
import { formatSen, outstanding, sortDebts, type Debt } from "@/lib/debts";
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
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

/** "Mak Cik Siti" → "MS", "Nurul" → "N". Ignores brackets like "(Bengkel)". */
function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function greeting(hour: number): string {
  if (hour < 12) return "Selamat pagi";
  if (hour < 19) return "Selamat petang";
  return "Selamat malam";
}

function TabRow({ debt }: { debt: Debt }) {
  const [bg, fg] = avatarColours(debt.customerName);
  return (
    <li className="tab-row">
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
    </li>
  );
}

export default function Dashboard() {
  const { debts, ready } = useDebts();
  const owed = outstanding(debts);
  const overdue = debts.filter((d) => d.status === "overdue").length;
  const paidSen = debts.reduce((sum, d) => (d.status === "paid" ? sum + d.amountSen : sum), 0);
  const allSen = paidSen + owed.totalSen;
  const collectedPct = allSen === 0 ? 0 : Math.round((paidSen / allSen) * 100);
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
          {ready ? formatSen(owed.totalSen) : "—"}
        </p>
        <p className="hero-sub">
          {ready
            ? `${owed.count} open ${owed.count === 1 ? "tab" : "tabs"} · ${overdue} overdue`
            : "Loading your tabs…"}
        </p>
        <div
          className="meter"
          role="progressbar"
          aria-label="Share of all tabs already paid"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={collectedPct}
        >
          <b style={{ width: `${collectedPct}%` }} />
        </div>
        <p className="meter-label">
          <span>RM {formatSen(paidSen)} collected</span>
          <span>{collectedPct}%</span>
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
