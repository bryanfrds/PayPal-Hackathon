"use client";

// One sent invoice, tracked like a parcel: Sent, then Paid. The pay link can be copied or
// shared on WhatsApp. PayPal's live answer comes from the same check the ledger uses
// (/api/invoices/status and lib/payments.ts), so the two never disagree.

import Link from "next/link";
import { useEffect, useState } from "react";
import { SHOP_ITEMS } from "@/lib/collect";
import { isPayPalUrl } from "@/lib/customer-pay";
import type { TKey } from "@/lib/i18n";
import { invoiceView, standingFrom, type InvoiceStanding, type InvoiceView, type StatusResult } from "@/lib/payments";
import { formatSen } from "@/lib/debts";
import Avatar from "../../components/Avatar";
import StatusBadge from "../../components/StatusBadge";
import { BackIcon, ChatIcon, CheckIcon, ClockIcon, LinkIcon } from "../../components/icons";
import { useCollect } from "../../useCollect";
import { useDebts } from "../../useDebts";
import { useShop } from "../../useShop";
import { useT } from "../../useT";

type Live =
  | { state: "loading" }
  | { state: "ok"; standing: InvoiceStanding }
  | { state: "error"; message?: string; fallback: "invoice.reachFailed" | "invoice.offline" };

// What the owner reads about the invoice, from the same view the ledger and Sent tab use.
const VIEW_NOTE = {
  waiting: "invoice.isWaiting",
  processing: "invoice.isProcessing",
  paid: "invoice.isPaid",
  cancelled: "invoice.isCancelled",
  refunded: "invoice.isRefunded",
  check: "invoice.isCheck",
} as const satisfies Record<InvoiceView, TKey>;

const STEP_NOTE = {
  waiting: "invoice.step.forPayment",
  processing: "invoice.step.processing",
  paid: "invoice.step.done",
  cancelled: "invoice.step.stopped",
  refunded: "invoice.step.stopped",
  check: "invoice.step.check",
} as const satisfies Record<InvoiceView, TKey>;

export default function InvoiceTrack({ id }: { id: string }) {
  const { invoices, ready, setStandings } = useCollect();
  const { debts } = useDebts();
  const { name: shopName } = useShop();
  const { t, formatDay } = useT();
  const record = invoices.find((r) => r.id === id);
  const [live, setLive] = useState<Live>({ state: "loading" });
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const recordId = record?.id;
  const billedSen = record?.amountSen;
  useEffect(() => {
    if (!recordId || billedSen === undefined) return;
    let cancelled = false;
    fetch("/api/invoices/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [recordId] }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { currency?: string; checkedAt?: string; results?: Record<string, StatusResult>; error?: string };
        if (cancelled) return;
        const result = data.results?.[recordId];
        const standing = res.ok && data.currency ? standingFrom(result, billedSen, data.currency, data.checkedAt ?? new Date().toISOString()) : undefined;
        if (!standing) {
          setLive({ state: "error", message: data.error ?? (result && !result.ok ? result.error : undefined), fallback: "invoice.reachFailed" });
          return;
        }
        setLive({ state: "ok", standing });
        // Saved like the background check's answers, so the ledger catches up straight away.
        try {
          setStandings({ [recordId]: standing });
        } catch {
          // Not saved on this device; the background check will try again.
        }
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "error", fallback: "invoice.offline" });
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, billedSen, setStandings]);

  if (!ready) {
    return (
      <p className="card loading" aria-busy="true">
        {t("common.loading")}
      </p>
    );
  }

  if (!record) {
    return (
      <div className="collect">
        <div className="tab-top">
          <Link href="/collect" className="tab-back" aria-label={t("invoice.backToCollect")}>
            <BackIcon />
          </Link>
          <h1>{t("invoice.title")}</h1>
          <span className="tab-back" aria-hidden="true" />
        </div>
        <div className="card empty-state">
          <p>{t("invoice.notOnDevice")}</p>
        </div>
      </div>
    );
  }

  // PayPal's answer now, or what the last check on this device found.
  const standing = live.state === "ok" ? live.standing : record.standing;
  const view = standing ? invoiceView(standing) : "waiting";
  const paid = view === "paid";
  const closed = view === "cancelled" || view === "refunded";
  const payerLink = isPayPalUrl(record.payerLink) ? record.payerLink : undefined;
  const items = debts.filter((d) => record.debtIds.includes(d.id));
  const sentDay = formatDay(record.sentAt.slice(0, 10));
  const sentDayShort = formatDay(record.sentAt.slice(0, 10), { year: false });
  const shareText = t("invoice.shareText", { name: record.customerName, shop: shopName, amount: formatSen(record.amountSen), link: payerLink ?? "" });

  async function copy() {
    if (!payerLink) return;
    try {
      await navigator.clipboard.writeText(payerLink);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="collect">
      <div className="tab-top">
        <Link href="/collect" className="tab-back" aria-label={t("invoice.backToCollect")}>
          <BackIcon />
        </Link>
        <h1>{record.number ? t("invoice.titleNumber", { number: record.number }) : t("invoice.title")}</h1>
        <span className="tab-back" aria-hidden="true" />
      </div>

      <section className="card track-card">
        <div className="track-who">
          <Avatar name={record.customerName} />
          <span className="tab-who">
            <span className="tab-name">{record.customerName}</span>
            <span className="tab-item">{record.email}</span>
          </span>
          {/* A cancelled invoice's tab is owed again and back on the To send list. */}
          <StatusBadge status={paid ? "paid" : closed ? "unpaid" : "sent"} />
        </div>
        <p className="track-big">
          <small>RM</small>
          {formatSen(record.amountSen)}
        </p>
        <p className="tab-item">{t("invoice.sentOn", { day: sentDay })}</p>

        <ol className="track-steps">
          <li className="done">
            <span aria-hidden="true">
              <CheckIcon />
            </span>
            {t("invoice.step.sent")}
            <small>{sentDayShort}</small>
          </li>
          <li className={paid ? "done" : closed ? undefined : "now"}>
            <span aria-hidden="true">
              <ClockIcon />
            </span>
            {t("invoice.step.waiting")}
            <small>{t(STEP_NOTE[view])}</small>
          </li>
          <li className={paid ? "done" : undefined}>
            <span aria-hidden="true">
              <CheckIcon />
            </span>
            {t("invoice.step.paid")}
            <small>{paid ? t("invoice.step.onPayPal") : t("invoice.step.notYet")}</small>
          </li>
        </ol>
        <p className="tab-note" role="status">
          {live.state === "loading" ? t("invoice.checking") : live.state === "error" ? `${t("invoice.errorFallback", { message: live.message ?? t(live.fallback) })} ${t(VIEW_NOTE[view])}` : t(VIEW_NOTE[view])}
        </p>
      </section>

      {/* No pay link to share once PayPal has cancelled or refunded the invoice. */}
      {payerLink && !closed && (
        <div className="track-actions">
          <button type="button" onClick={copy}>
            <span aria-hidden="true">
              <LinkIcon />
            </span>
            {copied === "done" ? t("invoice.copied") : copied === "failed" ? t("invoice.copyFailed") : t("invoice.copyLink")}
          </button>
          <a className="track-wa" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">
              <ChatIcon />
            </span>
            WhatsApp
          </a>
        </div>
      )}

      {items.length > 0 && (
        <ul className="card track-lines">
          {items.map((d) => (
            <li key={d.id}>
              {/* The words on the PayPal invoice itself, which stay English. */}
              <span>{d.item || SHOP_ITEMS}</span>
              <b>RM {formatSen(d.amountSen)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
