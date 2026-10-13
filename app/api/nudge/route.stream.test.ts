import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

// A fake model: first it calls draft_reminder, then it says one line. Exercises the route,
// the tool and the streamed response without a key or any network.
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
let call = 0;
const fake = new MockLanguageModelV4({
  doStream: async () => {
    call += 1;
    const chunks: LanguageModelV4StreamPart[] =
      call === 1
        ? [
            {
              type: "tool-call" as const,
              toolCallId: "c1",
              toolName: "draft_reminder",
              input: JSON.stringify({ slug: "mak-cik-siti", message: "Salam Mak Cik! A gentle reminder about RM 48.50." }),
            },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
          ]
        : [
            { type: "text-start" as const, id: "t1" },
            { type: "text-delta" as const, id: "t1", delta: "Here's a draft for Mak Cik Siti." },
            { type: "text-end" as const, id: "t1" },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
          ];
    return { stream: simulateReadableStream({ chunks }) };
  },
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: (opts: Parameters<typeof actual.streamText>[0]) => actual.streamText({ ...opts, model: fake }) };
});

const { POST } = await import("./route");

const CONTEXT = {
  shopName: "Kedai Ah Seng",
  today: "2026-10-13",
  owedSen: 4850,
  collectedSen: 0,
  customers: [
    { slug: "mak-cik-siti", name: "Mak Cik Siti", owedSen: 4850, daysLate: 33, status: "Overdue", remindersSent: 0, items: ["Beras 10kg"] },
  ],
};

describe("POST /api/nudge with a model", () => {
  it("streams the drafted reminder and the reply", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const res = await POST(
      new Request("http://localhost/api/nudge", {
        method: "POST",
        body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Who should I remind?" }] }], context: CONTEXT }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"type":"tool-output-available"');
    expect(body).toContain('"name":"Mak Cik Siti"');
    expect(body).toContain("Salam Mak Cik! A gentle reminder about RM 48.50.");
    expect(body).toContain("Here's a draft for Mak Cik Siti.");
    vi.unstubAllEnvs();
  });
});
