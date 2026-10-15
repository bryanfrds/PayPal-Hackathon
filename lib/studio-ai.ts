// AG Studio's AI panel, server side: one model turn for Studio's agents (Nudge and Studio's own
// built-in agents). Studio's loop runs in the browser and executes every tool there; this side
// only turns Studio's request into an AI SDK call and the model's stream back into Studio events.
//
// Kept free of Next.js so it can be tested in Node. The route is app/api/studio-ai/route.ts and
// the browser half is app/insights/studio-ai-adapter.ts. The wire format is lib/studio-ai-wire.ts.

import { jsonSchema, tool, type JSONSchema7, type ModelMessage, type Tool, type ToolResultPart } from "ai";
import type { AgAiEvent, AgAiOutputItem, AgAiOutputMessage, AgAiToolCall, AgLlmResponse } from "ag-studio";
import { z } from "zod";
import { wireLine } from "./studio-ai-wire";

/**
 * Largest request body, in characters. Measured on Insights: Studio's widget agent sends the
 * biggest turns, about 53,000 characters (14,000 of instructions, 43,000 of tool schemas).
 */
export const MAX_BODY_CHARS = 400_000;
/** Most conversation items in one turn (messages, tool calls and their results). */
export const MAX_ITEMS = 160;
/** Most text across the whole conversation, in characters: messages, tool arguments and results. */
export const MAX_CONVERSATION_CHARS = 200_000;
/** Longest system instructions, in characters. */
export const MAX_INSTRUCTIONS_CHARS = 40_000;
/** Most tools offered in one turn. */
export const MAX_TOOLS = 30;
/** Most JSON across all tool schemas, in characters. */
export const MAX_TOOL_SCHEMA_CHARS = 120_000;

const text = (max: number) => z.string().max(max);

const inputMessage = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "system"]),
  // Only text: Studio's harness doesn't carry attachments, and nothing else is allowed here.
  content: z.array(z.object({ type: z.literal("text"), text: text(MAX_CONVERSATION_CHARS) })).max(20),
});

const outputMessage = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z
    .array(
      z.union([
        z.object({ type: z.literal("text"), text: text(MAX_CONVERSATION_CHARS) }),
        z.object({ type: z.literal("refusal"), refusal: text(MAX_CONVERSATION_CHARS) }),
      ]),
    )
    .max(20),
});

const toolCall = z.object({
  type: z.literal("function_call"),
  callId: text(200).min(1),
  name: text(64).min(1),
  arguments: text(MAX_CONVERSATION_CHARS),
});

const toolResult = z.object({
  type: z.literal("function_call_output"),
  callId: text(200).min(1),
  output: text(MAX_CONVERSATION_CHARS),
});

// Reasoning isn't sent back to the model, so only its type is checked.
const reasoning = z.object({ type: z.literal("reasoning") });

type InputMessage = z.infer<typeof inputMessage>;
type OutputMessage = z.infer<typeof outputMessage>;
type ToolCallItem = z.infer<typeof toolCall>;
type ToolResultItem = z.infer<typeof toolResult>;
export type CleanItem = InputMessage | OutputMessage | ToolCallItem | ToolResultItem | { type: "reasoning" };

// Tool names as Anthropic and OpenAI accept them.
const toolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: text(4_000),
  parameters: z.record(z.string(), z.unknown()),
  kind: z.enum(["client", "server", "provided"]).optional(),
});

const responseFormat = z.union([
  z.object({ type: z.literal("text") }),
  z.object({
    type: z.literal("json"),
    name: text(64),
    description: text(1_000).optional(),
    schema: z.record(z.string(), z.unknown()),
  }),
]);

const toolChoice = z.union([z.enum(["auto", "none", "required"]), z.object({ name: text(64) })]);

export type StudioToolSchema = z.infer<typeof toolSchema>;
export type StudioToolChoice = z.infer<typeof toolChoice>;

export type StudioRequest = {
  items: CleanItem[];
  instructions?: string;
  tools: StudioToolSchema[];
  toolChoice?: StudioToolChoice;
  responseFormat: z.infer<typeof responseFormat>;
};

export type ParsedRequest = { ok: true; request: StudioRequest } | { ok: false; status: 400 | 413; error: string };

const TOO_LONG = "This conversation is too long for Nudge. Start a new chat and try again.";
const UNREADABLE = "That request couldn't be read.";

