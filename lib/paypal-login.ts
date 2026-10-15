// "Log in with PayPal" for shop owners (OAuth 2.0 / OpenID Connect). Server-only.
//
// Uses the same sandbox app as invoicing (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, read by
// Person 2's lib/paypal.ts). The app needs "Log in with PayPal" switched on in PayPal's
// developer dashboard, with <site>/api/auth/paypal/callback as a return URL and the email
// scope ticked. Until then PayPal shows its own error page and the owner can use email.

import "server-only";
import { readPayPalConfigFromEnv } from "./paypal";

export class PayPalLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayPalLoginError";
  }
}

/** PayPal's own site (where people log in), matching the API's sandbox or live mode. */
function webBase(apiBase: string): string {
  return apiBase.includes("sandbox") ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
}

/** Where to send the owner to log in. `state` comes back on the callback and must match. */
export function authorizeUrl(state: string, redirectUri: string): string {
  const { apiBase, clientId } = readPayPalConfigFromEnv();
  const url = new URL("/signin/authorize", webBase(apiBase));
  url.searchParams.set("flowEntry", "static");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

type Fetch = typeof fetch;

type UserInfo = {
  email?: string;
  email_verified?: boolean | string;
  emails?: { value?: string; primary?: boolean | string; confirmed?: boolean | string }[];
};

// PayPal documents these as booleans, but some report them as "true".
const isTrue = (value: unknown) => value === true || value === "true";

/**
 * The account's email, only when PayPal says it's verified: an unverified one could be anyone's
 * address, including an owner's. Missing proof counts as unverified.
 */
export function verifiedEmail(info: UserInfo): string | undefined {
  if (info.email && isTrue(info.email_verified)) return info.email;
  const confirmed = (info.emails ?? []).filter((e) => e.value && isTrue(e.confirmed));
  return (confirmed.find((e) => isTrue(e.primary)) ?? confirmed[0])?.value;
}

/** Swaps the one-time code from the callback for the owner's PayPal email. */
export async function emailFromCode(code: string, redirectUri: string, fetchImpl: Fetch = fetch): Promise<string> {
  const { apiBase, clientId, clientSecret } = readPayPalConfigFromEnv();
  const basic = btoa(`${clientId}:${clientSecret}`);

  const tokenRes = await fetchImpl(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
  });
  if (!tokenRes.ok) throw new PayPalLoginError(`PayPal didn't accept the login (${tokenRes.status}).`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new PayPalLoginError("PayPal didn't return a login token.");

  const infoRes = await fetchImpl(`${apiBase}/v1/identity/openidconnect/userinfo?schema=openid`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) throw new PayPalLoginError(`PayPal didn't share the account's details (${infoRes.status}).`);
  const info = (await infoRes.json()) as UserInfo;
  const email = verifiedEmail(info);
  if (!email) {
    if (info.email || info.emails?.length) throw new PayPalLoginError("This PayPal account's email isn't verified yet.");
    throw new PayPalLoginError("PayPal didn't share an email for this account. Tick the email scope for the app.");
  }
  return email;
}
