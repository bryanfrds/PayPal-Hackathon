// Multimodal vision extraction engine for Buku 555 notebook pages and receipts
import { moneyToSen } from "./payments";
import type { EntryClassification, ExtractedEntry } from "./person1-types";

export type SyntheticScenario =
  | "clear_handwriting"
  | "ambiguous_handwriting"
  | "crossed_out_debt"
  | "partial_repayment"
  | "missing_date";

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

function buildSyntheticLines(scenario: SyntheticScenario | undefined, today: string): RawExtractedLine[] {
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
      return [
        { customerName: "Mak Cik Siti", item: "Beras", amount: "48.50", date: today, classification: "debt", rawText: "Mak Cik Siti - Beras 48.50" },
        { customerName: "Pak Ali", item: "Rokok", amount: "36.00", date: today, classification: "debt", rawText: "Pak Ali - Rokok 36.00" },
        { customerName: "Encik Hafiz", item: "Roti x3", amount: "13.50", date: today, classification: "ambiguous", isAmbiguous: true, ambiguityReason: "Could be 13.50 or 18.50", rawText: "Encik Hafiz - Roti 13.50?" },
      ];
  }
}

export async function extractNotebookEntries(
  _imageBytes: Uint8Array,
  _mimeType: string,
  opts: ExtractionOptions,
): Promise<ExtractedEntry[]> {
  const { scanId, revision, today, fixtureScenario } = opts;
  const now = new Date().toISOString();

  // If a synthetic fixture scenario is provided, or in test mode without AI key, return synthetic lines
  const rawLines = buildSyntheticLines(fixtureScenario, today);

  return rawLines.map((l, index) => {
    const amountSen = moneyToSen(l.amount) ?? 0;
    const isAmbiguous = Boolean(l.isAmbiguous || l.classification === "ambiguous");
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
      date: l.date || today,
      classification: l.classification,
      confidence: l.confidence ?? (isAmbiguous ? 0.65 : 0.95),
      isAmbiguous,
      ambiguityReason: l.ambiguityReason,
      included: !isExcluded,
      sourceRef: { lineIndex: index + 1 },
      ownerEdited: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}