function cleanItem(value: unknown): CleanItem | null {
  const type = (value as { type?: unknown } | null)?.type;
  const role = (value as { role?: unknown } | null)?.role;
  const shape =
    type === "message"
      ? role === "assistant"
        ? outputMessage
        : inputMessage
      : type === "function_call"
        ? toolCall
        : type === "function_call_output"
          ? toolResult
          : type === "reasoning"
            ? reasoning
            : null;
  const parsed = shape?.safeParse(value);
  return parsed?.success ? (parsed.data as CleanItem) : null;
}

function itemChars(item: CleanItem): number {
  switch (item.type) {
    case "message":
      return item.content.reduce((sum, part) => sum + ("text" in part ? part.text.length : part.refusal.length), 0);
    case "function_call":
      return item.name.length + item.arguments.length;
    case "function_call_output":
      return item.output.length;
    default:
      return 0;
  }
}

/**
 * Studio's request, checked: the fields of AgLlmRequest, every item's shape, and the size limits
 * across the whole conversation. Too big is 413; anything malformed is 400.
 */
export function parseStudioRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null) return { ok: false, status: 400, error: UNREADABLE };
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.input) || raw.input.length === 0) return { ok: false, status: 400, error: UNREADABLE };
  if (raw.input.length > MAX_ITEMS) return { ok: false, status: 413, error: TOO_LONG };

  if (raw.instructions !== undefined && typeof raw.instructions !== "string") return { ok: false, status: 400, error: UNREADABLE };
  if (typeof raw.instructions === "string" && raw.instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return { ok: false, status: 413, error: "Those instructions are too long for Nudge." };
  }

  const tools = raw.tools ?? [];
  if (!Array.isArray(tools)) return { ok: false, status: 400, error: UNREADABLE };
  if (tools.length > MAX_TOOLS) return { ok: false, status: 413, error: "Too many tools were offered in one go." };
  // Measured before the shape check, so a huge schema is refused for size rather than parsed.
  if (JSON.stringify(tools).length > MAX_TOOL_SCHEMA_CHARS) return { ok: false, status: 413, error: "The tools offered are too big." };
  const parsedTools = z.array(toolSchema).safeParse(tools);
  if (!parsedTools.success) return { ok: false, status: 400, error: UNREADABLE };
  if (new Set(parsedTools.data.map((t) => t.name)).size !== parsedTools.data.length) return { ok: false, status: 400, error: UNREADABLE };

  const format = responseFormat.safeParse(raw.responseFormat ?? { type: "text" });
  if (!format.success) return { ok: false, status: 400, error: UNREADABLE };
  const choice = raw.toolChoice === undefined ? undefined : toolChoice.safeParse(raw.toolChoice);
  if (choice && !choice.success) return { ok: false, status: 400, error: UNREADABLE };

  const items: CleanItem[] = [];
  let total = 0;
  for (const value of raw.input) {
    const item = cleanItem(value);
    if (!item) return { ok: false, status: 400, error: "Nudge can only read text in this chat." };
    total += itemChars(item);
    if (total > MAX_CONVERSATION_CHARS) return { ok: false, status: 413, error: TOO_LONG };
    items.push(item);
  }

  return {
    ok: true,
    request: {
      items,
      instructions: raw.instructions as string | undefined,
      tools: parsedTools.data,
      toolChoice: choice?.data,
      responseFormat: format.data,
    },
  };
}

