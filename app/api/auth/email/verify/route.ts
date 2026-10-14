// Step 2 of email sign-in: check the typed code and, if it's right, sign the owner in.

import { NextResponse } from "next/server";
import { PENDING_COOKIE, SESSION_COOKIE, checkCode, makeSession } from "@/lib/auth";
import { SESSION_COOKIE_OPTIONS, authSecret, cookieOptions } from "@/lib/auth-server";

const MESSAGES = {
  noCode: "Ask for a code first.",
  expired: "That code has expired. Ask for a new one.",
  tooManyTries: "Too many wrong codes. Ask for a new one.",
  wrong: "That code isn't right. Check the email and try again.",
} as const;

export async function POST(req: Request) {
  let secret: string;
  try {
    secret = authSecret();
  } catch {
    return NextResponse.json({ error: "Sign-in isn't set up on this server yet." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  const pending = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${PENDING_COOKIE}=([^;]+)`))?.[1];

  const result = await checkCode(pending ? decodeURIComponent(pending) : undefined, code, secret);
  if (!result.ok) {
    const res = NextResponse.json({ error: MESSAGES[result.reason], reason: result.reason }, { status: 400 });
    if (result.pending) res.cookies.set(PENDING_COOKIE, result.pending, cookieOptions(10 * 60));
    return res;
  }
  const res = NextResponse.json({ ok: true, email: result.email });
  res.cookies.set(SESSION_COOKIE, await makeSession(result.email, "email", secret), SESSION_COOKIE_OPTIONS);
  res.cookies.set(PENDING_COOKIE, "", cookieOptions(0));
  return res;
}
