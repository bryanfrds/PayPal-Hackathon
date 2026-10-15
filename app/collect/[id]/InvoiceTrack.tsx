"use client";

// One sent invoice, tracked like a parcel: Sent, then Paid. The pay link can be copied or
// shared on WhatsApp. PayPal's live answer comes from the same check the ledger uses
// (/api/invoices/status and lib/payments.ts), so the two never disagree.

import Link from "next/link";
import { useEffect, useState } from "react";
import { isPayPalUrl } from "@/lib/customer-pay";
import { invoiceView, standingFrom, type InvoiceStanding, type StatusResult } from "@/lib/payments";
import { formatDay } from "@/lib/customer-tab";
import { formatSen } from "@/lib/debts";
import Avatar from "../../components/Avatar";
import StatusBadge from "../../components/StatusBadge";
import { BackIcon, ChatIcon, CheckIcon, ClockIcon, LinkIcon } from "../../components/icons";
import { useCollect } from "../../useCollect";
import { useDebts } from "../../useDebts";
import { useShop } from "../../useShop";

type Live = { state: "loading" } | { state: "ok"; standing: InvoiceStanding } | { state: "error"; message: string };

const VIEW_NOTE: Record<ReturnType<typeof invoiceView>, string> = {
  waiting: "PayPal says it's waiting for payment.",
  processing: "PayPal is processing the customer's payment.",
  paid: "PayPal says this invoice is paid.",
  cancelled: "PayPal says this invoice was cancelled. Its tab is owed again; send a new invoice from Collect.",
  refunded: "PayPal says this invoice was refunded. Its tab is owed again; send a new invoice from Collect.",
  check: "PayPal's answer doesn't match what you billed (a partial refund, or a changed total). The tab stays owed; check it on PayPal.",
};

export default function InvoiceTrack({ id }: { id: string }) {
  const { invoices, ready, setStandings } = useCollect();
  const { debts } = useDebts();
  const { name: shopName } = useShop();
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
        const data = (await res.json().catch(() => ({}))) as { currency?: string; results?: Record<string, StatusResult>; error?: string };
        if (cancelled) return;
        const result = data.results?.[recordId];
        const standing = res.ok && data.currency ? standingFrom(result, billedSen, data.currency, new Date().toISOString()) : undefined;
        if (!standing) {
          setLive({ state: "error", message: data.error ?? (result && !result.ok ? result.error : "Couldn't reach PayPal.") });
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
        if (!cancelled) setLive({ state: "error", message: "No internet connection." });
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, billedSen, setStandings]);

  if (!ready) {
    return (
      <p className="card loading" aria-busy="true">
        Loading…
      </p>
    );
  }

  if (!record) {
    return (
      <div className="collect">
        <div className="tab-top">
          <Link href="/collect" className="tab-back" aria-label="Back to Collect">
            <BackIcon />
          </Link>
          <h1>Invoice</h1>
          <span className="tab-back" aria-hidden="true" />
        </div>
        <div className="card empty-state">
          <p>This invoice isn&apos;t on this device. Invoices sent from another phone show up there.</p>
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
  const shareText = `Hi ${record.customerName}, here's your invoice from ${shopName} for RM ${formatSen(record.amountSen)}. You can pay with PayPal or card: ${payerLink}`;

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
        <Link href="/collect" className="tab-back" aria-label="Back to Collect">
          <BackIcon />
        </Link>
        <h1>{record.number ? `Invoice ${record.number}` : "Invoice"}</h1>
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
        <p className="tab-item">Sent {sentDay}</p>

        <ol className="track-steps">
          <li className="done">
            <span aria-hidden="true">
              <CheckIcon />
            </span>
            Sent
            <small>{sentDay.replace(/ \d{4}$/, "")}</small>
          </li>
          <li className={paid ? "done" : closed ? undefined : "now"}>
            <span aria-hidden="true">
              <ClockIcon />
            </span>
            Waiting
            <small>{paid ? "Done" : closed ? "Stopped" : view === "processing" ? "Processing" : view === "check" ? "Check" : "For payment"}</small>
          </li>
          <li className={paid ? "done" : undefined}>
            <span aria-hidden="true">
              <CheckIcon />
            </span>
            Paid
            <small>{paid ? "On PayPal" : "Not yet"}</small>
          </li>
        </ol>
        <p className="tab-note" role="status">
          {live.state === "loading" ? "Checking PayPal… " : live.state === "error" ? `${live.message} Showing what this device knows. ` : ""}
          {live.state !== "loading" && VIEW_NOTE[view]}
        </p>
      </section>

      {/* No pay link to share once PayPal has cancelled or refunded the invoice. */}
      {payerLink && !closed && (
        <div className="track-actions">
          <button type="button" onClick={copy}>
            <span aria-hidden="true">
              <LinkIcon />
            </span>
            {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy pay link"}
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
              <span>{d.item || "Shop items"}</span>
              <b>RM {formatSen(d.amountSen)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