function parseArguments(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const NO_RESULT = "This tool call has no result (the run was stopped before it finished).";

/**
 * Studio's conversation as AI SDK messages. Studio keeps a flat list of items; the model wants
 * assistant turns (text plus tool calls) each followed by one tool message with every result.
 * System notes join the system prompt. A tool call left without a result gets a placeholder one,
 * because providers refuse a call with no answer; a result with no call is dropped.
 */
export function toModelMessages(items: CleanItem[]): { system: string[]; messages: ModelMessage[] } {
  const system: string[] = [];
  const messages: ModelMessage[] = [];
  const names = new Map<string, string>();
  let assistant: Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string> | null = null;
  let results: ToolResultPart[] | null = null;
  let pending: string[] = [];

  const placeholders = (): ToolResultPart[] =>
    pending.map((id) => ({ type: "tool-result", toolCallId: id, toolName: names.get(id) ?? "unknown", output: { type: "error-text", value: NO_RESULT } }));

  const closeTurn = () => {
    if (assistant && assistant.length > 0) messages.push({ role: "assistant", content: assistant });
    const all = [...(results ?? []), ...placeholders()];
    if (all.length > 0) messages.push({ role: "tool", content: all });
    assistant = null;
    results = null;
    pending = [];
  };

  for (const item of items) {
    switch (item.type) {
      case "message": {
        if (item.role === "assistant") {
          if (results) closeTurn();
          assistant ??= [];
          for (const part of item.content) {
            const value = "text" in part ? part.text : part.refusal;
            if (value) assistant.push({ type: "text", text: value });
          }
          break;
        }
        const value = item.content.map((part) => part.text).join("\n").trim();
        if (!value) break;
        if (item.role === "system") {
          system.push(value);
        } else {
          closeTurn();
          messages.push({ role: "user", content: value });
        }
        break;
      }
      case "function_call": {
        if (results) closeTurn();
        assistant ??= [];
        // A repeated call id would leave the model with two calls and one answer.
        if (names.has(item.callId)) break;
        names.set(item.callId, item.name);
        assistant.push({ type: "tool-call", toolCallId: item.callId, toolName: item.name, input: parseArguments(item.arguments) });
        pending.push(item.callId);
        break;
      }
      case "function_call_output": {
        if (!pending.includes(item.callId)) break;
        if (assistant && assistant.length > 0) messages.push({ role: "assistant", content: assistant });
        assistant = null;
        results ??= [];
        results.push({ type: "tool-result", toolCallId: item.callId, toolName: names.get(item.callId)!, output: { type: "text", value: item.output } });
        pending = pending.filter((id) => id !== item.callId);
        break;
      }
      default:
        // Reasoning isn't replayed.
        break;
    }
  }
  closeTurn();
  return { system, messages };
}

/**
 * Studio's tool schemas as AI SDK tools with no execute: the model can call them, and Studio's
 * loop in the browser runs them. Provider-hosted tools aren't supported and are left out.
 */
export function toToolSet(tools: StudioToolSchema[]): Record<string, Tool> {
  const set: Record<string, Tool> = {};
  for (const t of tools) {
    if (t.kind === "provided") continue;
    set[t.name] = tool({ description: t.description, inputSchema: jsonSchema(t.parameters as JSONSchema7) });
  }
  return set;
}

export function toToolChoice(choice: StudioToolChoice | undefined, toolNames: string[]) {
  if (choice === undefined) return undefined;
  if (typeof choice === "string") return choice;
  return toolNames.includes(choice.name) ? { type: "tool" as const, toolName: choice.name } : "required";
}

/** The system prompt for one turn: Studio's instructions, its system notes and any JSON format asked for. */
export function systemPrompt(request: StudioRequest, notes: string[]): string | undefined {
  const parts = [request.instructions ?? "", ...notes];
  if (request.responseFormat.type === "json") {
    // Studio's own loop always asks for text; this covers an agent of ours that asks for JSON.
    parts.push(
      `Reply with a single JSON value only, no other text, matching this JSON Schema (${request.responseFormat.name}):\n${JSON.stringify(request.responseFormat.schema)}`,
    );
  }
  const joined = parts.filter(Boolean).join("\n\n");
  return joined || undefined;
}

/** The parts of the AI SDK's stream this route reads. Anything else is ignored. */
export type ModelStreamPart =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; text: string }
  | { type: "text-end"; id: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "finish-step"; finishReason: string }
  | { type: "finish"; finishReason: string; totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number } }
  | { type: "error"; error: unknown }
  | { type: "abort" }
  | { type: string };

export const TURN_FAILED = "Nudge couldn't finish that just now. Try again in a moment.";

/**
 * The model's stream as wire lines: an AG Studio event for each piece of text or tool call as it
 * arrives, then one last line with the finished turn (its output items, usage and any error).
 * Text and tool calls carry the same ids in both, which is how Studio matches them up.
 */
