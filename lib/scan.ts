// What a scan produces and how the owner's checked lines become debts.
//
// The real reading (photo → lines) is Person 1's vision-model extraction (POST /api/scans);
// entriesToLines() turns its result into check-screen lines. sampleRead() is a fixed, realistic
// result for tests. Extraction only makes drafts: nothing is saved until the owner checks it.

import { createManualDebt, MAX_ITEM_LENGTH, MAX_NAME_LENGTH, validateDebtInput, type Debt, type DebtErrors } from "./debts";
import { translator, type T } from "./i18n";

export const SCAN_MODES = ["notebook", "receipt"] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

/** Where the check screen keeps its unsaved lines (sessionStorage), one draft per scan mode. */
export function scanDraftKey(mode: ScanMode): string {
  return `buku.scan.draft.${mode}.v1`;
}

export function activeScanKey(mode: ScanMode): string {
  return `buku.scan.active.${mode}.v1`;
}

/** Every scan draft key, for a demo reset to clear. */
export const SCAN_DRAFT_KEYS: readonly string[] = SCAN_MODES.flatMap((mode) => [scanDraftKey(mode), activeScanKey(mode)]);

function isScanLines(v: unknown): v is ScanLine[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200) return false;
  const str = (x: unknown) => typeof x === "string";
  return v.every((l) => {
    if (typeof l !== "object" || l === null) return false;
    const r = l as Record<string, unknown>;
    return (
      str(r.key) && str(r.entryId) && str(r.customerName) && str(r.item) && str(r.amount) && str(r.date) &&
      typeof r.include === "boolean" && (r.unsure === undefined || str(r.unsure)) &&
      (r.skipped === undefined || typeof r.skipped === "boolean") &&
      (r.confirmedCustomerId === undefined || str(r.confirmedCustomerId))
    );
  });
}

/**
 * A saved draft read back: the lines, or null when it's missing, unreadable, empty, or not
 * the shape the check screen expects (an old or tampered draft is dropped, not trusted).
 */
export function parseScanDraft(raw: string | null | undefined): ScanLine[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return isScanLines(v) ? v : null;
}

export type ActiveScan = {
  version: 2;
  scanId: string;
  mode: ScanMode;
  serverLines: ScanLine[];
  lines: ScanLine[];
  isDuplicate?: boolean;
  warning?: string;
};

export function parseActiveScan(raw: string | null | undefined): ActiveScan | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 2 ||
    typeof record.scanId !== "string" || !record.scanId ||
    !SCAN_MODES.includes(record.mode as ScanMode) ||
    !isScanLines(record.serverLines) || !isScanLines(record.lines) ||
    (record.isDuplicate !== undefined && typeof record.isDuplicate !== "boolean") ||
    (record.warning !== undefined && typeof record.warning !== "string")
  ) return null;
  return value as ActiveScan;
}

export function unconfirmedIncludedEntryIds(lines: ScanLine[]): string[] {
  return lines.filter((line) => line.include && !line.confirmedCustomerId).map((line) => line.entryId);
}

export type ScanLine = {
  /** Stable UI key; server-backed lines use the entry ID. */
  key: string;
  /** Person 1's server entry identity. */
  entryId: string;
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
  /** The flag is a note, not a doubt (crossed out in the book, or a repayment): nothing to fix. */
  skipped?: boolean;
  confirmedCustomerId?: string;
};

function line(key: string, customerName: string, item: string, amount: string, date: string, unsure?: string): ScanLine {
  return { key, entryId: key, customerName, item, amount, date, include: !unsure, unsure };
}

/**
 * Example reading for tests. A notebook page reads as several customers' lines;
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

/** One line as the AI reader returns it (the fields of Person 1's ExtractedEntry the check screen needs). */
export type ReadEntry = {
  id: string;
  customerName: string;
  item: string;
  amountSen: number;
  rawAmountText: string;
  date: string;
  classification: "debt" | "repayment" | "crossed_out" | "ambiguous";
  isAmbiguous: boolean;
  ambiguityReason?: string;
  included: boolean;
  confirmedCustomerId?: string;
};

/**
 * The AI reader's lines as check-screen lines. Crossed-out lines and repayments come unticked
 * with a flag saying why; unsure lines come unticked with the reader's reason. A receipt reads
 * as one purchase: the debt lines' items and total, with no customer (the owner picks one).
 * An amount the server couldn't turn into money is left blank for the owner to type, never guessed.
 */
export function entriesToLines(entries: ReadEntry[], mode: ScanMode, today: string, t: T = translator()): ScanLine[] {
  const unreadable = (e: ReadEntry) => !(e.amountSen > 0);
  if (mode === "receipt") {
    const bought = entries.filter((e) => e.classification !== "crossed_out" && e.classification !== "repayment");
    if (bought.length === 0) return [];
    const item = bought.map((e) => e.item.trim()).filter(Boolean).join(", ").slice(0, MAX_ITEM_LENGTH);
    const doubt = bought.find((e) => e.isAmbiguous);
    const missing = bought.some(unreadable);
    const unsure = missing ? t("scan.amountUnread") : doubt ? doubt.ambiguityReason || t("scan.unsureLine") : undefined;
    const amount = missing ? "" : (bought.reduce((sum, e) => sum + e.amountSen, 0) / 100).toFixed(2);
    return [{ key: bought[0].id, entryId: bought[0].id, customerName: "", item, amount, date: bought[0].date || today, include: !unsure, unsure }];
  }
  return entries.map((e) => {
    const skipped = e.classification === "crossed_out" || e.classification === "repayment";
    const unsure =
      e.classification === "crossed_out"
        ? t("scan.crossedOut")
        : e.classification === "repayment"
          ? t("scan.repayment")
          : unreadable(e)
            ? t("scan.amountUnread")
            : e.isAmbiguous
              ? e.ambiguityReason || t("scan.unsureLine")
              : undefined;
    return {
      key: e.id,
      entryId: e.id,
      customerName: e.customerName.trim().slice(0, MAX_NAME_LENGTH),
      item: e.item.trim().slice(0, MAX_ITEM_LENGTH),
      amount: unreadable(e) ? "" : (e.amountSen / 100).toFixed(2),
      date: e.date || today,
      include: e.included && !unsure,
      unsure,
      ...(e.confirmedCustomerId ? { confirmedCustomerId: e.confirmedCustomerId } : {}),
      ...(skipped ? { skipped } : {}),
    };
  });
}
