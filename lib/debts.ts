// A debt: one line from the shop's buku 555, whether typed in by hand or read from a scan.
//
// PROPOSAL for the team's shared data model, not agreed yet. Person 1 (scan/import) helps
// agree the record shape; Person 2 owns invoice and payment records, so `status` here is
// only what the ledger shows until invoices are linked. Change it together, not alone.
//
// Money is kept in whole sen (RM 1.00 = 100) so sums never pick up float error.

export type DebtStatus = "overdue" | "sent" | "unpaid" | "paid";
export type DebtSource = "manual" | "scan";

/** What each status reads as on screen. "unpaid" means no invoice has gone out yet. */
export const STATUS_LABEL: Record<DebtStatus, string> = {
  overdue: "Overdue",
  sent: "Invoice sent",
  unpaid: "Not sent",
  paid: "Paid",
};

export type Debt = {
  id: string;
  customerName: string;
  /** What was taken on credit, e.g. "Milo 1kg, gula 1kg". May be empty. */
  item: string;
  /** Whole sen. RM 12.50 is 1250. */
  amountSen: number;
  /** Day the debt was written down, YYYY-MM-DD. */
  date: string;
  status: DebtStatus;
  source: DebtSource;
  /** When the record was created, ISO timestamp. */
  createdAt: string;
};

/** What the owner types into the Add debt form. */
export type DebtInput = {
  customerName: string;
  item: string;
  /** As typed, e.g. "12.5" or "RM 12.50". */
  amount: string;
  /** YYYY-MM-DD. */
  date: string;
};

export type DebtField = "customerName" | "item" | "amount" | "date";
export type DebtErrors = Partial<Record<DebtField, string>>;

export const MAX_AMOUNT_SEN = 10_000_00; // RM 10,000: far above any kedai tab, catches typos
export const MAX_NAME_LENGTH = 60;
export const MAX_ITEM_LENGTH = 120;

// Plain digits, or digits grouped in threes with commas ("1,250"). A comma anywhere
// else is refused: "12,50" is a comma typed for a decimal point, not RM 1,250.
const AMOUNT = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;

/**
 * Reads an amount typed in ringgit ("12", "12.5", "RM 12.50", "1,250.00") into whole sen.
 * Returns null for anything that isn't a plain amount with at most two decimals.
 */
export function parseRmToSen(text: string): number | null {
  const typed = text.trim().replace(/^rm\s*/i, "");
  if (!AMOUNT.test(typed)) return null;
  const [whole, fraction = ""] = typed.replace(/,/g, "").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** 1250 → "12.50" */
export function formatSen(sen: number): string {
  const sign = sen < 0 ? "-" : "";
  const abs = Math.abs(sen);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Today's date in the owner's own time zone, YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** An empty form, dated the day it's opened. Call it in the browser, not at build time. */
export function formDefaults(now: Date = new Date()): DebtInput {
  return { customerName: "", item: "", amount: "", date: todayLocal(now) };
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type Validated =
  | { ok: true; value: Omit<Debt, "id" | "status" | "source" | "createdAt"> }
  | { ok: false; errors: DebtErrors };

/** Checks the form. `today` is YYYY-MM-DD; a debt can't be dated after it. */
export function validateDebtInput(input: DebtInput, today: string): Validated {
  const errors: DebtErrors = {};
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  const item = input.item.trim().replace(/\s+/g, " ");

  if (!customerName) errors.customerName = "Enter the customer's name.";
  else if (customerName.length > MAX_NAME_LENGTH)
    errors.customerName = `Keep the name under ${MAX_NAME_LENGTH} characters.`;

  if (item.length > MAX_ITEM_LENGTH) errors.item = `Keep this under ${MAX_ITEM_LENGTH} characters.`;

  const amountSen = parseRmToSen(input.amount);
  if (!input.amount.trim()) errors.amount = "Enter how much they owe.";
  else if (amountSen === null) errors.amount = "Use a number like 12.50 (at most 2 decimals).";
  else if (amountSen <= 0) errors.amount = "The amount must be more than RM 0.";
  else if (amountSen > MAX_AMOUNT_SEN) errors.amount = `That's over RM ${formatSen(MAX_AMOUNT_SEN)}. Check the amount.`;

  if (!isRealDate(input.date)) errors.date = "Pick a date.";
  else if (input.date > today) errors.date = "The date can't be in the future.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { customerName, item, amountSen: amountSen as number, date: input.date } };
}

/** A new hand-entered debt. Unpaid until an invoice is sent or it's paid. */
export function createManualDebt(
  value: Omit<Debt, "id" | "status" | "source" | "createdAt">,
  opts: { id: string; now: Date },
): Debt {
  return { ...value, id: opts.id, status: "unpaid", source: "manual", createdAt: opts.now.toISOString() };
}

/** Most urgent first. Used for sorting the ledger. */
export const STATUS_ORDER: Record<DebtStatus, number> = { overdue: 0, sent: 1, unpaid: 2, paid: 3 };

/** Overdue first, then by status, then oldest date first within a status. */
export function sortDebts(debts: Debt[]): Debt[] {
  return [...debts].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.date.localeCompare(b.date);
  });
}

export type Outstanding = { totalSen: number; count: number };

/** What's still owed: every debt that isn't paid. Whole sen, so no float error. */
export function outstanding(debts: Debt[]): Outstanding {
  let totalSen = 0;
  let count = 0;
  for (const debt of debts) {
    if (debt.status === "paid") continue;
    totalSen += debt.amountSen;
    count += 1;
  }
  return { totalSen, count };
}

/** True for anything shaped like a Debt; used when reading saved data back. */
export function isDebt(value: unknown): value is Debt {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.customerName === "string" &&
    typeof d.item === "string" &&
    Number.isSafeInteger(d.amountSen) &&
    (d.amountSen as number) > 0 &&
    typeof d.date === "string" &&
    isRealDate(d.date) &&
    (d.status === "overdue" || d.status === "sent" || d.status === "unpaid" || d.status === "paid") &&
    (d.source === "manual" || d.source === "scan") &&
    typeof d.createdAt === "string"
  );
}
