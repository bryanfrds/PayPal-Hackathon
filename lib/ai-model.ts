// Which AI model the app talks to: Nudge, Studio's AI panel on Insights, and notebook scans.
//
// With GEMINI_API_KEY set, everything goes straight to Google Gemini (free key from
// https://aistudio.google.com/apikey, no card needed). Otherwise it goes through Vercel AI
// Gateway as before (AI_GATEWAY_API_KEY locally, or the project's OIDC token on Vercel).

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/** Gateway default when no Gemini key is set; override with AI_GATEWAY_MODEL. */
export const DEFAULT_GATEWAY_MODEL = "anthropic/claude-haiku-5.5";
/** Gemini default; override with GEMINI_MODEL (and GEMINI_VISION_MODEL for scans). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

type Env = Record<string, string | undefined>;

function geminiKey(env: Env): string | undefined {
  return env.GEMINI_API_KEY?.trim() || undefined;
}

/** True when a model can be reached: a Gemini key, a gateway key, or Vercel's OIDC token. */
export function aiConnected(req?: Request, env: Env = process.env): boolean {
  return Boolean(geminiKey(env) || env.AI_GATEWAY_API_KEY || req?.headers.get("x-vercel-oidc-token") || env.VERCEL_OIDC_TOKEN);
}

/** The model for chat (Nudge, Studio) or for reading photos (scans). */
export function aiModel(kind: "chat" | "vision", env: Env = process.env): LanguageModel {
  const key = geminiKey(env);
  if (key) {
    const id = (kind === "vision" && env.GEMINI_VISION_MODEL?.trim()) || env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return createGoogleGenerativeAI({ apiKey: key })(id);
  }
  return (kind === "vision" && env.AI_GATEWAY_VISION_MODEL) || env.AI_GATEWAY_MODEL || DEFAULT_GATEWAY_MODEL;
}

/** A short name for the model, for logs and Studio's wire format. */
export function aiModelName(kind: "chat" | "vision", env: Env = process.env): string {
  const model = aiModel(kind, env);
  return typeof model === "string" ? model : `google/${model.modelId}`;
}
