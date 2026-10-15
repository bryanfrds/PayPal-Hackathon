import { describe, expect, it, vi } from "vitest";
import type { AgAiEvent, AgLlmRequest } from "ag-studio";
import { wireLine } from "@/lib/studio-ai-wire";
import { runTurn } from "./studio-ai-adapter";

const REQUEST: AgLlmRequest = {
  input: [{ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "hi" }] }],
  instructions: "Be kind",
  tools: [],
  responseFormat: { type: "text" },
  model: { id: "picked" },
};

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function drain(handler: ReturnType<typeof runTurn>) {
  const events: AgAiEvent[] = [];
  for await (const event of handler.stream) events.push(event);
  return { events, response: await handler.complete };
}

describe("runTurn", () => {
  it("posts the request, streams the events and resolves the finished turn", async () => {
    const body = wireLine({ event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } }) + wireLine({ response: { id: "r", createdAt: 1, status: "completed", output: [] } });
    const fetchImpl = vi.fn(async () => new Response(streamOf(body), { status: 200 }));
    const controller = new AbortController();
    const { events, response } = await drain(runTurn(REQUEST, { signal: controller.signal }, fetchImpl as unknown as typeof fetch));

    expect(events).toEqual([{ type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" }]);
    expect(response).toMatchObject({ id: "r", status: "completed" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/studio-ai");
    expect(init.signal).toBe(controller.signal);
    // The model picker and trace stay in the browser.
    expect(JSON.parse(String(init.body))).not.toHaveProperty("model");
  });

  it("turns a 503 into a failed turn with a plain message for the owner", async () => {
    const fetchImpl = async () => Response.json({ error: "Nudge isn't connected yet." }, { status: 503 });
    const { events, response } = await drain(runTurn(REQUEST, {}, fetchImpl as unknown as typeof fetch));
    expect(events).toEqual([]);
    expect(response).toMatchObject({ status: "failed", error: { code: "http_503" } });
    expect(response.error?.message).toMatch(/rest of Insights still works/);
  });

  it("falls back to its own wording when the server sends no message", async () => {
    const fetchImpl = async () => new Response("rate limited", { status: 429 });
    const { response } = await drain(runTurn(REQUEST, {}, fetchImpl as unknown as typeof fetch));
    expect(response.error?.message).toMatch(/a lot of questions/);
  });

  it("reports a network failure, and a stop, plainly", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await drain(runTurn(REQUEST, {}, offline as unknown as typeof fetch))).response).toMatchObject({ status: "failed", error: { code: "network" } });

    const controller = new AbortController();
    controller.abort();
    const aborted = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    expect((await drain(runTurn(REQUEST, { signal: controller.signal }, aborted as unknown as typeof fetch))).response.status).toBe("cancelled");
  });

  it("fails a stream that ends without a finished turn", async () => {
    const fetchImpl = async () => new Response(streamOf(""), { status: 200 });
    expect((await drain(runTurn(REQUEST, {}, fetchImpl as unknown as typeof fetch))).response).toMatchObject({ status: "failed", error: { code: "no_response" } });
  });

  it("lets go of the connection when Studio stops reading part-way", async () => {
    const cancelled = vi.fn();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(wireLine({ event: { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } })));
        // Never closes: the server is still writing.
      },
      cancel: cancelled,
    });
    const handler = runTurn(REQUEST, {}, (async () => new Response(body, { status: 200 })) as unknown as typeof fetch);
    for await (const _event of handler.stream) break;
    expect(cancelled).toHaveBeenCalled();
    expect((await handler.complete).status).toBe("cancelled");
  });
});
