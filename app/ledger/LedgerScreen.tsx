"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen, STATUS_LABEL, type Debt, type DebtStatus } from "@/lib/debts";
import StatusBadge from "../components/StatusBadge";
import { SendIcon } from "../components/icons";
import { useDebts } from "../useDebts";
import { useCollect } from "../useCollect";
import { useIsWide } from "../useIsWide";
import { collectGroups } from "@/lib/collect";
import { LEDGER_FILTERS, filterByStatus, ledgerTotals, type LedgerFilter } from "@/lib/ledger";
import LedgerGrid from "./LedgerGrid";

type Notice =
  | { kind: "deleted"; debt: Debt }
  | { kind: "error"; message: string };


function describe(debt: Debt) {
  return `${debt.customerName} · RM ${formatSen(debt.amountSen)}`;
}

export default function LedgerScreen() {
  const { debts, ready, persistent, unreadable, add, remove, reset, clear } = useDebts();
  const router = useRouter();
  const searchParams = useSearchParams();
  const addedId = searchParams.get("added");
  const added = addedId ? debts.find((d) => d.id === addedId) : undefined;
  // Set by the scanner after it saves the lines the owner ticked.
  const scannedParam = searchParams.get("scanned") ?? "";
  const scanned = /^[1-9]\d{0,3}$/.test(scannedParam) ? Number(scannedParam) : 0;
  const [notice, setNotice] = useState<Notice | null>(null);
  // Laptop: filter chips by status. The phone has no chips, so the filter only applies when wide.
  const wide = useIsWide();
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const { counts, sen: totals, owedSen } = ledgerTotals(debts);
  const shown = filterByStatus(debts, wide ? filter : "all");
  // Same list as Collect's "To send": customers with tabs not invoiced yet.
  const { emails, pending } = useCollect();
  const toInvoice = collectGroups(debts, emails, pending).length;

  function clearAdded() {
    router.replace("/ledger", { scroll: false });
  }

  function run(action: () => void) {
    try {
      action();
    } catch (error) {
      const message = error instanceof DebtStoreError ? error.message : "Something went wrong. Try again.";
      setNotice({ kind: "error", message });
      return false;
    }
    return true;
  }

  function onDelete(debt: Debt) {
    if (run(() => remove(debt.id))) {
      setNotice({ kind: "deleted", debt });
      if (debt.id === addedId) clearAdded();
    }
  }

  function undoDelete(debt: Debt) {
    if (run(() => add(debt))) setNotice(null);
  }

  function undoAdd(debt: Debt) {
    if (run(() => remove(debt.id))) clearAdded();
  }

  return (
    <div className="ledger-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ledger</h1>
          <p className="page-intro">Who still owes you, overdue first.</p>
        </div>
        <Link href="/add" className="button button-primary">
          + Add debt
        </Link>
      </div>

      {ready && unreadable && (
        <div className="notice notice-error" role="alert">
          <p className="notice-text">
            Your saved tabs couldn&apos;t be read on this device. They&apos;re left as they are until you choose
            what to do.
          </p>
          <div className="notice-actions">
            <button type="button" className="button" onClick={() => run(reset)}>
              Start over with sample tabs
            </button>
            <button type="button" className="button" onClick={() => run(clear)}>
              Start empty
            </button>
          </div>
        </div>
      )}

      {ready && !persistent && (
        <p className="notice notice-warning" role="status">
          This browser isn&apos;t saving data (private mode or storage blocked). Entries disappear when you close
          the page.
        </p>
      )}

      {added && (
        <p className="notice notice-success" role="status">
          Added {describe(added)}.{" "}
          <button type="button" className="link-button" onClick={() => undoAdd(added)}>
            Undo
          </button>
        </p>
      )}

      {scanned > 0 && (
        <p className="notice notice-success" role="status">
          Added {scanned} {scanned === 1 ? "debt" : "debts"} from your scan.
        </p>
      )}

      {notice?.kind === "deleted" && (
        <p className="notice" role="status">
          Deleted {describe(notice.debt)}.{" "}
          <button type="button" className="link-button" onClick={() => undoDelete(notice.debt)}>
            Undo
          </button>
        </p>
      )}

      {notice?.kind === "error" && (
        <p className="notice notice-error" role="alert">
          {notice.message}
        </p>
      )}

      {!ready ? (
        <p className="card loading" aria-busy="true">
          Loading your ledger…
        </p>
      ) : unreadable ? null : debts.length === 0 ? (
        <div className="card empty-state">
          <h2>No tabs yet</h2>
          <p>Add the first debt from your buku 555, or load the sample tabs to try things out.</p>
          <div className="empty-actions">
            <Link href="/add" className="button button-primary">
              + Add debt
            </Link>
            <button type="button" className="button" onClick={() => run(reset)}>
              Load sample tabs
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ledger-chips ledger-wide-only" role="group" aria-label="Show tabs by status">
            {LEDGER_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : STATUS_LABEL[f]} <b>{counts[f]}</b>
              </button>
            ))}
          </div>
          <div className="ledger-cols">
            <LedgerGrid rows={shown} onDelete={onDelete} />
            <aside className="card ledger-summary ledger-wide-only" aria-label="Totals by status">
              <p className="ledger-summary-k">Still owed</p>
              <p className="ledger-summary-v">RM {formatSen(owedSen)}</p>
              <ul>
                {(["overdue", "sent", "unpaid", "paid"] as DebtStatus[]).map((st) => (
                  <li key={st}>
                    <StatusBadge status={st} />
                    <b>RM {formatSen(totals[st])}</b>
                  </li>
                ))}
              </ul>
              {toInvoice > 0 && (
                <Link href="/collect" className="button ledger-summary-go">
                  <SendIcon />
                  {toInvoice === 1 ? "Invoice 1 customer" : `Invoice ${toInvoice} customers`}
                </Link>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
