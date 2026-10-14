"use client";

// Keeps the ledger in step with PayPal: asks where unsettled invoices stand when the app
// opens, when the owner comes back to it, and every minute while it's on screen, then marks
// debts paid (or back to not sent, if an invoice was cancelled). Renders nothing.
// The rules are in lib/payments.ts; this is only the timing and the saving.

import { useCallback, useEffect, useRef } from "react";
import { invoicesToCheck, reconcileDebts, settlementOf, type InvoiceStanding, type StatusResult } from "@/lib/payments";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";

const BATCH = 25;
const EVERY_MS = 60_000;

export default function PaymentSync() {
  const { debts, ready: debtsReady, updateMany } = useDebts();
  const { invoices, ready: invoicesReady, setStandings } = useCollect();
  const ready = debtsReady && invoicesReady;

  // Apply PayPal's answers to the debts. Re-runs on every change and only writes what's
  // not done yet, so a failed save is simply tried again next time.
  useEffect(() => {
    if (!ready) return;
    const { toPaid, toUnpaid } = reconcileDebts(debts, invoices);
    try {
      if (toPaid.length > 0) updateMany(toPaid, { status: "paid" });
      if (toUnpaid.length > 0) updateMany(toUnpaid, { status: "unpaid" });
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
    const batch = invoicesToCheck(latest.current, BATCH, triedAt.current);
    if (batch.length === 0) return;
    busy.current = true;
    try {
      const now = new Date().toISOString();
      for (const r of batch) triedAt.current[r.id] = now;
      const res = await fetch("/api/invoices/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: batch.map((r) => r.id) }),
      });
      if (!res.ok) return;
      const { results } = (await res.json()) as { results: Record<string, StatusResult> };
      const standings: Record<string, InvoiceStanding> = {};
      for (const record of batch) {
        const result = results[record.id];
        if (!result?.ok) continue;
        const { ok: _ok, ...facts } = result;
        standings[record.id] = { ...facts, settlement: settlementOf(facts, record.amountSen), checkedAt: now };
      }
      if (Object.keys(standings).length > 0) setStandings(standings);
    } catch {
      // Offline or storage full: try again on the next tick.
    } finally {
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
