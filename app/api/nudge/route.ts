// Nudge, the reminder assistant: streams a chat reply from the model in lib/ai-model.ts. It can draft
// reminders (draft_reminder) but sends nothing; the owner sends each one on WhatsApp.
//
// The shop's data comes from the owner's device with each message (the ledger lives there).
// Inputs are size-capped so an open endpoint can't run up a large bill.
// LAUNCH-BLOCKING: like /api/invoices, this has no sign-in yet.

import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";
import { MAX_MESSAGE_CHARS, cleanMessages, nudgeContextSchema, nudgeSystemPrompt } from "@/lib/nudge";
import { requireOwner } from "@/lib/auth-server";
import { aiConnected, aiModel } from "@/lib/ai-model";

export const maxDuration = 60;

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  // Only the signed-in shop owner (proxy.ts checks too).
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  if (!aiConnected(req)) {
    return fail(503, "Nudge isn't connected yet. Add a Gemini key to .env.local (GEMINI_API_KEY), then restart.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "That message couldn't be read.");
  }
  const { messages: raw, context } = (body ?? {}) as { messages?: unknown; context?: unknown };
  const parsed = nudgeContextSchema.safeParse(context);
  if (!parsed.success) return fail(400, "That message couldn't be read.");
  // Every message is checked, not just the newest: roles, part types and sizes.
  const messages = cleanMessages(raw);
  if (!messages) {
    return fail(413, `This chat is too long or has something Nudge can't read. Keep messages under ${MAX_MESSAGE_CHARS} characters, or start a new chat.`);
  }

  const shop = parsed.data;
  const slugs = new Set(shop.customers.map((c) => c.slug));

  const result = streamText({
    model: aiModel("chat"),
    system: nudgeSystemPrompt(shop),
    messages: await convertToModelMessages(messages as UIMessage[], { ignoreIncompleteToolCalls: true }),
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
