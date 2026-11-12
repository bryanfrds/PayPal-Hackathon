import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { parseWireLine, type StudioWireLine } from "@/lib/studio-ai-wire";

vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () => ({ email: "owner@example.com", method: "email", exp: 9999999999 }),
}));

// A fake model that writes one line and asks for draft_reminder. The route must stream both back
// as Studio events and must not run the tool itself (Studio runs it in the browser).
const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
};
const seen: LanguageModelV4CallOptions[] = [];
let chunks: LanguageModelV4StreamPart[] = [];
const fake = new MockLanguageModelV4({
  doStream: async (options) => {
    seen.push(options);
    return { stream: simulateReadableStream({ chunks }) };
  },
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: (opts: Parameters<typeof actual.streamText>[0]) => actual.streamText({ ...opts, model: fake }) };
});

const { POST } = await import("./route");

const DRAFT_TOOL = {
  name: "draft_reminder",
  description: "Draft a friendly reminder",
  parameters: { type: "object", properties: { slug: { type: "string" }, message: { type: "string" } }, required: ["slug", "message"] },
  kind: "client",
};

async function turn(body: unknown): Promise<{ status: number; lines: StudioWireLine[]; type: string | null }> {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test");
  const res = await POST(new Request("http://localhost/api/studio-ai", { method: "POST", headers: { "x-forwarded-for": "10.1.1.1" }, body: JSON.stringify(body) }));
  vi.unstubAllEnvs();
  const text = await res.text();
  return { status: res.status, type: res.headers.get("content-type"), lines: text.split("\n").filter(Boolean).map((l) => parseWireLine(l)!) };
}

describe("POST /api/studio-ai with a model", () => {
  it("streams text and a tool call as Studio events, then the finished turn", async () => {
    chunks = [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Here's a draft for Mak Cik Siti." },
      { type: "text-end", id: "t1" },
      { type: "tool-input-start", id: "c1", toolName: "draft_reminder" },
      { type: "tool-input-delta", id: "c1", delta: '{"slug":"mak-cik-siti","message":"Salam Mak Cik!"}' },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "draft_reminder", input: '{"slug":"mak-cik-siti","message":"Salam Mak Cik!"}' },
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ];
    const { status, type, lines } = await turn({
      input: [
        { id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Remind Siti nicely" }] },
        { id: "c0", kind: "output", type: "function_call", callId: "c0", name: "shop_summary", arguments: "{}", status: "completed" },
        { type: "function_call_output", callId: "c0", output: '{"customers":[]}', status: "completed" },
      ],
      instructions: "You are Nudge.",
      tools: [DRAFT_TOOL],
      toolChoice: "auto",
      responseFormat: { type: "text" },
    });

    expect(status).toBe(200);
    expect(type).toMatch(/application\/x-ndjson/);
    const events = lines.flatMap((l) => ("event" in l ? [l.event.type] : []));
    expect(events).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);

    const last = lines[lines.length - 1];
    if (!("response" in last)) throw new Error("no finished turn");
    expect(last.response.status).toBe("completed");
    expect(last.response.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 });
    expect(last.response.output).toEqual([
      expect.objectContaining({ type: "message", role: "assistant", content: [{ type: "text", text: "Here's a draft for Mak Cik Siti.", annotations: [] }] }),
      expect.objectContaining({ type: "function_call", callId: "c1", name: "draft_reminder", arguments: '{"slug":"mak-cik-siti","message":"Salam Mak Cik!"}' }),
    ]);

    // What the model was given: the system prompt, the conversation with its tool round, the tool.
    const options = seen[seen.length - 1];
    expect(options.prompt[0]).toEqual({ role: "system", content: "You are Nudge." });
    expect(options.prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(options.tools?.map((t) => t.name)).toEqual(["draft_reminder"]);
  });

  it("passes a forced tool choice through", async () => {
    chunks = [{ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }];
    await turn({
      input: [{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Finish up" }] }],
      tools: [DRAFT_TOOL],
      toolChoice: { name: "draft_reminder" },
      responseFormat: { type: "text" },
    });
    expect(seen[seen.length - 1].toolChoice).toEqual({ type: "tool", toolName: "draft_reminder" });
  });

  it("ends with a failed turn and a plain message when the model errors", async () => {
    chunks = [{ type: "error", error: new Error("upstream exploded") }];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, lines } = await turn({
      input: [{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      responseFormat: { type: "text" },
    });
    spy.mockRestore();
    expect(status).toBe(200);
    const last = lines[lines.length - 1];
    expect("response" in last && last.response.status).toBe("failed");
    expect(JSON.stringify(lines)).not.toContain("upstream exploded");
  });
});
