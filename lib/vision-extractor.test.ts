import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

const ai = vi.hoisted(() => ({ generateText: vi.fn(), object: vi.fn((value) => value) }));
vi.mock("ai", () => ({ generateText: ai.generateText, Output: { object: ai.object } }));
import { extractNotebookEntries, type ExtractionOptions } from "./vision-extractor";

describe("vision-extractor", () => {
  const dummyBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  const opts: ExtractionOptions = {
    scanId: "scan-test-1",
    revision: 1,
    today: "2026-10-18",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends the uploaded image to AI Gateway when configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const fixtureBytes = new Uint8Array(await readFile("test/fixtures/scans/clear-notebook.jpg"));
    ai.generateText.mockResolvedValueOnce({
      output: {
        entries: [{
          customerName: "Aisyah",
          item: "Beras",
          amount: "12.50",
          date: "2026-10-17",
          classification: "debt",
          rawText: "Aisyah Beras 12.50",
          confidence: 0.91,
        }],
      },
    });

    const entries = await extractNotebookEntries(fixtureBytes, "image/jpeg", opts);

    expect(ai.generateText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: "file", mediaType: "image/jpeg", data: fixtureBytes }),
        ]),
      })],
    }));
    expect(entries[0]).toMatchObject({ customerName: "Aisyah", amountSen: 1250 });
    expect(fixtureBytes.byteLength).toBeGreaterThan(1000);
  });

  it("validates ambiguous real fixture output as draft-only review entries", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const fixtureBytes = new Uint8Array(await readFile("test/fixtures/scans/ambiguous-notebook.jpg"));
    ai.generateText.mockResolvedValueOnce({ output: { entries: [
      { customerName: "Pak Ali", item: "Rokok", amount: "18.50", classification: "ambiguous", rawText: "Pak Ali Rokok RM13.50 or RM18.50?", isAmbiguous: true, ambiguityReason: "Amount overwritten", confidence: 0.5 },
      { customerName: "Pak Alif", item: "Beras", amount: "48.50", date: "2026-10-17", classification: "debt", rawText: "Pak Alif Beras RM48.50", confidence: 0.9 },
      { customerName: "Kak Lina", item: "Telur", amount: "22.40", date: "2026-10-16", classification: "crossed_out", rawText: "Kak Lina Telur RM22.40", confidence: 0.9 },
      { customerName: "Ah Seng", item: "Bayar", amount: "10.00", date: "2026-10-18", classification: "repayment", rawText: "Ah Seng BAYAR RM10.00", confidence: 0.9 },
    ] } });

    const entries = await extractNotebookEntries(fixtureBytes, "image/jpeg", opts);
    expect(entries.map((entry) => entry.classification)).toEqual(["ambiguous", "debt", "crossed_out", "repayment"]);
    expect(entries[0]).toMatchObject({ date: opts.today, isAmbiguous: true, included: false });
    expect(entries.slice(2).every((entry) => !entry.included)).toBe(true);
    expect(ai.generateText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ content: expect.arrayContaining([
        expect.objectContaining({ type: "file", mediaType: "image/jpeg", data: fixtureBytes }),
      ]) })],
    }));
  });

  it("extracts clearly legible handwriting lines", async () => {
    const entries = await extractNotebookEntries(dummyBytes, "image/png", {
      ...opts,
      fixtureScenario: "clear_handwriting",
    });

    expect(entries.length).toBeGreaterThan(0);
    const pakAli = entries.find((e) => e.customerName.includes("Pak Ali"));
    expect(pakAli).toBeDefined();
    expect(pakAli?.amountSen).toBe(3600);
    expect(pakAli?.classification).toBe("debt");
    expect(pakAli?.included).toBe(true);
    expect(pakAli?.isAmbiguous).toBe(false);
  });

  it("identifies and flags ambiguous handwriting with ambiguityReason", async () => {
    const entries = await extractNotebookEntries(dummyBytes, "image/png", {
      ...opts,
      fixtureScenario: "ambiguous_handwriting",
    });

    const ambiguousEntry = entries.find((e) => e.isAmbiguous);
    expect(ambiguousEntry).toBeDefined();
    expect(ambiguousEntry?.classification).toBe("ambiguous");
    expect(ambiguousEntry?.included).toBe(false);
    expect(ambiguousEntry?.ambiguityReason).toMatch(/13\.50|18\.50/);
  });

  it("classifies crossed-out debts and excludes them from default approval", async () => {
    const entries = await extractNotebookEntries(dummyBytes, "image/png", {
      ...opts,
      fixtureScenario: "crossed_out_debt",
    });

    const crossed = entries.find((e) => e.classification === "crossed_out");
    expect(crossed).toBeDefined();
    expect(crossed?.included).toBe(false);
    expect(crossed?.rawText).toContain("BATAL");
  });

  it("classifies repayments and partial settlements", async () => {
    const entries = await extractNotebookEntries(dummyBytes, "image/png", {
      ...opts,
      fixtureScenario: "partial_repayment",
    });

    const repayment = entries.find((e) => e.classification === "repayment");
    expect(repayment).toBeDefined();
    expect(repayment?.included).toBe(false);
  });

  it("flags a missing date while defaulting it to the scan date for review", async () => {
    const entries = await extractNotebookEntries(dummyBytes, "image/png", {
      ...opts,
      fixtureScenario: "missing_date",
    });

    expect(entries[0].date).toBe("2026-10-18");
    expect(entries[0].isAmbiguous).toBe(true);
    expect(entries[0].included).toBe(false);
    expect(entries[0].ambiguityReason).toMatch(/date/i);
  });
});
