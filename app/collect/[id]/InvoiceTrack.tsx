"use client";

// One sent invoice, tracked like a parcel: Sent, then Paid. The pay link can be copied or
// shared on WhatsApp. PayPal's live status is read from /api/invoices/<id>.

import Link from "next/link";
import { useEffect, useState } from "react";
import { isPayPalUrl } from "@/lib/customer-pay";
import { formatDay } from "@/lib/customer-tab";
import { formatSen } from "@/lib/debts";
import Avatar from "../../components/Avatar";
import StatusBadge from "../../components/StatusBadge";
import { BackIcon, ChatIcon, CheckIcon, ClockIcon, LinkIcon } from "../../components/icons";
import { useCollect } from "../../useCollect";
import { useDebts } from "../../useDebts";

type Live = { state: "loading" } | { state: "ok"; status: string; payerLink?: string } | { state: "error"; message: string };

const PAID = new Set(["PAID", "MARKED_AS_PAID"]);

export default function InvoiceTrack({ id }: { id: string }) {
  const { invoices, ready } = useCollect();
  const { debts } = useDebts();
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
        if (!res.ok || !data.status) setLive({ state: "error", message: data.error ?? "Couldn't reach PayPal." });
        else setLive({ state: "ok", status: data.status, payerLink: data.payerLink });
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "error", message: "No internet connection." });
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

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

  const paid = live.state === "ok" && PAID.has(live.status);
  const payerLink = [live.state === "ok" ? live.payerLink : undefined, record.payerLink].find(isPayPalUrl);
  const items = debts.filter((d) => record.debtIds.includes(d.id));
  const sentDay = formatDay(record.sentAt.slice(0, 10));
  const shareText = `Hi ${record.customerName}, here's your invoice from Kedai Ah Seng for RM ${formatSen(record.amountSen)}. You can pay with PayPal or card: ${payerLink}`;

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
          <StatusBadge status={paid ? "paid" : "sent"} />
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
          <li className={paid ? "done" : "now"}>
            <span aria-hidden="true">
              <ClockIcon />
            </span>
            Waiting
            <small>{paid ? "Done" : "For payment"}</small>
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
          {live.state === "loading"
            ? "Checking PayPal…"
            : live.state === "error"
              ? `${live.message} Showing what this device knows.`
              : paid
                ? "PayPal says this invoice is paid."
                : "PayPal says it's waiting for payment."}
        </p>
      </section>

      {payerLink && (
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
