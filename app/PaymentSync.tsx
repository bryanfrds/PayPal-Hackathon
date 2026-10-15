"use client";

// Keeps the ledger in step with PayPal: asks where unsettled invoices stand when the app
// opens, when the owner comes back to it, and every minute while it's on screen, then marks
// debts paid, back to not sent (cancelled or refunded) or owed again (partly refunded).
// Renders nothing.
// The rules are in lib/payments.ts; this is only the timing and the saving.

import { useCallback, useEffect, useRef } from "react";
import { createCollectStore } from "@/lib/collect-store";
import { browserStorage } from "@/lib/debt-store";
import { invoicesToCheck, reconcileDebts, standingFrom, type InvoiceStanding, type StatusResult } from "@/lib/payments";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";

const BATCH = 25;
const EVERY_MS = 60_000;
// A hung request mustn't stop every later check.
const TIMEOUT_MS = 20_000;

export default function PaymentSync() {
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
    } catch {
      // Storage full or unreadable: the ledger shows what it knew; nothing is lost.
    }
  }, [ready, debts, invoices, updateMany]);

  const latest = useRef(invoices);
  latest.current = invoices;
  const busy = useRef(false);
  const triedAt = useRef<Record<string, string>>({});

  const check = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    const batch = invoicesToCheck(latest.current, BATCH, new Date(), triedAt.current);
    if (batch.length === 0) return;
    busy.current = true;
    // AbortSignal.timeout isn't in older iPhone Safari, so time out by hand.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const now = new Date().toISOString();
      for (const r of batch) triedAt.current[r.id] = now;
      const res = await fetch("/api/invoices/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: batch.map((r) => r.id) }),
        signal: abort.signal,
      });
      if (!res.ok) return;
      const { currency, results } = (await res.json()) as { currency: string; results: Record<string, StatusResult> };
      const standings: Record<string, InvoiceStanding> = {};
      for (const record of batch) {
        const standing = standingFrom(results[record.id], record.amountSen, currency, now);
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
    void check();
    const onVisible = () => void check();
    const timer = window.setInterval(onVisible, EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ready, check]);

  return null;
}
