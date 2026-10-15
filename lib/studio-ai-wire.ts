// The wire format between /api/studio-ai and the browser: one JSON object per line. Every line
// but the last carries one AG Studio event (text or tool-call progress); the last carries the
// finished turn. Kept free of server and AI SDK imports so the browser can use it too.

import type { AgAiEvent, AgLlmResponse } from "ag-studio";

export type StudioWireLine = { event: AgAiEvent } | { response: AgLlmResponse };

/** One line of the stream, ending in a newline. */
export function wireLine(line: StudioWireLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** Reads a line, or null if it isn't one of ours. */
export function parseWireLine(text: string): StudioWireLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const line = value as Record<string, unknown>;
  if (isObject(line.event) && typeof line.event.type === "string") return { event: line.event as unknown as AgAiEvent };
  if (isObject(line.response) && Array.isArray(line.response.output) && typeof line.response.status === "string") {
    return { response: line.response as unknown as AgLlmResponse };
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Splits a byte stream into wire lines as they arrive. Lines that aren't ours are skipped. */
export async function* readWireLines(body: ReadableStream<Uint8Array>): AsyncGenerator<StudioWireLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end = buffered.indexOf("\n");
      while (end !== -1) {
        const text = buffered.slice(0, end).trim();
        buffered = buffered.slice(end + 1);
        const line = text ? parseWireLine(text) : null;
        if (line) yield line;
        end = buffered.indexOf("\n");
      }
      if (done) break;
    }
    const rest = buffered.trim() ? parseWireLine(buffered.trim()) : null;
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/** A finished turn that failed, with a plain message for the chat panel. */
export function failedResponse(code: string, message: string, status: AgLlmResponse["status"] = "failed"): AgLlmResponse {
  return { id: `failed-${Date.now()}`, createdAt: Date.now(), status, output: [], error: { code, message } };
}
