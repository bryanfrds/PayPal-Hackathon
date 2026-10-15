"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen, type Debt, type DebtStatus } from "@/lib/debts";
import StatusBadge from "../components/StatusBadge";
import { SendIcon } from "../components/icons";
import { useDebts } from "../useDebts";
import { useCollect } from "../useCollect";
import { useIsWide } from "../useIsWide";
import { useT } from "../useT";
import { collectGroups } from "@/lib/collect";
import { LEDGER_FILTERS, filterByStatus, ledgerTotals, type LedgerFilter } from "@/lib/ledger";
import LedgerGrid from "./LedgerGrid";

type Notice =
  | { kind: "deleted"; debt: Debt }
  | { kind: "error"; message: string };


function describe(debt: Debt) {
  return `${debt.customerName} · RM ${formatSen(debt.amountSen)}`;
}

/** The page's loading line, in the owner's language (used as the Suspense fallback). */
export function LedgerLoading() {
  const { t } = useT();
  return <p className="card loading">{t("ledger.loading")}</p>;
}

export default function LedgerScreen() {
  const { t } = useT();
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
      const message = error instanceof DebtStoreError ? error.message : t("common.tryAgain");
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
          <h1 className="page-title">{t("ledger.title")}</h1>
          <p className="page-intro">{t("ledger.intro")}</p>
        </div>
        <Link href="/add" className="button button-primary">
          {t("ledger.addDebt")}
        </Link>
      </div>

      {ready && unreadable && (
        <div className="notice notice-error" role="alert">
          <p className="notice-text">{t("ledger.unreadable")}</p>
          <div className="notice-actions">
            <button type="button" className="button" onClick={() => run(reset)}>
              {t("ledger.startOverSample")}
            </button>
            <button type="button" className="button" onClick={() => run(clear)}>
              {t("ledger.startEmpty")}
            </button>
          </div>
        </div>
      )}

      {ready && !persistent && (
        <p className="notice notice-warning" role="status">
          {t("ledger.notSaving")}
        </p>
      )}

      {added && (
        <p className="notice notice-success" role="status">
          {t("ledger.added", { debt: describe(added) })}{" "}
          <button type="button" className="link-button" onClick={() => undoAdd(added)}>
            {t("ledger.undo")}
          </button>
        </p>
      )}

      {scanned > 0 && (
        <p className="notice notice-success" role="status">
          {t("ledger.scanned", { count: scanned })}
        </p>
      )}

      {notice?.kind === "deleted" && (
        <p className="notice" role="status">
          {t("ledger.deleted", { debt: describe(notice.debt) })}{" "}
          <button type="button" className="link-button" onClick={() => undoDelete(notice.debt)}>
            {t("ledger.undo")}
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
          {t("ledger.loading")}
        </p>
      ) : unreadable ? null : debts.length === 0 ? (
        <div className="card empty-state">
          <h2>{t("ledger.emptyTitle")}</h2>
          <p>{t("ledger.emptyBody")}</p>
          <div className="empty-actions">
            <Link href="/add" className="button button-primary">
              {t("ledger.addDebt")}
            </Link>
            <button type="button" className="button" onClick={() => run(reset)}>
              {t("ledger.loadSample")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ledger-chips ledger-wide-only" role="group" aria-label={t("ledger.filterGroup")}>
            {LEDGER_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? t("ledger.filterAll") : t(`status.${f}`)} <b>{counts[f]}</b>
              </button>
            ))}
          </div>
          <div className="ledger-cols">
            <LedgerGrid rows={shown} onDelete={onDelete} />
            <aside className="card ledger-summary ledger-wide-only" aria-label={t("ledger.totalsLabel")}>
              <p className="ledger-summary-k">{t("ledger.stillOwed")}</p>
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
                  {t("ledger.invoiceCustomers", { count: toInvoice })}
                </Link>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
