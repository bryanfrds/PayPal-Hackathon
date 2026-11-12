// What Nudge's own tools do when Studio runs them, kept apart from AG Studio's runtime so it can
// be tested in Node. nudge-ai.tsx wraps these as AG Studio tools.

import type { AgAiToolContext, AgAiToolResult } from "ag-studio";
import { formatSen } from "@/lib/debts";
import type { NudgeContext } from "@/lib/nudge";

/** Longest reminder Nudge may draft, in characters (same as the Nudge chat). */
export const MAX_DRAFT_CHARS = 500;

export type DraftData = { slug: string; name: string; owedSen: number; daysLate: number; message: string };

/** The result builders a tool is handed; a test can pass its own. */
export type ToolResults = Pick<AgAiToolContext, "success" | "error">;

/** shop_summary: the device's summary as JSON, with "<" escaped so nothing in a name can break out. */
export function shopSummaryResult(context: NudgeContext, ctx: ToolResults): AgAiToolResult {
  return ctx.success(JSON.stringify(context).replace(/</g, "\\u003c"), { customers: context.customers.length });
}

/** draft_reminder: a draft for a customer in the summary. Nothing is sent. */
export function draftReminderResult(args: { slug: string; message: string }, context: NudgeContext, ctx: ToolResults): AgAiToolResult {
  const customer = context.customers.find((c) => c.slug === args.slug);
  if (!customer) return ctx.error("No customer with that slug in the shop summary. Use a slug from shop_summary.");
  const text = args.message.trim();
  if (!text) return ctx.error("The reminder is empty.");
  if (text.length > MAX_DRAFT_CHARS) return ctx.error(`Keep the reminder under ${MAX_DRAFT_CHARS} characters.`);
  const data: DraftData = { slug: customer.slug, name: customer.name, owedSen: customer.owedSen, daysLate: customer.daysLate, message: text };
  return ctx.success(`Draft ready for ${customer.name} (RM ${formatSen(customer.owedSen)}). Not sent: the owner sends it.`, data);
}
