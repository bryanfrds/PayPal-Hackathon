// Step 1 of email sign-in: send a code and remember (in a signed cookie) which email it's for.
// The code itself is never stored, only a keyed hash of it.
//
// Emails not on the owner list get exactly the same answer, but no email is sent and no code
// can ever match, so nobody can find out which emails are allowed.

import { NextResponse, type NextRequest } from "next/server";
import { CODE_SECONDS, PENDING_COOKIE, isAllowedOwner, makePending, newCode, normaliseEmail } from "@/lib/auth";
import { authSecret, cookieOptions } from "@/lib/auth-server";
import { SignInEmailError, sendSignInCode } from "@/lib/sign-in-email";
import { clientIp, createThrottle } from "@/lib/throttle";

const RESEND_AFTER_SECONDS = 30;
/** One code per email every 30 seconds, and 5 requests per IP per 10 minutes (per instance). */
const perEmail = createThrottle(1, RESEND_AFTER_SECONDS * 1000);
const perIp = createThrottle(5, 10 * 60 * 1000);

/** Judges and demos: a fixed email and code from the environment, no email sent. Off unless both are set. */
function demoCode(email: string): string | null {
  const demoEmail = process.env.DEMO_EMAIL?.trim().toLowerCase();
  const code = process.env.DEMO_CODE?.trim().toUpperCase();
  return demoEmail && code && /^[A-Z0-9]{6}$/.test(code) && email === demoEmail ? code : null;
}

export async function POST(req: NextRequest) {
  let secret: string;
  try {
    secret = authSecret();
  } catch {
    return NextResponse.json({ error: "Sign-in isn't set up on this server yet." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });

  const ipWait = perIp.hit(clientIp(req));
  const emailWait = ipWait ? 0 : perEmail.hit(email);
  const wait = ipWait || emailWait;
  if (wait) return NextResponse.json({ error: `Wait ${wait} seconds before asking for another code.`, retryAfter: wait }, { status: 429 });

  const allowed = isAllowedOwner(email);
  const demo = allowed ? demoCode(email) : null;
  // Not an owner: a code that's never sent and never shown, so it can't be used.
  const code = demo ?? newCode();
  if (allowed && !demo) {
    try {
      await sendSignInCode(email, code);
    } catch (e) {
      const message = e instanceof SignInEmailError ? e.message : "The code couldn't be sent. Try again.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const res = NextResponse.json({ ok: true, email, resendAfter: RESEND_AFTER_SECONDS });
  res.cookies.set(PENDING_COOKIE, await makePending(email, code, secret), cookieOptions(CODE_SECONDS));
  return res;
}
