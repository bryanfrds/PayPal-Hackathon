// Sends the 6-character sign-in code by email. Server-only.
//
// Gmail first: GMAIL_USER plus a Google app password in GMAIL_APP_PASSWORD (no domain needed).
// Otherwise Resend (added from the Vercel Marketplace, which sets RESEND_API_KEY).
//
// Without either: in local development the code is printed in the terminal so sign-in still
// works; anywhere else it fails with a plain message.

import "server-only";
import nodemailer from "nodemailer";

export class SignInEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInEmailError";
  }
}

/** Resend's shared test sender works before a domain is verified (it can only reach the account's own email). */
const DEFAULT_FROM = "555 Buku <onboarding@resend.dev>";

type Mail = { to: string; subject: string; text: string; html: string };
/** Hands one email to Gmail. Swappable so tests never open a real connection. */
export type GmailSend = (user: string, password: string, mail: Mail) => Promise<void>;

function gmailLogin(): { user: string; password: string } | null {
  const user = process.env.GMAIL_USER?.trim();
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  return user && password ? { user, password } : null;
}

export function emailIsSetUp(): boolean {
  return Boolean(gmailLogin() || process.env.RESEND_API_KEY?.trim());
}

const sendWithGmail: GmailSend = async (user, password, mail) => {
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: password },
    // Fail fast rather than hold the sign-in request open if Gmail doesn't answer.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.sendMail({ from: `555 Buku <${user}>`, ...mail });
};

function body(code: string): { text: string; html: string } {
  const text = `Your 555 Buku sign-in code is ${code}. It works for 10 minutes. If you didn't ask for it, you can ignore this email.`;
  // The code is six letters and digits from our own generator, never user input, so it's safe in HTML.
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#141414">
  <p style="font-weight:800;font-size:18px;margin:0 0 16px">555 Buku</p>
  <p style="margin:0 0 8px">Your sign-in code:</p>
  <p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="color:#6f6b64;margin:0">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`;
  return { text, html };
}

export async function sendSignInCode(
  email: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
  gmailSend: GmailSend = sendWithGmail,
): Promise<void> {
  const { text, html } = body(code);
  const subject = `Your 555 Buku code: ${code}`;

  const gmail = gmailLogin();
  if (gmail) {
    try {
      await gmailSend(gmail.user, gmail.password, { to: email, subject, text, html });
    } catch (e) {
      // Only the error codes, never the login, so a revoked app password shows up in the logs.
      const { code, responseCode } = e as { code?: string; responseCode?: number };
      console.error("[sign-in] Gmail send failed", code, responseCode);
      throw new SignInEmailError("The code couldn't be emailed just now. Try again in a minute.");
    }
    return;
  }

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[sign-in] No email set up, so the code isn't emailed. Code for ${email}: ${code}`);
      return;
    }
    throw new SignInEmailError("Email sign-in isn't set up on this server yet.");
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
      to: [email],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) throw new SignInEmailError("The code couldn't be emailed just now. Try again in a minute.");
}
