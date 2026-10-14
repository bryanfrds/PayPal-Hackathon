// Step 2 of email sign-in: check the typed code and, if it's right, sign the owner in.

import { NextResponse, type NextRequest } from "next/server";
import { CODE_SECONDS, PENDING_COOKIE, SESSION_COOKIE, checkCode, isAllowedOwner, makeSession } from "@/lib/auth";
import { SESSION_COOKIE_OPTIONS, authSecret, cookieOptions } from "@/lib/auth-server";
import { clientIp, createThrottle } from "@/lib/throttle";

/** 20 code checks per IP per 10 minutes (per instance), on top of 5 per pending cookie. */
const perIp = createThrottle(20, 10 * 60 * 1000);

const MESSAGES = {
  noCode: "Ask for a code first.",
  expired: "That code has expired. Ask for a new one.",
  tooManyTries: "Too many wrong codes. Ask for a new one.",
  wrong: "That code isn't right. Check the email and try again.",
} as const;

export async function POST(req: NextRequest) {
  let secret: string;
  try {
    secret = authSecret();
  } catch {
    return NextResponse.json({ error: "Sign-in isn't set up on this server yet." }, { status: 503 });
  }
  const wait = perIp.hit(clientIp(req));
  if (wait) return NextResponse.json({ error: `Too many tries. Wait ${wait} seconds.`, retryAfter: wait }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";
  const result = await checkCode(req.cookies.get(PENDING_COOKIE)?.value, code, secret);

  if (!result.ok || !isAllowedOwner(result.email)) {
    const reason = result.ok ? "wrong" : result.reason;
    const res = NextResponse.json({ error: MESSAGES[reason], reason }, { status: 400 });
    if (!result.ok && result.pending) res.cookies.set(PENDING_COOKIE, result.pending, cookieOptions(CODE_SECONDS));
    return res;
  }
  const res = NextResponse.json({ ok: true, email: result.email });
  res.cookies.set(SESSION_COOKIE, await makeSession(result.email, "email", secret), SESSION_COOKIE_OPTIONS);
  res.cookies.set(PENDING_COOKIE, "", cookieOptions(0));
  return res;
}
