// A published copy of one customer's tab: exactly what their /t/<token> page shows, and
// nothing else. Built on the owner's device, checked strictly on the server before it's saved,
// and read back for the public page. Pure, so it runs in the browser, on the server and in tests.
//
// Privacy: one customer only; no email addresses; no other customers' names; the device's own
// debt and invoice ids are replaced by short local ones (PayPal's invoice id stays, because the
// pay page asks PayPal for the invoice's live status by it, and it's in the pay link anyway).

import type { InvoiceRecord } from "./collect-store";
import { isPayPalUrl } from "./customer-pay";
import { customerSlug } from "./customer-tab";
import type { Debt, DebtStatus } from "./debts";

export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 64 * 1024;
export const MAX_DEBTS = 500;
export const MAX_INVOICES = 100;
const MAX_TEXT = 200; // = MAX_TEXT_LENGTH, below

export type SnapshotDebt = { id: string; item: string; amountSen: number; date: string; status: DebtStatus };
export type SnapshotInvoice = {
  id: string;
  number?: string;
  debtIds: string[];
  amountSen: number;
  sentAt: string;
  payerLink?: string;
};
export type TabSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  customerName: string;
  shopName: string;
  debts: SnapshotDebt[];
  invoices: SnapshotInvoice[];
};

const STATUSES: DebtStatus[] = ["overdue", "sent", "unpaid", "paid"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day (2026-02-30 is refused), written YYYY-MM-DD. */
function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Limits shared by the device (buildTabSnapshot) and the server (parseTabSnapshot). */
export const MAX_TEXT_LENGTH = 200;
export const MAX_INVOICE_NUMBER_LENGTH = 64;
export const MAX_SLUG_LENGTH = 200;
const LOCAL_ID = /^[a-z]\d{1,4}$/;
const INVOICE_ID = /^[A-Za-z0-9-]{5,64}$/;

/** One customer's tab from the owner's debts and invoices. Paid and unpaid debts; open invoices only. */
export function buildTabSnapshot(slug: string, debts: Debt[], invoices: InvoiceRecord[], shopName: string): TabSnapshot | null {
  const mine = debts
    .filter((d) => customerSlug(d.customerName) === slug)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_DEBTS);
  if (mine.length === 0) return null;
  const localId = new Map(mine.map((d, i) => [d.id, `d${i + 1}`]));
  const unpaid = new Set(mine.filter((d) => d.status !== "paid").map((d) => d.id));
  const open = invoices
    .filter((r) => r.slug === slug && r.debtIds.some((id) => unpaid.has(id)))
    .filter((r) => r.standing?.settlement !== "closed" && r.standing?.settlement !== "paid" && INVOICE_ID.test(r.id))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, MAX_INVOICES);
  return {
    v: SNAPSHOT_VERSION,
    customerName: text(mine[mine.length - 1].customerName),
    shopName: text(shopName),
    debts: mine.map((d) => ({ id: localId.get(d.id)!, item: text(d.item), amountSen: d.amountSen, date: d.date, status: d.status })),
    invoices: open.map((r) => ({
      id: r.id,
      ...(r.number ? { number: r.number.slice(0, MAX_INVOICE_NUMBER_LENGTH) } : {}),
      debtIds: r.debtIds.filter((id) => localId.has(id)).map((id) => localId.get(id)!),
      amountSen: r.amountSen,
      sentAt: r.sentAt,
      ...(isPayPalUrl(r.payerLink) ? { payerLink: r.payerLink } : {}),
    })),
  };
}

function text(s: string): string {
  return s.slice(0, MAX_TEXT);
}

type Check = { ok: true; snapshot: TabSnapshot } | { ok: false; error: string };

