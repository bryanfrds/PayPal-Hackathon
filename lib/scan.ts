// What a scan produces and how the owner's checked lines become debts.
//
// The real reading (photo → lines) is Person 1's vision-model extraction. Until it's
// connected, sampleRead() returns a fixed, realistic result so the screens can be built
// and demoed. Extraction only makes drafts: nothing is saved until the owner checks it.

import { createManualDebt, validateDebtInput, type Debt, type DebtErrors } from "./debts";
import { translator, type T } from "./i18n";

export type ScanMode = "notebook" | "receipt";

export type ScanLine = {
  /** Local id for the check screen, not a debt id. */
  key: string;
  customerName: string;
  item: string;
  /** As read, e.g. "13.50". Kept as text so the owner can correct it in the same form. */
  amount: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Ticked lines become debts. */
  include: boolean;
  /** Why the reader wasn't sure, shown as a flag. Cleared once the owner edits the line. */
  unsure?: string;
};

function line(key: string, customerName: string, item: string, amount: string, date: string, unsure?: string): ScanLine {
  return { key, customerName, item, amount, date, include: !unsure, unsure };
}

/**
 * Stand-in for Person 1's extraction. A notebook page reads as several customers' lines;
 * a receipt reads as one purchase with no customer name (the owner picks one).
 */
export function sampleRead(mode: ScanMode, today: string, t: T = translator()): ScanLine[] {
  if (mode === "receipt") {
    return [line("r1", "", "Milo 1kg, gula 1kg, telur 10 biji", "24.70", today)];
  }
  return [
    line("n1", "Mak Cik Siti", "Beras", "48.50", today),
    line("n2", "Pak Ali (Bengkel)", "Rokok", "36.00", today),
    line("n3", "Ah Seng", "Susu, Milo", "39.90", today),
    line("n4", "Kak Lina", "Telur, gula", "22.40", today),
    line("n5", "Encik Hafiz", "Roti x3", "13.50", today, t("scan.unsureAmount", { a: "13.50", b: "18.50" })),
    line("n6", "Uncle Tan", "Sabun", "17.80", today),
    line("n7", "Mr. Raj", "Kopi O", "5.00", today),
    line("n8", "Abang Joe", "Milo 1kg", "12.50", today),
  ];
}

function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when nobody with this name (ignoring case and spacing) is on the ledger yet. */
export function isNewCustomer(name: string, knownNames: string[]): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return !knownNames.some((known) => nameKey(known) === key);
}

/** Customer names on the ledger, A–Z, each once. For the receipt's "who is this for?" picker. */
export function customerNames(debts: Debt[]): string[] {
  const byKey = new Map<string, string>();
  for (const debt of debts) {
    const key = nameKey(debt.customerName);
    if (!byKey.has(key)) byKey.set(key, debt.customerName);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Sum of the ticked lines that have a readable amount, in sen. */
export function includedTotalSen(lines: ScanLine[], today: string): number {
  let total = 0;
  for (const l of lines) {
    if (!l.include) continue;
    const result = validateDebtInput({ customerName: l.customerName || "x", item: l.item, amount: l.amount, date: l.date }, today);
    if (result.ok) total += result.value.amountSen;
  }
  return total;
}

export type LineCheck = { key: string; errors: DebtErrors };

export type ToDebts = { ok: true; debts: Debt[] } | { ok: false; problems: LineCheck[] };

/**
 * Turns the ticked lines into debts (source "scan"), or lists every line that still needs
 * fixing. All or nothing: one bad line means none are made.
 */
export function linesToDebts(
  lines: ScanLine[],
  today: string,
  opts: { newId: () => string; now: Date },
  t: T = translator(),
): ToDebts {
  const debts: Debt[] = [];
  const problems: LineCheck[] = [];
  for (const l of lines) {
    if (!l.include) continue;
    const result = validateDebtInput({ customerName: l.customerName, item: l.item, amount: l.amount, date: l.date }, today, t);
    if (!result.ok) {
      problems.push({ key: l.key, errors: result.errors });
      continue;
    }
    debts.push({ ...createManualDebt(result.value, { id: opts.newId(), now: opts.now }), source: "scan" });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, debts };
}
