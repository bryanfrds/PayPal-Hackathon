import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateText: vi.fn(), object: vi.fn((value) => value) }));
vi.mock("ai", () => ({ generateText: ai.generateText, Output: { object: ai.object } }));
import { extractNotebookEntries, fitDate, showsYear, type ExtractionOptions } from "./vision-extractor";

describe("fitDate", () => {
  const today = "2026-11-08";
  it("reads a leading day/month and picks the most recent such day", () => {
    expect(fitDate("2025-11-08", today, "8/11 Kak Ros gula 12.80")).toBe("2026-11-08");
    expect(fitDate("2025-09-11", today, "9/11 Abang Din roti 9.50")).toBe("2025-11-09");
    expect(fitDate("2026-07-11", "2026-11-10", "9/11 Abang Din roti 9.50")).toBe("2026-11-09");
    expect(fitDate("2026-12-01", today, "1/12 X 5.00")).toBe("2025-12-01");
  });
  it("keeps a written year", () => {
    expect(fitDate("2024-03-05", today, "5/3/2024 Ali 10.00")).toBe("2024-03-05");
    expect(fitDate("2020-01-01", today, "10.11.20 Ali 10.00")).toBe("2020-11-10");
    expect(fitDate("2024-03-05", today, "Ali 2024 10.00")).toBe("2024-03-05");
  });
  it("keeps the model's date when the page shows a year", () => {
    expect(fitDate("2025-03-01", today, "Ali roti 5.00", true)).toBe("2025-03-01");
  });
  it("never makes an impossible date", () => {
    expect(fitDate("2024-02-29", today, "29/2 Ali 5.00")).toBe("2024-02-29");
    expect(fitDate("2024-02-29", today, "Ali 5.00")).toBe("2024-02-29");
    expect(fitDate("2026-04-31", today, "31/4 Ali 5.00")).toBe("2026-04-31");
    expect(fitDate("soon", today)).toBe("soon");
  });
  it("does not take a date joined to an amount as a year", () => {
    expect(showsYear("8/11-12.80 Ali")).toBe(false);
    expect(showsYear("Ali RM 12.80")).toBe(false);
  });
});

describe("vision-extractor", () => {
  const dummyBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  const opts: ExtractionOptions = {
    scanId: "scan-test-1",
    revision: 1,
    today: "2026-10-18",
  };

  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
  });
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

  it("keeps at most 100 lines from one photo", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const line = (i: number) => ({ customerName: `C${i}`, item: "Beras", amount: "1.00", date: "2026-10-17", classification: "debt", rawText: `C${i} 1.00` });
    ai.generateText.mockResolvedValueOnce({ output: { entries: Array.from({ length: 101 }, (_, i) => line(i)) } });

    const entries = await extractNotebookEntries(dummyBytes, "image/png", opts);

    expect(entries).toHaveLength(100);
    expect(entries[99].customerName).toBe("C99");
  });

  it("tells the model today's date and to write amounts as plain numbers", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    ai.generateText.mockResolvedValueOnce({ output: { entries: [] } });

    await extractNotebookEntries(dummyBytes, "image/png", opts);

    const call = ai.generateText.mock.calls.at(-1)![0];
    const text = call.messages[0].content.find((p: { type: string }) => p.type === "text").text as string;
    expect(text).toContain("Today is 2026-10-18");
    expect(text).toContain("plain number");
    expect(text).toContain("day/month");
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
