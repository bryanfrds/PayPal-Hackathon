// AG Studio's door to the model: each round of Nudge's (or a built-in agent's) loop is POSTed to
// /api/studio-ai, and the streamed reply is handed back to Studio as events plus a finished turn.
// Errors come back as a failed turn with a plain message, which Studio shows in the chat panel.

import type { AgAiEvent, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import { failedResponse, readWireLines } from "@/lib/studio-ai-wire";

const STATUS_TEXT: Record<number, string> = {
  401: "You've been signed out. Sign in again to use Nudge.",
  413: "This conversation is too long for Nudge. Start a new chat and try again.",
  429: "Nudge is getting a lot of questions. Wait a moment and try again.",
  503: "Nudge isn't connected yet, so it can't answer here. The rest of Insights still works.",
};

/** The server's plain-English error, else one for the status. */
async function errorFor(res: Response): Promise<string> {
  // Not connected: the server's message is for whoever deploys the app, not the owner.
  if (res.status === 503) return STATUS_TEXT[503];
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // not JSON
  }
  return STATUS_TEXT[res.status] ?? "Nudge couldn't answer just now. Try again in a moment.";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** One turn: events as they stream, and the finished turn once the stream ends. */
export function runTurn(request: AgLlmRequest, options: AgLlmExecuteTurnOptions = {}, fetchImpl: typeof fetch = fetch): AgLlmResponseHandler {
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
        finished = failedResponse(`http_${res.status}`, await errorFor(res));
        return;
      }
      body = res.body;
      for await (const line of readWireLines(body)) {
        if ("event" in line) yield line.event;
        else finished = line.response;
      }
      finished ??= failedResponse("no_response", "Nudge stopped part-way. Try again in a moment.");
    } catch (error) {
      finished = options.signal?.aborted || isAbort(error)
        ? failedResponse("cancelled", "Stopped.", "cancelled")
        : failedResponse("network", "Nudge couldn't be reached. Check your connection and try again.");
    } finally {
      // Studio stopped reading part-way (the owner pressed stop): let go of the connection.
      body?.cancel().catch(() => {});
      settle(finished ?? failedResponse("cancelled", "Stopped.", "cancelled"));
    }
  }

  // Studio reads the stream to the end, then awaits `complete`; the request starts on that first read.
  const stream = events();
  return { stream: { [Symbol.asyncIterator]: () => stream }, complete };
}

export const studioAiAdapter: AgLlmAdapter = {
  executeTurn: (request, options) => runTurn(request, options),
};
