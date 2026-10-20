import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  beforeEach(() => vi.stubEnv("AI_GATEWAY_API_KEY", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("sends the uploaded image to AI Gateway when configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
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

    const entries = await extractNotebookEntries(dummyBytes, "image/png", opts);

    expect(ai.generateText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: "file", mediaType: "image/png", data: dummyBytes }),
        ]),
      })],
    }));
    expect(entries[0]).toMatchObject({ customerName: "Aisyah", amountSen: 1250 });
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
