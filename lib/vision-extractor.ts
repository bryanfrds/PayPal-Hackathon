// Multimodal vision extraction engine for Buku 555 notebook pages and receipts
import { generateText, Output } from "ai";
import { z } from "zod";
import { moneyToSen } from "./payments";
import type { EntryClassification, ExtractedEntry } from "./person1-types";
import { aiConnected, aiModel } from "./ai-model";

export const SYNTHETIC_SCENARIOS = [
  "clear_handwriting",
  "ambiguous_handwriting",
  "crossed_out_debt",
  "partial_repayment",
  "missing_date",
] as const;

export type SyntheticScenario = (typeof SYNTHETIC_SCENARIOS)[number];

export function isSyntheticScenario(value: unknown): value is SyntheticScenario {
  return typeof value === "string" && (SYNTHETIC_SCENARIOS as readonly string[]).includes(value);
}

export function areScanFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ALLOW_SCAN_FIXTURES === "true") return true;
  if (env.ALLOW_SCAN_FIXTURES === "false") return false;
  return env.NODE_ENV !== "production";
}

export function resolveFixtureScenario(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): { scenario?: SyntheticScenario; error?: string } {
  if (raw === undefined || raw === null || raw === "") {
    return {};
  }
  if (!areScanFixturesEnabled(env)) {
    return { error: "Scan fixtures are disabled in this environment." };
  }
  if (!isSyntheticScenario(raw)) {
    return { error: "Unknown scan fixture scenario." };
  }
  return { scenario: raw };
}

export type ExtractionOptions = {
  scanId: string;
  revision: number;
  today: string;
  fixtureScenario?: SyntheticScenario;
};

type RawExtractedLine = {
  customerName: string;
  item: string;
  amount: string;
  date?: string;
  classification: EntryClassification;
  rawText: string;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
  confidence?: number;
};

const visionResultSchema = z.object({
  entries: z.array(z.object({
    customerName: z.string().max(120),
    item: z.string().max(500),
    amount: z.string().max(32),
    date: z.string().max(10).optional(),
    classification: z.enum(["debt", "repayment", "crossed_out", "ambiguous"]),
    rawText: z.string().max(1000),
    isAmbiguous: z.boolean().optional(),
    ambiguityReason: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })),
});

/** Most lines kept from one photo. Capped after reading: Gemini rejects maxItems on a list this detailed. */
const MAX_LINES = 100;

