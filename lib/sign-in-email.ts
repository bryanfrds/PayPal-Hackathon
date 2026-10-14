// Sends the 6-digit sign-in code by email through Resend (added from the Vercel Marketplace,
// which sets RESEND_API_KEY). Server-only.
//
// Without a key: in local development the code is printed in the terminal so sign-in still
// works; anywhere else it fails with a plain message.

import "server-only";

export class SignInEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInEmailError";
  }
}

/** Resend's shared test sender works before a domain is verified (it can only reach the account's own email). */
const DEFAULT_FROM = "555 Buku <onboarding@resend.dev>";

export function emailIsSetUp(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function body(code: string): { text: string; html: string } {
  const text = `Your 555 Buku sign-in code is ${code}. It works for 10 minutes. If you didn't ask for it, you can ignore this email.`;
  // The code is six digits from our own generator, never user input, so it's safe in HTML.
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#141414">
  <p style="font-weight:800;font-size:18px;margin:0 0 16px">555 Buku</p>
  <p style="margin:0 0 8px">Your sign-in code:</p>
  <p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="color:#6f6b64;margin:0">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`;
  return { text, html };
}

export async function sendSignInCode(email: string, code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[sign-in] No RESEND_API_KEY, so the code isn't emailed. Code for ${email}: ${code}`);
      return;
    }
    throw new SignInEmailError("Email sign-in isn't set up on this server yet.");
  }
  const { text, html } = body(code);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
      to: [email],
      subject: `Your 555 Buku code: ${code}`,
      text,
      html,
    }),
  });
  if (!res.ok) throw new SignInEmailError("The code couldn't be emailed just now. Try again in a minute.");
}
