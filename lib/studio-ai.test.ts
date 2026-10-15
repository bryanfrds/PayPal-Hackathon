import { describe, expect, it } from "vitest";
import {
  MAX_CONVERSATION_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  MAX_ITEMS,
  MAX_TOOLS,
  TURN_FAILED,
  parseStudioRequest,
  systemPrompt,
  toModelMessages,
  toToolChoice,
  toToolSet,
  toWireLines,
  type CleanItem,
  type ModelStreamPart,
} from "./studio-ai";
import { parseWireLine, readWireLines, wireLine, type StudioWireLine } from "./studio-ai-wire";

const user = (text: string) => ({ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const reply = (text: string) => ({ id: "a", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
const call = (callId: string, name: string, args: object) => ({ id: callId, kind: "output", type: "function_call", callId, name, arguments: JSON.stringify(args), status: "completed" });
const result = (callId: string, output: string) => ({ type: "function_call_output", callId, output, status: "completed" });
const TOOL = { name: "draft_reminder", description: "Draft one", parameters: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] }, kind: "client" };

function body(overrides: Record<string, unknown> = {}) {
  return { input: [user("hi")], instructions: "Be kind", tools: [TOOL], responseFormat: { type: "text" }, ...overrides };
}

function items(...raw: unknown[]): CleanItem[] {
  const parsed = parseStudioRequest(body({ input: raw }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.request.items;
}

describe("parseStudioRequest", () => {
  it("accepts a normal turn", () => {
    const parsed = parseStudioRequest(body({ toolChoice: { name: "draft_reminder" } }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.request.tools[0].name).toBe("draft_reminder");
      expect(parsed.request.toolChoice).toEqual({ name: "draft_reminder" });
    }
  });

  it("refuses something that isn't a request", () => {
    expect(parseStudioRequest(null)).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest({ input: [] })).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest({ input: "hi" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses too many items, or too much text across them", () => {
    expect(parseStudioRequest(body({ input: Array.from({ length: MAX_ITEMS + 1 }, () => user("hi")) }))).toMatchObject({ ok: false, status: 413 });
    const half = "x".repeat(MAX_CONVERSATION_CHARS / 2 + 1);
    // Each item is under the limit; together they're over it.
    expect(parseStudioRequest(body({ input: [user(half), reply("ok"), user(half)] }))).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses long instructions, too many tools and huge schemas", () => {
    expect(parseStudioRequest(body({ instructions: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1) }))).toMatchObject({ ok: false, status: 413 });
    const many = Array.from({ length: MAX_TOOLS + 1 }, (_, i) => ({ ...TOOL, name: `t${i}` }));
    expect(parseStudioRequest(body({ tools: many }))).toMatchObject({ ok: false, status: 413 });
    const huge = { ...TOOL, parameters: { type: "object", description: "x".repeat(300_000) } };
    expect(parseStudioRequest(body({ tools: [huge] }))).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses images, unknown items and bad tool names", () => {
    const image = { ...user("hi"), content: [{ type: "image", detail: "auto", imageUrl: "https://example.com/x.png" }] };
    expect(parseStudioRequest(body({ input: [image] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest(body({ input: [{ type: "web_search" }] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest(body({ tools: [{ ...TOOL, name: "has spaces" }] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest(body({ tools: [TOOL, TOOL] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseStudioRequest(body({ responseFormat: { type: "xml" } }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("toModelMessages", () => {
  it("pairs each turn's tool calls with one tool message of results", () => {
    const { messages } = toModelMessages(
      items(user("Who's late?"), reply("Let me check."), call("c1", "shop_summary", {}), call("c2", "view_report", {}), result("c1", "{}"), result("c2", "[]"), reply("Mak Cik Siti.")),
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(messages[1].content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool-call", toolCallId: "c1", toolName: "shop_summary", input: {} },
      { type: "tool-call", toolCallId: "c2", toolName: "view_report", input: {} },
    ]);
    expect(messages[2].content).toEqual([
      { type: "tool-result", toolCallId: "c1", toolName: "shop_summary", output: { type: "text", value: "{}" } },
      { type: "tool-result", toolCallId: "c2", toolName: "view_report", output: { type: "text", value: "[]" } },
    ]);
  });

  it("answers a call left without a result, and drops a result with no call", () => {
    const { messages } = toModelMessages(items(user("hi"), call("c1", "draft_reminder", { slug: "s" }), result("zz", "stray"), user("again")));
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    const tool = messages[2].content as { toolCallId: string; output: { type: string } }[];
    expect(tool).toHaveLength(1);
    expect(tool[0]).toMatchObject({ toolCallId: "c1", output: { type: "error-text" } });
  });

  it("moves system notes into the system prompt and skips empty text", () => {
    const system = { ...user("Context: the page is Insights"), role: "system" };
    const { system: notes, messages } = toModelMessages(items(system, user("  "), user("hi")));
    expect(notes).toEqual(["Context: the page is Insights"]);
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("reads broken tool arguments as an empty object", () => {
    const broken = { ...call("c1", "x", {}), arguments: "{not json" };
    const { messages } = toModelMessages(items(user("hi"), broken, result("c1", "ok")));
    expect((messages[1].content as { input: unknown }[])[0].input).toEqual({});
  });
});

describe("tools and the system prompt", () => {
  it("makes tools with no execute, leaving out provider-hosted ones", () => {
    const set = toToolSet([TOOL as never, { ...TOOL, name: "web", kind: "provided" } as never]);
    expect(Object.keys(set)).toEqual(["draft_reminder"]);
    expect(set.draft_reminder.execute).toBeUndefined();
  });

  it("maps Studio's tool choice", () => {
    expect(toToolChoice(undefined, ["a"])).toBeUndefined();
    expect(toToolChoice("required", ["a"])).toBe("required");
    expect(toToolChoice({ name: "a" }, ["a"])).toEqual({ type: "tool", toolName: "a" });
    expect(toToolChoice({ name: "gone" }, ["a"])).toBe("required");
  });

  it("asks for JSON when Studio asks for a JSON response", () => {
    const parsed = parseStudioRequest(body({ responseFormat: { type: "json", name: "plan", schema: { type: "object" } } }));
    if (!parsed.ok) throw new Error(parsed.error);
    const prompt = systemPrompt(parsed.request, ["note"]);
    expect(prompt).toContain("Be kind");
    expect(prompt).toContain("note");
    expect(prompt).toContain('JSON Schema (plan)');
  });
});

async function* from(parts: ModelStreamPart[]) {
  for (const part of parts) yield part;
}

async function lines(parts: ModelStreamPart[] | AsyncIterable<ModelStreamPart>): Promise<StudioWireLine[]> {
  const out: StudioWireLine[] = [];
  const source = Array.isArray(parts) ? from(parts) : parts;
  for await (const line of toWireLines(source, { responseId: "r1", model: "m", now: () => 5 })) out.push(parseWireLine(line)!);
  return out;
}

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };

describe("toWireLines", () => {
  it("streams text and tool calls as Studio events, then the finished turn", async () => {
    const out = await lines([
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", text: "Drafting " },
      { type: "text-delta", id: "0", text: "now." },
      { type: "text-end", id: "0" },
      { type: "tool-input-start", id: "c1", toolName: "draft_reminder" },
      { type: "tool-input-delta", id: "c1", delta: '{"slug":' },
      { type: "tool-input-delta", id: "c1", delta: '"siti"}' },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "draft_reminder", input: { slug: "siti" } },
      { type: "finish", finishReason: "tool-calls", totalUsage: usage },
    ]);
    const events = out.filter((l) => "event" in l).map((l) => ("event" in l ? l.event : null));
    expect(events).toEqual([
      { type: "TEXT_MESSAGE_START", messageId: "r1-text-0", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1-text-0", delta: "Drafting " },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "r1-text-0", delta: "now." },
      { type: "TEXT_MESSAGE_END", messageId: "r1-text-0" },
      { type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "draft_reminder" },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"slug":' },
      { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '"siti"}' },
      { type: "TOOL_CALL_END", toolCallId: "c1" },
    ]);
    const last = out[out.length - 1];
    expect("response" in last && last.response).toEqual({
      id: "r1",
      createdAt: 5,
      status: "completed",
      model: "m",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, reasoningTokens: undefined, cachedInputTokens: undefined },
      output: [
        { id: "r1-text-0", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Drafting now.", annotations: [] }] },
        { id: "c1", kind: "output", type: "function_call", callId: "c1", name: "draft_reminder", arguments: '{"slug":"siti"}', status: "completed" },
      ],
    });
  });

  it("emits a whole tool call that arrives without an input stream", async () => {
    const out = await lines([
      { type: "tool-call", toolCallId: "c9", toolName: "shop_summary", input: {} },
      { type: "finish", finishReason: "tool-calls" },
    ]);
    expect(out.slice(0, 3).map((l) => ("event" in l ? l.event.type : ""))).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
  });

  it("gives each text message its own id even when the provider reuses one", async () => {
    const out = await lines([
      { type: "text-start", id: "0" },
      { type: "text-end", id: "0" },
      { type: "text-start", id: "0" },
      { type: "text-end", id: "0" },
    ]);
    const starts = out.flatMap((l) => ("event" in l && l.event.type === "TEXT_MESSAGE_START" ? [l.event.messageId] : []));
    expect(starts).toEqual(["r1-text-0", "r1-text-1"]);
  });

  it("reports a model error as a failed turn with a plain message, closing open text", async () => {
    const out = await lines([
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", text: "Hal" },
      { type: "error", error: new Error("gateway said no: key sk-123") },
    ]);
    expect(out.map((l) => ("event" in l ? l.event.type : "response"))).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "response"]);
    const last = out[out.length - 1];
    expect("response" in last && last.response.status).toBe("failed");
    expect("response" in last && last.response.error).toEqual({ code: "model_error", message: TURN_FAILED });
    // The provider's own error text never reaches the browser.
    expect(JSON.stringify(out)).not.toContain("sk-123");
  });

  it("reports a stream that throws as a failed turn", async () => {
    async function* broken(): AsyncGenerator<ModelStreamPart> {
      yield { type: "text-start", id: "0" };
      throw new Error("socket closed");
    }
    const out = await lines(broken());
    const last = out[out.length - 1];
    expect("response" in last && last.response.status).toBe("failed");
  });

  it("marks a turn cut off by the token limit as incomplete", async () => {
    const out = await lines([{ type: "finish", finishReason: "length" }]);
    const last = out[out.length - 1];
    expect("response" in last && last.response).toMatchObject({ status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } });
  });

  it("marks an aborted turn as cancelled", async () => {
    const out = await lines([{ type: "abort" }]);
    const last = out[out.length - 1];
    expect("response" in last && last.response.status).toBe("cancelled");
  });
});

describe("the wire format", () => {
  function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  it("reads lines split across chunks, skipping anything that isn't ours", async () => {
    const event = wireLine({ event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } });
    const done = wireLine({ response: { id: "r", createdAt: 1, status: "completed", output: [] } });
    const joined = `${event}not json\n{"other":1}\n${done}`;
    const read: StudioWireLine[] = [];
    for await (const line of readWireLines(streamOf([joined.slice(0, 7), joined.slice(7, 40), joined.slice(40)]))) read.push(line);
    expect(read).toHaveLength(2);
    expect("event" in read[0] && read[0].event.type).toBe("TEXT_MESSAGE_START");
    expect("response" in read[1] && read[1].response.id).toBe("r");
  });

  it("reads a last line with no newline", async () => {
    const done = wireLine({ response: { id: "r", createdAt: 1, status: "completed", output: [] } }).trim();
    const read: StudioWireLine[] = [];
    for await (const line of readWireLines(streamOf([done]))) read.push(line);
    expect(read).toHaveLength(1);
  });
});