async function extractWithGateway(imageBytes: Uint8Array, mimeType: string, today: string): Promise<RawExtractedLine[]> {
  const result = await generateText({
    model: aiModel("vision"),
    system: "Extract handwritten shop debt entries accurately. Never guess unclear values; mark them ambiguous. Preserve crossed-out entries and repayments for human review.",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Read this notebook image. Return each line with customer, item, amount, optional YYYY-MM-DD date, classification, raw text, confidence, and ambiguity details. Write the amount as a plain number with no currency, e.g. 18.50 for "RM 18.50". Dates are written day/month, as in Malaysia: 9/11 means 9 November. Today is ${today}: a date written without a year is the most recent such date on or before today.` },
        { type: "file", mediaType: mimeType, data: imageBytes },
      ],
    }],
    output: Output.object({ schema: visionResultSchema, name: "notebook_entries" }),
    maxOutputTokens: 3000,
  });
  return result.output.entries.slice(0, MAX_LINES);
}

/** A real calendar day in YYYY-MM-DD (2026-02-29 and 2026-04-31 are not). */
function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** A date at the start of a notebook line, written day/month with an optional year: 9/11, 9.11.26, 9-11-2026. */
const LEADING_DATE = /^\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?=\s|$)/;

/** True when a line's text shows a written year: a full leading date, or a 4-digit year on its own. */
export function showsYear(rawText: string): boolean {
  const m = rawText.match(LEADING_DATE);
  return Boolean(m?.[3]) || /(^|\s)(19|20)\d{2}(\s|$)/.test(rawText);
}

/**
 * The date for one notebook line. The model sometimes swaps day and month or picks the wrong year
 * (a live scan of "9/11" came back as 2025-09-11), so a date written at the start of the line wins:
 * day/month as in Malaysia, with its year if written. Without a written year, the date is the most
 * recent such day on or before today, unless the page shows a year somewhere (pageHasYear), when
 * the model's own date is kept.
 */
export function fitDate(modelDate: string, today: string, rawText = "", pageHasYear = false): string {
  if (!isRealDay(today)) return modelDate;
  const m = rawText.match(LEADING_DATE);
  if (m?.[3]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const written = `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
    return isRealDay(written) ? written : modelDate;
  }
  if ((pageHasYear || showsYear(rawText)) && isRealDay(modelDate)) return modelDate;
  const md = m ? `${pad2(Number(m[2]))}-${pad2(Number(m[1]))}` : isRealDay(modelDate) ? modelDate.slice(5) : null;
  if (!md) return modelDate;
  const year = Number(today.slice(0, 4));
  for (let y = year; y >= year - 4; y--) {
    const candidate = `${y}-${md}`;
    if (candidate <= today && isRealDay(candidate)) return candidate;
  }
  return modelDate;
}

function buildSyntheticLines(scenario: SyntheticScenario, today: string): RawExtractedLine[] {
  switch (scenario) {
    case "clear_handwriting":
      return [
        { customerName: "Pak Ali (Bengkel)", item: "Rokok", amount: "36.00", date: today, classification: "debt", rawText: "Pak Ali (Bengkel) - Rokok RM36.00" },
        { customerName: "Mak Cik Siti", item: "Beras 10kg", amount: "48.50", date: today, classification: "debt", rawText: "Mak Cik Siti - Beras RM48.50" },
        { customerName: "Ah Seng", item: "Susu, Milo", amount: "39.90", date: today, classification: "debt", rawText: "Ah Seng - Susu, Milo RM39.90" },
      ];
    case "ambiguous_handwriting":
      return [
        { customerName: "Encik Hafiz", item: "Roti x3", amount: "13.50", date: today, classification: "ambiguous", isAmbiguous: true, ambiguityReason: "Amount could be 13.50 or 18.50 due to folded paper", rawText: "Encik Hafiz - Roti x3 RM1?.50" },
        { customerName: "Kak Lina", item: "Gula, Telur", amount: "22.40", date: today, classification: "debt", rawText: "Kak Lina - Gula, Telur RM22.40" },
      ];
    case "crossed_out_debt":
      return [
        { customerName: "Uncle Tan", item: "Sabun", amount: "17.80", date: today, classification: "crossed_out", rawText: "[BATAL] Uncle Tan - Sabun RM17.80" },
        { customerName: "Mr. Raj", item: "Kopi O", amount: "5.00", date: today, classification: "debt", rawText: "Mr. Raj - Kopi O RM5.00" },
      ];
    case "partial_repayment":
      return [
        { customerName: "Abang Joe", item: "Bayar sebahagian (tunai)", amount: "20.00", date: today, classification: "repayment", rawText: "Abang Joe - Bayar balik RM20.00 cash" },
        { customerName: "Abang Joe", item: "Baki Milo 1kg", amount: "12.50", date: today, classification: "debt", rawText: "Abang Joe - Milo 1kg RM12.50" },
      ];
    case "missing_date":
      return [
        { customerName: "Kak Nab", item: "Minyak masak", amount: "15.00", classification: "debt", rawText: "Kak Nab - Minyak RM15.00" },
      ];
    default:
      throw new Error("Unknown scan fixture scenario.");
  }
}

export async function extractNotebookEntries(
  imageBytes: Uint8Array,
  mimeType: string,
  opts: ExtractionOptions,
): Promise<ExtractedEntry[]> {
  const { scanId, revision, today, fixtureScenario } = opts;
  const now = new Date().toISOString();

  const connected = aiConnected();
  let rawLines: RawExtractedLine[];
  if (fixtureScenario !== undefined) {
    const resolved = resolveFixtureScenario(fixtureScenario);
    if (resolved.error || !resolved.scenario) {
      throw new Error(resolved.error || "Unknown scan fixture scenario.");
    }
    rawLines = buildSyntheticLines(resolved.scenario, today);
  } else if (!connected) {
    throw new Error("AI document scanning is not configured. Missing GEMINI_API_KEY.");
  } else {
    rawLines = await extractWithGateway(imageBytes, mimeType, today);
  }

  const pageHasYear = rawLines.some((l) => showsYear(l.rawText));
  return rawLines.map((l, index) => {
    const amountSen = moneyToSen(l.amount) ?? 0;
    const missingDate = !l.date;
    const isAmbiguous = Boolean(l.isAmbiguous || l.classification === "ambiguous" || missingDate);
    const isExcluded = l.classification === "crossed_out" || l.classification === "repayment" || isAmbiguous;

    return {
      id: `${scanId}-r${revision}-e${index + 1}`,
      scanId,
      revision,
      rawText: l.rawText,
      customerName: l.customerName,
      item: l.item,
      amountSen,
      rawAmountText: l.amount,
      date: l.date ? fitDate(l.date, today, l.rawText, pageHasYear) : today,
      classification: l.classification,
      confidence: l.confidence ?? (isAmbiguous ? 0.65 : 0.95),
      isAmbiguous,
      ambiguityReason: l.ambiguityReason || (missingDate ? "Date is missing; scan date used pending owner review." : undefined),
      included: !isExcluded,
      sourceRef: { lineIndex: index + 1 },
      ownerEdited: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}