function exactKeys(v: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(v);
  return required.every((k) => k in v) && keys.every((k) => required.includes(k) || optional.includes(k));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isSen = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 10_000_000;

/**
 * Checks a snapshot sent to the server: the exact fields above and nothing more, sensible
 * sizes, real dates and amounts, and only PayPal https pages as pay links.
 */
export function parseTabSnapshot(value: unknown): Check {
  const fail = (error: string): Check => ({ ok: false, error });
  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return fail("Not JSON.");
  }
  if (size > MAX_SNAPSHOT_BYTES) return fail("Too big.");
  if (!isObj(value) || !exactKeys(value, ["v", "customerName", "shopName", "debts", "invoices"])) return fail("Unexpected fields.");
  if (value.v !== SNAPSHOT_VERSION) return fail("Unknown version.");
  if (!isText(value.customerName) || !value.customerName.trim()) return fail("Bad customer name.");
  if (!isText(value.shopName) || !value.shopName.trim()) return fail("Bad shop name.");
  if (!Array.isArray(value.debts) || value.debts.length === 0 || value.debts.length > MAX_DEBTS) return fail("Bad debts.");
  if (!Array.isArray(value.invoices) || value.invoices.length > MAX_INVOICES) return fail("Bad invoices.");
  const ids = new Set<string>();
  for (const d of value.debts) {
    if (!isObj(d) || !exactKeys(d, ["id", "item", "amountSen", "date", "status"])) return fail("Unexpected debt fields.");
    if (typeof d.id !== "string" || !LOCAL_ID.test(d.id) || ids.has(d.id)) return fail("Bad debt id.");
    if (!isText(d.item) || !isSen(d.amountSen) || !isDay(d.date)) return fail("Bad debt.");
    if (!STATUSES.includes(d.status as DebtStatus)) return fail("Bad debt status.");
    ids.add(d.id);
  }
  for (const r of value.invoices) {
    if (!isObj(r) || !exactKeys(r, ["id", "debtIds", "amountSen", "sentAt"], ["number", "payerLink"])) return fail("Unexpected invoice fields.");
    if (typeof r.id !== "string" || !INVOICE_ID.test(r.id)) return fail("Bad invoice id.");
    if (r.number !== undefined && (!isText(r.number, MAX_INVOICE_NUMBER_LENGTH) || !r.number)) return fail("Bad invoice number.");
    if (!Array.isArray(r.debtIds) || r.debtIds.length === 0 || r.debtIds.some((id) => typeof id !== "string" || !ids.has(id))) {
      return fail("Bad invoice debts.");
    }
    if (!isSen(r.amountSen) || typeof r.sentAt !== "string" || Number.isNaN(Date.parse(r.sentAt)) || r.sentAt.length > 40) {
      return fail("Bad invoice.");
    }
    if (r.payerLink !== undefined && !(isText(r.payerLink, 500) && isPayPalUrl(r.payerLink))) return fail("Pay links must be PayPal pages.");
  }
  return { ok: true, snapshot: value as TabSnapshot };
}

/** The snapshot as the tab screens' inputs: debts and invoice records for the customer page. */
export function snapshotToTab(snapshot: TabSnapshot): { slug: string; debts: Debt[]; invoices: InvoiceRecord[] } {
  const slug = customerSlug(snapshot.customerName);
  const debts: Debt[] = snapshot.debts.map((d) => ({
    id: d.id,
    customerName: snapshot.customerName,
    item: d.item,
    amountSen: d.amountSen,
    date: d.date,
    status: d.status,
    source: "manual",
    createdAt: `${d.date}T00:00:00.000Z`,
  }));
  const invoices: InvoiceRecord[] = snapshot.invoices.map((r) => ({
    id: r.id,
    number: r.number,
    customerName: snapshot.customerName,
    slug,
    email: "",
    debtIds: r.debtIds,
    amountSen: r.amountSen,
    sentAt: r.sentAt,
    payerLink: r.payerLink,
  }));
  return { slug, debts, invoices };
}

/** A new link token: 128 random bits, base64url (22 characters). */
export function newTabToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** True for a token this app could have made. Anything else is turned away before the database. */
export function isTabToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_PATTERN.test(v);
}

/** The public page for a token. */
export function tabLinkPath(token: string): string {
  return `/t/${token}`;
}
