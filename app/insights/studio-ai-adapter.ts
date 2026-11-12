// AG Studio's door to the model: each round of Nudge's (or a built-in agent's) loop is POSTed to
// /api/studio-ai, and the streamed reply is handed back to Studio as events plus a finished turn.
// Errors come back as a failed turn with a plain message, which Studio shows in the chat panel.

import type { AgAiEvent, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import { translator, type T, type TKey } from "@/lib/i18n";
import { failedResponse, readWireLines } from "@/lib/studio-ai-wire";

const STATUS_KEY: Record<number, TKey> = {
  401: "nudge.error.signedOut",
  413: "nudge.error.tooLong",
  429: "nudge.error.busy",
  503: "nudge.error.notConnected",
};

/** The server's plain-English error, else one for the status in the owner's language. */
async function errorFor(res: Response, t: T): Promise<string> {
  // Not connected: the server's message is for whoever deploys the app, not the owner.
  if (res.status === 503) return t(STATUS_KEY[503]);
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // not JSON
  }
  return STATUS_KEY[res.status] ? t(STATUS_KEY[res.status]) : t("nudge.error.generic");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** One turn: events as they stream, and the finished turn once the stream ends. */
export function runTurn(
  request: AgLlmRequest,
  options: AgLlmExecuteTurnOptions = {},
  fetchImpl: typeof fetch = fetch,
  t: T = translator(),
): AgLlmResponseHandler {
  let settle: (response: AgLlmResponse) => void = () => {};
  const complete = new Promise<AgLlmResponse>((resolve) => {
    settle = resolve;
  });

  async function* events(): AsyncGenerator<AgAiEvent> {
    let finished: AgLlmResponse | null = null;
    let body: ReadableStream<Uint8Array> | null = null;
    try {
      const res = await fetchImpl("/api/studio-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the request's own fields: the model selection and trace stay in the browser.
        body: JSON.stringify({
          input: request.input,
          instructions: request.instructions,
          tools: request.tools,
          toolChoice: request.toolChoice,
          responseFormat: request.responseFormat,
        }),
        signal: options.signal,
      });
      if (!res.ok || !res.body) {
        finished = failedResponse(`http_${res.status}`, await errorFor(res, t));
        return;
      }
      body = res.body;
      for await (const line of readWireLines(body)) {
        if ("event" in line) yield line.event;
        else finished = line.response;
      }
      finished ??= failedResponse("no_response", t("nudge.error.partWay"));
    } catch (error) {
      finished = options.signal?.aborted || isAbort(error)
        ? failedResponse("cancelled", t("nudge.error.stopped"), "cancelled")
        : failedResponse("network", t("nudge.error.network"));
    } finally {
      // Studio stopped reading part-way (the owner pressed stop): let go of the connection.
      body?.cancel().catch(() => {});
      settle(finished ?? failedResponse("cancelled", t("nudge.error.stopped"), "cancelled"));
    }
  }

  // Studio reads the stream to the end, then awaits `complete`; the request starts on that first read.
  const stream = events();
  return { stream: { [Symbol.asyncIterator]: () => stream }, complete };
}

/** The adapter for Studio, with error words in the owner's language. */
export function studioAiAdapterFor(t: T = translator()): AgLlmAdapter {
  return { executeTurn: (request, options) => runTurn(request, options, fetch, t) };
}

export const studioAiAdapter: AgLlmAdapter = studioAiAdapterFor();
