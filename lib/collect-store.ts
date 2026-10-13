// Customer emails and sent-invoice records, kept on the shop owner's device next to the
// debts (see debt-store.ts). A server store can replace this behind the same shape.

import type { PendingSend } from "./collect";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const EMAILS_KEY = "buku.emails.v1";
export const INVOICES_KEY = "buku.invoices.v1";
export const PENDING_KEY = "buku.pending.v1";

/** A PayPal invoice the shop sent from the Collect screen. */
export type InvoiceRecord = {
  /** PayPal's invoice id. */
  id: string;
  /** PayPal's invoice number, e.g. "0042", when it gave one. */
  number?: string;
  customerName: string;
  slug: string;
  email: string;
  debtIds: string[];
  amountSen: number;
  /** ISO timestamp. */
  sentAt: string;
  /** The link the customer opens to pay. */
  payerLink?: string;
};

export class CollectStoreError extends Error {
  constructor(message = "Couldn't save on this device. Try again.") {
    super(message);
    this.name = "CollectStoreError";
  }
}

function read<T>(storage: StorageLike | null, key: string, valid: (v: unknown) => v is T, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** For writes: like read(), but refuses to build on saved data it can't read, so it isn't wiped. */
function readForWrite<T>(storage: StorageLike, key: string, valid: (v: unknown) => v is T, fallback: T): T {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new CollectStoreError();
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (valid(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new CollectStoreError("Saved data on this device couldn't be read, so nothing was changed.");
}

function write(storage: StorageLike | null, key: string, value: unknown) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new CollectStoreError();
  }
}

function isEmailMap(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is InvoiceRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.customerName === "string" &&
    typeof r.slug === "string" &&
    typeof r.email === "string" &&
    Array.isArray(r.debtIds) &&
    r.debtIds.every((x) => typeof x === "string") &&
    typeof r.amountSen === "number" &&
    typeof r.sentAt === "string"
  );
}

function isPendingMap(v: unknown): v is Record<string, PendingSend> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((p) => {
    const r = p as Record<string, unknown>;
    return (
      typeof r?.slug === "string" &&
      typeof r.customerName === "string" &&
      typeof r.email === "string" &&
      typeof r.requestId === "string" &&
      typeof r.amountSen === "number" &&
      Array.isArray(r.debtIds) &&
      Array.isArray(r.lines)
    );
  });
}

function isRecordList(v: unknown): v is InvoiceRecord[] {
  return Array.isArray(v) && v.every(isRecord);
}

export type CollectStore = {
  emails(): Record<string, string>;
  /** Saves (or replaces) a customer's email, keyed by customer slug. */
  setEmail(slug: string, email: string): void;
  /** Newest first. */
  invoices(): InvoiceRecord[];
  /** Adds a record, or replaces the one with the same PayPal id (a retry that already went through). */
  addInvoice(record: InvoiceRecord): void;
  /** Unfinished sends by customer slug. */
  pending(): Record<string, PendingSend>;
  setPending(send: PendingSend): void;
  clearPending(slug: string): void;
};

/** Every call reads what's saved now, so two tabs don't overwrite each other's changes. */
export function createCollectStore(storage: StorageLike | null): CollectStore {
  let memEmails: Record<string, string> = {};
  let memInvoices: InvoiceRecord[] = [];
  let memPending: Record<string, PendingSend> = {};
  function savePending(change: (current: Record<string, PendingSend>) => Record<string, PendingSend>) {
    const next = change(storage ? readForWrite(storage, PENDING_KEY, isPendingMap, {}) : memPending);
    write(storage, PENDING_KEY, next);
    memPending = next;
  }
  return {
    emails: () => (storage ? read(storage, EMAILS_KEY, isEmailMap, {}) : { ...memEmails }),
    setEmail(slug, email) {
      const next = { ...(storage ? readForWrite(storage, EMAILS_KEY, isEmailMap, {}) : memEmails), [slug]: email.trim() };
      write(storage, EMAILS_KEY, next);
      memEmails = next;
    },
    invoices: () =>
      [...(storage ? read(storage, INVOICES_KEY, isRecordList, []) : memInvoices)].sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    addInvoice(record) {
      const current = storage ? readForWrite(storage, INVOICES_KEY, isRecordList, []) : memInvoices;
      const next = [...current.filter((r) => r.id !== record.id), record];
      write(storage, INVOICES_KEY, next);
      memInvoices = next;
    },
    pending: () => (storage ? read(storage, PENDING_KEY, isPendingMap, {}) : { ...memPending }),
    setPending(send) {
      savePending((current) => ({ ...current, [send.slug]: send }));
    },
    clearPending(slug) {
      savePending((current) => {
        const next = { ...current };
        delete next[slug];
        return next;
      });
    },
  };
}