export async function* toWireLines(
  parts: AsyncIterable<ModelStreamPart>,
  options: { responseId: string; model?: string; now?: () => number; onError?: (error: unknown) => void },
): AsyncGenerator<string> {
  const now = options.now ?? Date.now;
  const createdAt = now();
  const output: AgAiOutputItem[] = [];
  const texts = new Map<string, AgAiOutputMessage>();
  const openCalls = new Set<string>();
  const seenCalls = new Set<string>();
  let textCount = 0;
  let finishReason: string | undefined;
  let usage: AgLlmResponse["usage"];
  let failed = false;
  let cancelled = false;

  const event = (e: AgAiEvent) => wireLine({ event: e });

  try {
    for await (const part of parts) {
      switch (part.type) {
        case "text-start": {
          const p = part as Extract<ModelStreamPart, { type: "text-start" }>;
          // Providers reuse ids like "0" across turns, so each message gets its own.
          const messageId = `${options.responseId}-text-${textCount++}`;
          const message: AgAiOutputMessage = { id: messageId, kind: "output", type: "message", role: "assistant", status: "in_progress", content: [{ type: "text", text: "", annotations: [] }] };
          texts.set(p.id, message);
          output.push(message);
          yield event({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
          break;
        }
        case "text-delta": {
          const p = part as Extract<ModelStreamPart, { type: "text-delta" }>;
          const message = texts.get(p.id);
          if (!message || !p.text) break;
          const content = message.content[0];
          if (content.type === "text") content.text += p.text;
          yield event({ type: "TEXT_MESSAGE_CONTENT", messageId: message.id, delta: p.text });
          break;
        }
        case "text-end": {
          const p = part as Extract<ModelStreamPart, { type: "text-end" }>;
          const message = texts.get(p.id);
          if (!message || message.status === "completed") break;
          message.status = "completed";
          yield event({ type: "TEXT_MESSAGE_END", messageId: message.id });
          break;
        }
        case "tool-input-start": {
          const p = part as Extract<ModelStreamPart, { type: "tool-input-start" }>;
          if (seenCalls.has(p.id)) break;
          seenCalls.add(p.id);
          openCalls.add(p.id);
          yield event({ type: "TOOL_CALL_START", toolCallId: p.id, toolCallName: p.toolName });
          break;
        }
        case "tool-input-delta": {
          const p = part as Extract<ModelStreamPart, { type: "tool-input-delta" }>;
          if (!openCalls.has(p.id) || !p.delta) break;
          yield event({ type: "TOOL_CALL_ARGS", toolCallId: p.id, delta: p.delta });
          break;
        }
        case "tool-input-end": {
          const p = part as Extract<ModelStreamPart, { type: "tool-input-end" }>;
          if (!openCalls.delete(p.id)) break;
          yield event({ type: "TOOL_CALL_END", toolCallId: p.id });
          break;
        }
        case "tool-call": {
          const p = part as Extract<ModelStreamPart, { type: "tool-call" }>;
          const args = typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? {});
          // Some providers send the whole call at once, with no input stream before it.
          if (!seenCalls.has(p.toolCallId)) {
            seenCalls.add(p.toolCallId);
            yield event({ type: "TOOL_CALL_START", toolCallId: p.toolCallId, toolCallName: p.toolName });
            yield event({ type: "TOOL_CALL_ARGS", toolCallId: p.toolCallId, delta: args });
            yield event({ type: "TOOL_CALL_END", toolCallId: p.toolCallId });
          } else if (openCalls.delete(p.toolCallId)) {
            yield event({ type: "TOOL_CALL_END", toolCallId: p.toolCallId });
          }
          if (output.some((item) => item.type === "function_call" && item.callId === p.toolCallId)) break;
          const call: AgAiToolCall = { id: p.toolCallId, kind: "output", type: "function_call", callId: p.toolCallId, name: p.toolName, arguments: args, status: "completed" };
          output.push(call);
          break;
        }
        case "finish-step": {
          finishReason = (part as Extract<ModelStreamPart, { type: "finish-step" }>).finishReason;
          break;
        }
        case "finish": {
          const p = part as Extract<ModelStreamPart, { type: "finish" }>;
          finishReason = p.finishReason;
          const u = p.totalUsage;
          if (u) {
            usage = {
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              totalTokens: u.totalTokens,
              reasoningTokens: u.reasoningTokens,
              cachedInputTokens: u.cachedInputTokens,
            };
          }
          break;
        }
        case "error": {
          failed = true;
          options.onError?.((part as Extract<ModelStreamPart, { type: "error" }>).error);
          break;
        }
        case "abort":
          cancelled = true;
          break;
        default:
          break;
      }
    }
  } catch (error) {
    failed = true;
    options.onError?.(error);
  }

  // Close anything the stream left open, so the panel doesn't show it as still writing.
  for (const message of texts.values()) {
    if (message.status === "completed") continue;
    message.status = failed || cancelled ? "incomplete" : "completed";
    yield event({ type: "TEXT_MESSAGE_END", messageId: message.id });
  }
  for (const id of openCalls) yield event({ type: "TOOL_CALL_END", toolCallId: id });

  const response: AgLlmResponse = { id: options.responseId, createdAt, output, status: "completed", usage, model: options.model };
  if (failed) {
    response.status = "failed";
    response.error = { code: "model_error", message: TURN_FAILED };
  } else if (cancelled) {
    response.status = "cancelled";
  } else if (finishReason === "length") {
    response.status = "incomplete";
    response.incompleteDetails = { reason: "max_output_tokens" };
  } else if (finishReason === "content-filter") {
    response.status = "incomplete";
    response.incompleteDetails = { reason: "content_filter" };
  }
  yield wireLine({ response });
}
