// One model turn for AG Studio's AI panel on Insights: Nudge and Studio's built-in agents all run
// their loop in the browser and call this for each round. It streams back newline-delimited JSON
// (see lib/studio-ai-wire.ts): Studio events as text and tool calls arrive, then the finished turn.
//
// Tools are never run here. The model only asks for them; Studio runs them on the page (changing
// the dashboard, drafting a reminder) and sends the results with the next turn. Nothing is sent
// to customers from here or from the browser.
//
// Owner-only, throttled per IP, and every part of the request is size-capped so an open endpoint
// can't run up a large bill.

import { streamText, type ToolSet } from "ai";
import { requireOwner } from "@/lib/auth-server";
import { MAX_BODY_CHARS, TURNS_PER_DAY, TURNS_PER_MINUTE, parseStudioRequest, systemPrompt, toModelMessages, toToolChoice, toToolSet, toWireLines, type ModelStreamPart } from "@/lib/studio-ai";
import { clientIp, createThrottle } from "@/lib/throttle";

/** Same model as /api/nudge; override with AI_GATEWAY_MODEL. */
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
/**
 * Room for one turn. The biggest output is a widget configuration or a plan, written as tool
 * arguments by Studio's agents; Nudge's own replies and drafts are far shorter.
 */
const MAX_OUTPUT_TOKENS = 2_500;

export const maxDuration = 60;

// One question to Nudge can take a dozen or more turns (Nudge, then Studio's agents), so the
// brakes count turns. Per IP and per signed-in email, since the demo login is shared by many
// people; plus a daily cap per email, the real limit on what one login can spend. All per
// server instance (see lib/throttle.ts).
const perIp = createThrottle(TURNS_PER_MINUTE, 60_000);
const perEmail = createThrottle(TURNS_PER_MINUTE, 60_000);
const perEmailDaily = createThrottle(TURNS_PER_DAY, 24 * 60 * 60_000);

function connected(req: Request): boolean {
  // A key locally. On Vercel the project's OIDC token also works (see /api/nudge).
  return Boolean(process.env.AI_GATEWAY_API_KEY || req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN);
}

function fail(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

export async function POST(req: Request) {
  // Only the signed-in shop owner (proxy.ts checks too).
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const email = owner.email.toLowerCase();
  const wait = perIp.hit(clientIp(req)) || perEmail.hit(email);
  if (wait > 0) {
    return fail(429, "Nudge is getting a lot of questions. Wait a moment and try again.", { "Retry-After": String(wait) });
  }

  if (!connected(req)) {
    return fail(503, "Nudge isn't connected yet. Add an AI Gateway key to .env.local (AI_GATEWAY_API_KEY), then restart.");
  }

  // Checked before reading, then again after, since the header can be missing or wrong.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_CHARS * 4) return fail(413, "This conversation is too long for Nudge. Start a new chat and try again.");
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return fail(400, "That request couldn't be read.");
  }
  if (raw.length > MAX_BODY_CHARS) return fail(413, "This conversation is too long for Nudge. Start a new chat and try again.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That request couldn't be read.");
  }

  const parsed = parseStudioRequest(body);
  if (!parsed.ok) return fail(parsed.status, parsed.error);
  const request = parsed.request;

  const { system, messages } = toModelMessages(request.items);
  if (!messages.some((m) => m.role === "user")) return fail(400, "That request couldn't be read.");

  // Counted only for turns that reach the model.
  const dailyWait = perEmailDaily.hit(email);
  if (dailyWait > 0) {
    return fail(429, "Nudge has answered a lot of questions today. Try again tomorrow.", { "Retry-After": String(dailyWait) });
  }
  const tools = toToolSet(request.tools);
  const model = process.env.AI_GATEWAY_MODEL || DEFAULT_MODEL;

  const result = streamText({
    model,
    system: systemPrompt(request, system),
    messages,
    tools: tools as ToolSet,
    toolChoice: toToolChoice(request.toolChoice, Object.keys(tools)),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // The browser closing the request (the owner pressed stop) ends the model call too.
    abortSignal: req.signal,
  });

  const lines = toWireLines(result.stream as AsyncIterable<ModelStreamPart>, {
    responseId: `turn-${crypto.randomUUID()}`,
    model,
    onError: (error) => console.error("studio-ai turn failed", error),
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await lines.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await lines.return(undefined);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
