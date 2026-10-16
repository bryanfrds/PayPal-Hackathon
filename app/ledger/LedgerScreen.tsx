"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen, type Debt, type DebtStatus } from "@/lib/debts";
import Avatar from "../components/Avatar";
import StatusBadge from "../components/StatusBadge";
import { CloseIcon, SendIcon } from "../components/icons";
import { useDebts } from "../useDebts";
import { useCollect } from "../useCollect";
import { useIsWide } from "../useIsWide";
import { useT } from "../useT";
import { collectGroups } from "@/lib/collect";
import { customerSlug } from "@/lib/customer-tab";
import type { InvoiceRecord } from "@/lib/collect-store";
import { LEDGER_FILTERS, debtsToCsv, filterByStatus, ledgerTotals, type LedgerFilter } from "@/lib/ledger";
import LedgerGrid from "./LedgerGrid";

type Notice =
  | { kind: "deleted"; debt: Debt }
  | { kind: "error"; message: string };

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function describe(debt: Debt) {
  return `${debt.customerName} · RM ${formatSen(debt.amountSen)}`;
}

/** The page's loading line, in the owner's language (used as the Suspense fallback). */
export function LedgerLoading() {
  const { t } = useT();
  return <p className="card loading">{t("ledger.loading")}</p>;
}

function DebtDetailSheet({
  debt,
  invoice,
  onClose,
  onDelete,
}: {
  debt: Debt;
  invoice?: InvoiceRecord;
  onClose: () => void;
  onDelete: (debt: Debt) => void;
}) {
  const { t } = useT();
  const slug = customerSlug(debt.customerName);

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-labelledby="debt-detail-title">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet debt-detail-sheet">
        <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who">
          <Avatar name={debt.customerName} className="avatar avatar-lg" />
          <h2 id="debt-detail-title">{debt.customerName}</h2>
          <p>
            <Link href={`/tab/${slug}`} className="link-button" onClick={onClose}>
              View customer tab ↗
            </Link>
          </p>
        </div>

        <div className="debt-detail-content">
          <div className="debt-detail-row">
            <span className="debt-detail-label">Amount</span>
            <span className="debt-detail-value debt-detail-amount">RM {formatSen(debt.amountSen)}</span>
          </div>
          <div className="debt-detail-row">
            <span className="debt-detail-label">Status</span>
            <span className="debt-detail-value">
              <StatusBadge status={debt.status} />
            </span>
          </div>
          <div className="debt-detail-row">
            <span className="debt-detail-label">Item</span>
            <span className="debt-detail-value">{debt.item || "Barang kedai"}</span>
          </div>
          <div className="debt-detail-row">
            <span className="debt-detail-label">Date recorded</span>
            <span className="debt-detail-value">{debt.date}</span>
          </div>
          <div className="debt-detail-row">
            <span className="debt-detail-label">Source</span>
            <span className="debt-detail-value">
              {debt.source === "scan" ? "Scanned from notebook (buku 555)" : "Manual entry"}
            </span>
          </div>
          <div className="debt-detail-row">
            <span className="debt-detail-label">Debt ID</span>
            <span className="debt-detail-value debt-detail-id">{debt.id}</span>
          </div>

          {invoice && (
            <div className="debt-detail-invoice card">
              <h3>PayPal Invoice</h3>
              <p>
                <strong>Invoice ID:</strong> {invoice.id}
                {invoice.number && ` (#${invoice.number})`}
              </p>
              <p>
                <strong>Sent:</strong> {new Date(invoice.sentAt).toLocaleDateString()}
              </p>
              {invoice.payerLink && (
                <a
                  href={invoice.payerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-primary"
                  style={{ display: "inline-block", marginTop: "0.5rem" }}
                >
                  Open in PayPal ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="sheet-actions" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="button"
            style={{ color: "var(--danger)" }}
            onClick={() => {
              onDelete(debt);
              onClose();
            }}
          >
            {t("ledger.delete")}
          </button>
          <button type="button" className="button" onClick={onClose} style={{ marginLeft: "auto" }}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [selectedDebts, setSelectedDebts] = useState<Debt[]>([]);
  const [detailDebt, setDetailDebt] = useState<Debt | null>(null);
  const { counts, sen: totals, owedSen } = ledgerTotals(debts);
  const shown = filterByStatus(debts, filter);
  // Same list as Collect's "To send": customers with tabs not invoiced yet.
  const { emails, invoices, pending } = useCollect();
  const toInvoice = collectGroups(debts, emails, pending).length;

  const invoiceRecordMap = useMemo(() => {
    const map: Record<string, InvoiceRecord> = {};
    for (const inv of invoices) {
      for (const id of inv.debtIds) {
        map[id] = inv;
      }
    }
    return map;
  }, [invoices]);

  const invoiceIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, inv] of Object.entries(invoiceRecordMap)) {
      map[id] = inv.id;
    }
    return map;
  }, [invoiceRecordMap]);

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
      if (detailDebt?.id === debt.id) setDetailDebt(null);
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
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link href="/customers" className="button">
            Customers
          </Link>
          {debts.length > 0 && (
            <button
              type="button"
              className="button"
              onClick={() => {
                const csv = debtsToCsv(shown, invoiceIdMap);
                downloadCsv(csv, `buku-555-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
              }}
            >
              Export CSV
            </button>
          )}
          <Link href="/add" className="button button-primary">
            {t("ledger.addDebt")}
          </Link>
        </div>
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
          <div className="ledger-chips" role="group" aria-label={t("ledger.filterGroup")}>
            {LEDGER_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? t("ledger.filterAll") : t(`status.${f}`)} <b>{counts[f]}</b>
              </button>
            ))}
          </div>
          <div className="ledger-cols">
            <LedgerGrid
              rows={shown}
              onDelete={onDelete}
              onRowClick={(debt) => setDetailDebt(debt)}
              onSelectionChange={(selected) => setSelectedDebts(selected)}
            />
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

      {detailDebt && (
        <DebtDetailSheet
          debt={detailDebt}
          invoice={invoiceRecordMap[detailDebt.id]}
          onClose={() => setDetailDebt(null)}
          onDelete={onDelete}
        />
      )}

      {selectedDebts.length > 0 && (
        <div className="ledger-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="ledger-bulk-info">
            {selectedDebts.length} selected · RM {formatSen(selectedDebts.reduce((sum, d) => sum + d.amountSen, 0))}
          </div>
          <div className="ledger-bulk-actions">
            <button
              type="button"
              className="ledger-bulk-btn ledger-bulk-btn-primary"
              onClick={() => {
                const eligible = selectedDebts.filter((d) => d.status === "unpaid" || d.status === "overdue");
                const excluded = selectedDebts.length - eligible.length;
                if (eligible.length === 0) {
                  setNotice({
                    kind: "error",
                    message: "Selected tabs are already paid or invoiced.",
                  });
                  return;
                }
                if (excluded > 0) {
                  router.push("/collect");
                } else {
                  router.push("/collect");
                }
              }}
            >
              Invoice Selected
            </button>
            <button
              type="button"
              className="ledger-bulk-btn"
              onClick={() => {
                const csv = debtsToCsv(selectedDebts, invoiceIdMap);
                downloadCsv(csv, `buku-555-selected-${new Date().toISOString().slice(0, 10)}.csv`);
              }}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="ledger-bulk-btn"
              onClick={() => setSelectedDebts([])}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
