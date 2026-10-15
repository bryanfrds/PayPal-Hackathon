// Back from PayPal: check the state matches, swap the code for the owner's verified email,
// and sign in if that email is on the owner list.

import { NextResponse, type NextRequest } from "next/server";
import { PAYPAL_STATE_COOKIE, SESSION_COOKIE, isAllowedOwner, makeSession, normaliseEmail, readPayPalState, safeNext } from "@/lib/auth";
import { SESSION_COOKIE_OPTIONS, authSecret, cookieOptions, siteOrigin } from "@/lib/auth-server";
import { emailFromCode, PayPalUnverifiedEmailError } from "@/lib/paypal-login";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  const params = req.nextUrl.searchParams;
  const fail = (why: string) => {
    const res = NextResponse.redirect(`${origin}/sign-in?error=${why}`);
    res.cookies.set(PAYPAL_STATE_COOKIE, "", cookieOptions(0));
    return res;
  };
  if (params.get("error")) return fail("paypal-cancelled");

  try {
    const secret = authSecret();
    const saved = await readPayPalState(req.cookies.get(PAYPAL_STATE_COOKIE)?.value, secret);
    const code = params.get("code");
    if (!saved || !code || params.get("state") !== saved.nonce) return fail("paypal-state");

    const email = normaliseEmail(await emailFromCode(code, `${origin}/api/auth/paypal/callback`));
    if (!email) return fail("paypal-email");
    if (!isAllowedOwner(email)) return fail("not-owner");
    const res = NextResponse.redirect(`${origin}${safeNext(saved.next)}`);
    res.cookies.set(SESSION_COOKIE, await makeSession(email, "paypal", secret), SESSION_COOKIE_OPTIONS);
    res.cookies.set(PAYPAL_STATE_COOKIE, "", cookieOptions(0));
    return res;
  } catch (error) {
    return fail(error instanceof PayPalUnverifiedEmailError ? "paypal-unverified" : "paypal");
  }
}
