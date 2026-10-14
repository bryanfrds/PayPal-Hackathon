// Step 1 of email sign-in: send a 6-digit code and remember (in a signed cookie) which email
// it's for. The code itself is never stored, only a keyed hash of it.

import { NextResponse } from "next/server";
import { CODE_SECONDS, PENDING_COOKIE, makePending, newCode, normaliseEmail } from "@/lib/auth";
import { authSecret, cookieOptions } from "@/lib/auth-server";
import { SignInEmailError, sendSignInCode } from "@/lib/sign-in-email";

/** One code per email every 30 seconds, per server instance (a light brake, not a guarantee). */
const RESEND_AFTER_MS = 30_000;
const lastSent = new Map<string, number>();

/** Judges and demos: a fixed email and code from the environment, no email sent. Off unless both are set. */
function demoLogin(email: string): string | null {
  const demoEmail = process.env.DEMO_EMAIL?.trim().toLowerCase();
  const demoCode = process.env.DEMO_CODE?.trim();
  return demoEmail && demoCode && /^\d{6}$/.test(demoCode) && email === demoEmail ? demoCode : null;
}

export async function POST(req: Request) {
  let secret: string;
  try {
    secret = authSecret();
  } catch {
    return NextResponse.json({ error: "Sign-in isn't set up on this server yet." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });

  const now = Date.now();
  const last = lastSent.get(email);
  if (last && now - last < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (now - last)) / 1000);
    return NextResponse.json({ error: `Wait ${wait} seconds before asking for another code.`, retryAfter: wait }, { status: 429 });
  }

  const demo = demoLogin(email);
  const code = demo ?? newCode();
  if (!demo) {
    try {
      await sendSignInCode(email, code);
    } catch (e) {
      const message = e instanceof SignInEmailError ? e.message : "The code couldn't be sent. Try again.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
  lastSent.set(email, now);

  const res = NextResponse.json({ ok: true, email, resendAfter: RESEND_AFTER_MS / 1000 });
  res.cookies.set(PENDING_COOKIE, await makePending(email, code, secret, now), cookieOptions(CODE_SECONDS));
  return res;
}
