"use client";

// Keeps the ledger in step with PayPal, then marks debts paid, back to not sent (cancelled or
// refunded) or owed again (partly refunded). Two sources, applied with the same rules:
// - the payments database (/api/invoices/standings), which PayPal's webhook updates within
//   seconds: read every few seconds while the app is on screen. Cheap: no PayPal call;
// - PayPal itself (/api/invoices/status): every minute, or every few minutes once the webhook
//   is set up, as the safety net for anything the webhook missed.
// Both run when the app opens and when the owner comes back to it. Renders nothing.
// The rules are in lib/payments.ts; this is only the timing and the saving.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { createCollectStore } from "@/lib/collect-store";
import { browserStorage } from "@/lib/debt-store";
import {
  invoicesToCheck,
  invoicesToRead,
  reconcileDebts,
  standingFrom,
  standingsFromStored,
  type InvoiceStanding,
  type StatusResult,
  type StoredAnswer,
} from "@/lib/payments";
import { customerSlug } from "@/lib/customer-tab";
import { refreshPublishedTabs } from "./tabLinks";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";

const BATCH = 25;
const EVERY_MS = 60_000;
// With the webhook set up, PayPal is only asked as a safety net.
const EVERY_MS_WITH_WEBHOOK = 5 * 60_000;
const READ_EVERY_MS = 10_000;
const READ_BATCH = 100;
// A hung request mustn't stop every later check.
const TIMEOUT_MS = 20_000;

/** Not on a customer's shared tab (/t/...): that's the customer's phone, with no ledger to sync. */
export default function PaymentSync() {
  const pathname = usePathname();
  if (pathname.startsWith("/t/")) return null;
  return <PaymentSyncOnOwnerDevice />;
}

function PaymentSyncOnOwnerDevice() {
  const { debts, ready: debtsReady, updateMany } = useDebts();
  const { invoices, ready: invoicesReady, setStandings } = useCollect();
  const ready = debtsReady && invoicesReady;

  // Apply PayPal's answers to the debts. Re-runs on every change and only writes what's
  // not done yet, so a failed save is simply tried again next time. Invoices are read fresh
  // from storage, so an invoice another tab just sent is counted even before this tab hears.
  useEffect(() => {
    if (!ready) return;
    // With storage blocked, the app's own in-memory records are the only copy.
    const storage = browserStorage();
    const { toPaid, toUnpaid, toSent } = reconcileDebts(debts, storage ? createCollectStore(storage).invoices() : invoices);
    try {
      if (toPaid.length > 0) updateMany(toPaid, { status: "paid" });
      if (toUnpaid.length > 0) updateMany(toUnpaid, { status: "unpaid" });
      if (toSent.length > 0) updateMany(toSent, { status: "sent" });
      // A payment came in (or was reversed): refresh those customers' shared tabs, if published.
      const changed = new Set([...toPaid, ...toUnpaid, ...toSent]);
      if (changed.size > 0) refreshPublishedTabs(debts.filter((d) => changed.has(d.id)).map((d) => customerSlug(d.customerName)));
    } catch {
      // Storage full or unreadable: the ledger shows what it knew; nothing is lost.
    }
  }, [ready, debts, invoices, updateMany]);

  const latest = useRef(invoices);
  latest.current = invoices;
  const busy = useRef(false);
  const triedAt = useRef<Record<string, string>>({});
  // What /api/invoices/standings said last: no database means stop asking it this visit.
  const db = useRef<{ available: boolean; webhook: boolean }>({ available: true, webhook: false });
  const reading = useRef(false);
  // After a failed read (signed out, database down), wait a minute rather than ask every 10s.
  const readAfter = useRef(0);
  const lastPayPalCheck = useRef(0);

  const read = useCallback(async () => {
    if (!db.current.available || reading.current || Date.now() < readAfter.current || document.visibilityState !== "visible") return;
    const batch = invoicesToRead(latest.current, READ_BATCH);
    if (batch.length === 0) return;
    reading.current = true;
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("/api/invoices/standings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: batch.map((r) => r.id) }),
        signal: abort.signal,
      });
      if (!res.ok) {
        readAfter.current = Date.now() + 60_000;
        return;
      }
      const body = (await res.json()) as { available?: boolean; webhook?: boolean; results?: StoredAnswer[] };
      db.current = { available: body.available === true, webhook: body.webhook === true };
      const standings = standingsFromStored(body.results ?? [], batch);
      // Only answers newer than what the device has; unchanged ones aren't saved again.
      if (Object.keys(standings).length > 0) setStandings(standings);
    } catch {
      // Offline or storage full: try again shortly.
      readAfter.current = Date.now() + 60_000;
    } finally {
      window.clearTimeout(timer);
      reading.current = false;
    }
  }, [setStandings]);

  const check = useCallback(async (force = false) => {
    if (busy.current || document.visibilityState !== "visible") return;
    const every = db.current.webhook ? EVERY_MS_WITH_WEBHOOK : EVERY_MS;
    if (!force && Date.now() - lastPayPalCheck.current < every - 1000) return;
    const batch = invoicesToCheck(latest.current, BATCH, new Date(), triedAt.current);
    if (batch.length === 0) return;
    busy.current = true;
    lastPayPalCheck.current = Date.now();
    // AbortSignal.timeout isn't in older iPhone Safari, so time out by hand.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const tried = new Date().toISOString();
      for (const r of batch) triedAt.current[r.id] = tried;
      const res = await fetch("/api/invoices/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: batch.map((r) => r.id) }),
        signal: abort.signal,
      });
      if (!res.ok) return;
      const { currency, checkedAt, results } = (await res.json()) as { currency: string; checkedAt?: string; results: Record<string, StatusResult> };
      // The server's clock, like the database's answers, so newer-wins compares like with like.
      const at = checkedAt && !Number.isNaN(Date.parse(checkedAt)) ? checkedAt : tried;
      const standings: Record<string, InvoiceStanding> = {};
      for (const record of batch) {
        const standing = standingFrom(results[record.id], record.amountSen, currency, at);
        if (standing) standings[record.id] = standing;
      }
      if (Object.keys(standings).length > 0) setStandings(standings);
    } catch {
      // Offline or storage full: try again on the next tick.
    } finally {
      window.clearTimeout(timer);
      busy.current = false;
    }
  }, [setStandings]);

  useEffect(() => {
    if (!ready) return;
    // Opening the app, or coming back to it: both sources at once.
    const onVisible = () => {
      void read();
      void check(true);
    };
    onVisible();
    const readTimer = window.setInterval(() => void read(), READ_EVERY_MS);
    const checkTimer = window.setInterval(() => void check(), EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(readTimer);
      window.clearInterval(checkTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ready, read, check]);

  return null;
}
