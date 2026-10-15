"use client";

// One sent invoice, tracked like a parcel: Sent, then Paid. The pay link can be copied or
// shared on WhatsApp. PayPal's live status is read from /api/invoices/<id>.

import Link from "next/link";
import { useEffect, useState } from "react";
import { isPayPalUrl } from "@/lib/customer-pay";
import { formatSen } from "@/lib/debts";
import Avatar from "../../components/Avatar";
import StatusBadge from "../../components/StatusBadge";
import { BackIcon, ChatIcon, CheckIcon, ClockIcon, LinkIcon } from "../../components/icons";
import { useCollect } from "../../useCollect";
import { useDebts } from "../../useDebts";
import { useShop } from "../../useShop";
import { useT } from "../../useT";

type Live = { state: "loading" } | { state: "ok"; status: string; payerLink?: string } | { state: "error"; message?: string; fallback: "invoice.reachFailed" | "invoice.offline" };

const PAID = new Set(["PAID", "MARKED_AS_PAID"]);

export default function InvoiceTrack({ id }: { id: string }) {
  const { invoices, ready } = useCollect();
  const { debts } = useDebts();
  const { name: shopName } = useShop();
  const { t, formatDay } = useT();
  const record = invoices.find((r) => r.id === id);
  const [live, setLive] = useState<Live>({ state: "loading" });
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const recordId = record?.id;
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    fetch(`/api/invoices/${encodeURIComponent(recordId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { status?: string; payerLink?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.status) setLive({ state: "error", message: data.error, fallback: "invoice.reachFailed" });
        else setLive({ state: "ok", status: data.status, payerLink: data.payerLink });
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "error", fallback: "invoice.offline" });
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

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

  const paid = live.state === "ok" && PAID.has(live.status);
  const payerLink = [live.state === "ok" ? live.payerLink : undefined, record.payerLink].find(isPayPalUrl);
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
          <StatusBadge status={paid ? "paid" : "sent"} />
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
          <li className={paid ? "done" : "now"}>
            <span aria-hidden="true">
              <ClockIcon />
            </span>
            {t("invoice.step.waiting")}
            <small>{paid ? t("invoice.step.done") : t("invoice.step.forPayment")}</small>
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
          {live.state === "loading"
            ? t("invoice.checking")
            : live.state === "error"
              ? t("invoice.errorFallback", { message: live.message ?? t(live.fallback) })
              : paid
                ? t("invoice.isPaid")
                : t("invoice.isWaiting")}
        </p>
      </section>

      {payerLink && (
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
              <span>{d.item || t("invoice.shopItems")}</span>
              <b>RM {formatSen(d.amountSen)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
