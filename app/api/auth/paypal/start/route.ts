// "Log in with PayPal": send the owner to PayPal, with a random state kept in a signed cookie
// so the callback can tell it's the same browser that started.

import { NextResponse, type NextRequest } from "next/server";
import { PAYPAL_STATE_COOKIE, makePayPalState, safeNext } from "@/lib/auth";
import { authSecret, cookieOptions, siteOrigin } from "@/lib/auth-server";
import { authorizeUrl } from "@/lib/paypal-login";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  try {
    const nonce = crypto.randomUUID();
    const next = safeNext(req.nextUrl.searchParams.get("next"));
    const url = authorizeUrl(nonce, `${origin}/api/auth/paypal/callback`);
    const res = NextResponse.redirect(url);
    res.cookies.set(PAYPAL_STATE_COOKIE, await makePayPalState(nonce, next, authSecret()), cookieOptions(10 * 60));
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/sign-in?error=paypal-setup`);
  }
}
