// Back from PayPal: check the state matches, swap the code for the owner's email, sign in.

import { NextResponse } from "next/server";
import { PAYPAL_STATE_COOKIE, SESSION_COOKIE, makeSession, normaliseEmail, safeNext, verify } from "@/lib/auth";
import { SESSION_COOKIE_OPTIONS, authSecret, cookieOptions, siteOrigin } from "@/lib/auth-server";
import { emailFromCode } from "@/lib/paypal-login";

export async function GET(req: Request) {
  const origin = siteOrigin(req);
  const params = new URL(req.url).searchParams;
  const fail = (why: string) => {
    const res = NextResponse.redirect(`${origin}/sign-in?error=${why}`);
    res.cookies.set(PAYPAL_STATE_COOKIE, "", cookieOptions(0));
    return res;
  };
  if (params.get("error")) return fail("paypal-cancelled");

  let secret: string;
  try {
    secret = authSecret();
  } catch {
    return fail("setup");
  }
  const raw = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${PAYPAL_STATE_COOKIE}=([^;]+)`))?.[1];
  const saved = await verify<{ nonce: string; next: string }>(raw ? decodeURIComponent(raw) : undefined, secret);
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.nonce) return fail("paypal-state");

  try {
    const email = normaliseEmail(await emailFromCode(code, `${origin}/api/auth/paypal/callback`));
    if (!email) return fail("paypal-email");
    const res = NextResponse.redirect(`${origin}${safeNext(saved.next)}`);
    res.cookies.set(SESSION_COOKIE, await makeSession(email, "paypal", secret), SESSION_COOKIE_OPTIONS);
    res.cookies.set(PAYPAL_STATE_COOKIE, "", cookieOptions(0));
    return res;
  } catch {
    return fail("paypal");
  }
}
