// Where several sent invoices stand on PayPal, in one request, for payment reconciliation
// (see lib/payments.ts and app/PaymentSync.tsx). Read-only: the device decides which
// debts that makes paid.

import { NextResponse } from "next/server";
import { moneyToSen, type InvoiceFacts, type StatusResult } from "@/lib/payments";
import { getInvoice, PayPalError, shopCurrency, type PayPalInvoice } from "@/lib/paypal";
import { paypalFailure } from "../errors";
import { requireOwner } from "@/lib/auth-server";

const MAX_IDS = 25;
// PayPal calls at once, so a full batch doesn't trip its rate limit.
const CONCURRENCY = 5;

const ID = /^[A-Za-z0-9-]{5,64}$/;

function parseIds(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null) return null;
  const ids = (value as Record<string, unknown>).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((id): id is string => typeof id === "string" && ID.test(id))) return null;
  return [...new Set(ids)];
}

function factsOf(invoice: PayPalInvoice): InvoiceFacts {
  return {
    status: invoice.status ?? "UNKNOWN",
    currency: invoice.amount?.currency_code ?? invoice.detail?.currency_code,
    totalSen: moneyToSen(invoice.amount?.value),
    paidSen: moneyToSen(invoice.payments?.paid_amount?.value),
    dueSen: moneyToSen(invoice.due_amount?.value),
  };
}

export async function POST(request: Request) {
  // Only the signed-in shop owner (proxy.ts checks too): stops anyone else fanning out PayPal calls.
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const ids = parseIds(raw);
  if (!ids) return NextResponse.json({ error: `Send 1 to ${MAX_IDS} invoice ids.` }, { status: 400 });

  const results: Record<string, StatusResult> = {};
  let fatal: PayPalError | null = null;
  const queue = [...ids];

  async function worker() {
    for (let id = queue.shift(); id !== undefined && !fatal; id = queue.shift()) {
      try {
        results[id] = { ok: true, ...factsOf(await getInvoice(id)) };
      } catch (error) {
        console.error("POST /api/invoices/status failed for one invoice:", error instanceof Error ? error.message : error);
        const paypal = error instanceof PayPalError ? error : null;
        // Missing or rejected keys fail every invoice the same way, and a rate limit only gets
        // worse with more calls: stop and say so once.
        if (paypal && (/ is not set\./.test(paypal.message) || [401, 403, 429].includes(paypal.status ?? 0))) fatal = paypal;
        results[id] = { ok: false, error: paypalFailure(paypal).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

  if (fatal) {
    const failure = paypalFailure(fatal);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
  return NextResponse.json({ currency: shopCurrency(), results });
}
