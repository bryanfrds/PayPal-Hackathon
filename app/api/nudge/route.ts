// Nudge, the reminder assistant: streams a chat reply through Vercel AI Gateway. It can draft
// reminders (draft_reminder) but sends nothing; the owner sends each one on WhatsApp.
//
// The shop's data comes from the owner's device with each message (the ledger lives there).
// Inputs are size-capped so an open endpoint can't run up a large bill.
// LAUNCH-BLOCKING: like /api/invoices, this has no sign-in yet.

import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, nudgeContextSchema, nudgeSystemPrompt } from "@/lib/nudge";

/** Fast and cheap enough for short drafts; override with AI_GATEWAY_MODEL. */
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

export const maxDuration = 60;

function connected(): boolean {
  // A key locally; on Vercel the project's OIDC token also works.
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

function textLength(message: UIMessage): number {
  return message.parts.reduce((n, part) => n + (part.type === "text" ? part.text.length : 0), 0);
}

export async function POST(req: Request) {
  if (!connected()) {
    return fail(503, "Nudge isn't connected yet. Add an AI Gateway key to .env.local (AI_GATEWAY_API_KEY), then restart.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "That message couldn't be read.");
  }
  const { messages, context } = (body ?? {}) as { messages?: UIMessage[]; context?: unknown };
  const parsed = nudgeContextSchema.safeParse(context);
  if (!Array.isArray(messages) || messages.length === 0 || !parsed.success) {
    return fail(400, "That message couldn't be read.");
  }
  if (messages.length > MAX_MESSAGES) {
    return fail(413, "This chat is long. Start a new one to keep going.");
  }
  const last = messages[messages.length - 1];
  if (last?.role !== "user" || textLength(last) > MAX_MESSAGE_CHARS) {
    return fail(413, `Keep messages under ${MAX_MESSAGE_CHARS} characters.`);
  }

  const shop = parsed.data;
  const slugs = new Set(shop.customers.map((c) => c.slug));

  const result = streamText({
    model: process.env.AI_GATEWAY_MODEL || DEFAULT_MODEL,
    system: nudgeSystemPrompt(shop),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 800,
    stopWhen: isStepCount(4),
    tools: {
      draft_reminder: tool({
        description: "Draft a friendly reminder for one customer. The owner reviews it and sends it on WhatsApp.",
        inputSchema: z.object({
          slug: z.string().describe("The customer's slug from the shop data"),
          message: z.string().max(500).describe("The reminder text, without links"),
        }),
        execute: async ({ slug, message }) => {
          if (!slugs.has(slug)) return { ok: false as const, error: "No customer with that slug in the shop data." };
          const customer = shop.customers.find((c) => c.slug === slug)!;
          return { ok: true as const, slug, name: customer.name, owedSen: customer.owedSen, message };
        },
      }),
    },
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
