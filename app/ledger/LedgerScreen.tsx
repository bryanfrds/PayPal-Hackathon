"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DebtStoreError } from "@/lib/debt-store";
import { formatSen, type Debt, type DebtStatus } from "@/lib/debts";
import Avatar from "../components/Avatar";
import StatusBadge from "../components/StatusBadge";
import { CloseIcon, SendIcon } from "../components/icons";
import { useDialog } from "../components/useDialog";
import { useDebts } from "../useDebts";
import { useCollect } from "../useCollect";
import { useT } from "../useT";
import { collectGroups } from "@/lib/collect";
import { customerSlug } from "@/lib/customer-tab";
import { isPayPalUrl } from "@/lib/customer-pay";
import type { InvoiceRecord } from "@/lib/collect-store";
import { LEDGER_FILTERS, debtsToCsv, filterByStatus, ledgerTotals, type LedgerFilter } from "@/lib/ledger";
import LedgerGrid, { type LedgerGridHandle } from "./LedgerGrid";

type Notice =
  | { kind: "deleted"; debt: Debt }
  | { kind: "error"; message: string };

function downloadCsv(content: string, filename: string) {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Some browsers start the download after click() returns: let go of the file a moment later.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describe(debt: Debt) {
  return `${debt.customerName} · RM ${formatSen(debt.amountSen)}`;
}

/** The page's loading line, in the owner's language (used as the Suspense fallback). */
export function LedgerLoading() {
  const { t } = useT();
  return <p className="card loading">{t("ledger.loading")}</p>;
}

/** The local calendar day ("2026-10-15") of an ISO timestamp, for formatDay. */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const { t, formatDay } = useT();
  const sheetRef = useDialog<HTMLDivElement>(onClose);
  const slug = customerSlug(debt.customerName);
  const sentDay = invoice ? localDay(invoice.sentAt) : null;

  // Rendered at the end of <body>, so no sticky or layered part of the page can sit on top.
  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className="sheet debt-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="debt-detail-title"
      >
        <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who">
          <Avatar name={debt.customerName} className="avatar avatar-lg" />
          <h2 id="debt-detail-title">{debt.customerName}</h2>
          <p>
            <Link href={`/tab/${slug}`} className="link-button" onClick={onClose}>
              {t("ledger.detail.viewTab")}
            </Link>
          </p>
        </div>

        <dl className="debt-detail-content">
          <div className="debt-detail-row">
            <dt className="debt-detail-label">{t("ledger.detail.amount")}</dt>
            <dd className="debt-detail-value debt-detail-amount">RM {formatSen(debt.amountSen)}</dd>
          </div>
          <div className="debt-detail-row">
            <dt className="debt-detail-label">{t("ledger.detail.status")}</dt>
            <dd className="debt-detail-value">
              <StatusBadge status={debt.status} />
            </dd>
          </div>
          <div className="debt-detail-row">
            <dt className="debt-detail-label">{t("ledger.detail.item")}</dt>
            <dd className="debt-detail-value">{debt.item || t("ledger.noItem")}</dd>
          </div>
          <div className="debt-detail-row">
            <dt className="debt-detail-label">{t("ledger.detail.date")}</dt>
            <dd className="debt-detail-value">{formatDay(debt.date)}</dd>
          </div>
          <div className="debt-detail-row">
            <dt className="debt-detail-label">{t("ledger.detail.source")}</dt>
            <dd className="debt-detail-value">
              {debt.source === "scan" ? t("ledger.detail.sourceScan") : t("ledger.detail.sourceManual")}
            </dd>
          </div>
        </dl>

        {invoice && (
          <div className="debt-detail-invoice">
            <h3>{t("ledger.detail.invoiceTitle")}</h3>
            <p>
              <strong>{t("ledger.detail.invoiceId")}:</strong> {invoice.id}
              {invoice.number && ` (#${invoice.number})`}
            </p>
            {sentDay && (
              <p>
                <strong>{t("ledger.detail.invoiceSent")}:</strong> {formatDay(sentDay)}
              </p>
            )}
            {isPayPalUrl(invoice.payerLink) && (
              <a
                href={invoice.payerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-primary debt-detail-paypal"
              >
                {t("ledger.detail.openPaypal")}
              </a>
            )}
          </div>
        )}

        {!invoice && (debt.status === "unpaid" || debt.status === "overdue") && (
          <div className="card" style={{ marginTop: "1rem", padding: "0.85rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))", border: "1px dashed var(--border)" }}>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--ink-muted)" }}>
              This tab has not been billed yet. Send an official PayPal invoice to collect securely.
            </p>
            <Link
              href="/collect"
              className="button button-primary button-sm"
              onClick={onClose}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
            >
              <SendIcon /> Bill with PayPal
            </Link>
          </div>
        )}

        <div className="debt-detail-actions">
          <button
            type="button"
            className="button debt-detail-delete"
            onClick={() => {
              onDelete(debt);
              onClose();
            }}
          >
            {t("ledger.delete")}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
  const gridRef = useRef<LedgerGridHandle>(null);
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
      const message = error instanceof DebtStoreError ? t("ledger.saveFailed") : t("common.tryAgain");
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
        <div className="ledger-head-actions">
          <Link href="/customers" className="button">
            {t("ledger.customers")}
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
              {t("ledger.exportCsv")}
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
              ref={gridRef}
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
        <div className="ledger-bulk-bar" role="toolbar" aria-label={t("ledger.bulk.label")}>
          <div className="ledger-bulk-info">
            {t("ledger.bulk.selected", {
              count: selectedDebts.length,
              amount: formatSen(selectedDebts.reduce((sum, d) => sum + d.amountSen, 0)),
            })}
          </div>
          <div className="ledger-bulk-actions">
            <button
              type="button"
              className="ledger-bulk-btn ledger-bulk-btn-primary"
              onClick={() => {
                // Collect has its own picker; this only checks there's something left to invoice.
                if (!selectedDebts.some((d) => d.status === "unpaid" || d.status === "overdue")) {
                  setNotice({ kind: "error", message: t("ledger.bulk.nothingToInvoice") });
                  return;
                }
                router.push("/collect");
              }}
            >
              {t("ledger.bulk.goToCollect")}
            </button>
            <button
              type="button"
              className="ledger-bulk-btn"
              onClick={() => {
                const csv = debtsToCsv(selectedDebts, invoiceIdMap);
                downloadCsv(csv, `buku-555-selected-${new Date().toISOString().slice(0, 10)}.csv`);
              }}
            >
              {t("ledger.exportCsv")}
            </button>
            <button
              type="button"
              className="ledger-bulk-btn"
              onClick={() => {
                gridRef.current?.clearSelection();
                setSelectedDebts([]);
              }}
            >
              {t("ledger.bulk.clear")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
