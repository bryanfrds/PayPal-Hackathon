// Shop-owner sign-in without a database: everything the server needs is in signed cookies.
//
// - A session cookie says "this browser belongs to <email>", signed with AUTH_SECRET.
// - While signing in by email, a pending cookie holds the email, a hash of the 6-digit code,
//   when it expires and how many wrong tries there have been. The code itself is never stored.
//
// Uses Web Crypto (HMAC-SHA-256), so the same code runs in Node routes and in proxy.ts.

export const SESSION_COOKIE = "buku_session";
export const PENDING_COOKIE = "buku_pending";
export const PAYPAL_STATE_COOKIE = "buku_paypal_state";

/** Signed in for 30 days. */
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
/** An emailed code works for 10 minutes. */
export const CODE_SECONDS = 10 * 60;
/** Wrong codes allowed before the owner has to ask for a new one. */
export const MAX_CODE_TRIES = 5;

export type Session = { email: string; method: "email" | "paypal"; exp: number };
export type Pending = { email: string; codeHash: string; exp: number; tries: number };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

/** Compares without leaking where the first difference is. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** "<payload>.<signature>", both base64url. */
export async function sign(value: object, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(value)));
  const sig = toBase64Url(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** The value if the signature matches, else null. Doesn't check expiry; callers do. */
export async function verify<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token || !secret) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const given = fromBase64Url(sig);
  if (!given || !sameBytes(given, await hmac(secret, payload))) return null;
  const raw = fromBase64Url(payload);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed and lower-cased, or null if it doesn't look like an email. */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Six digits, from a secure random source. */
export function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** The code tied to one email, so a code for someone else never works. */
export async function hashCode(email: string, code: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(secret, `code:${email}:${code}`));
}

export async function makeSession(email: string, method: Session["method"], secret: string, now = Date.now()): Promise<string> {
  return sign({ email, method, exp: Math.floor(now / 1000) + SESSION_SECONDS } satisfies Session, secret);
}

/** The signed-in owner, or null if there's no valid, unexpired session. */
export async function readSession(token: string | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  const s = await verify<Session>(token, secret);
  if (!s || typeof s.email !== "string" || typeof s.exp !== "number") return null;
  return s.exp > Math.floor(now / 1000) ? s : null;
}

export async function makePending(email: string, code: string, secret: string, now = Date.now()): Promise<string> {
  const pending: Pending = { email, codeHash: await hashCode(email, code, secret), exp: Math.floor(now / 1000) + CODE_SECONDS, tries: 0 };
  return sign(pending, secret);
}

export type CodeCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "noCode" | "expired" | "tooManyTries" | "wrong"; pending?: string };

/**
 * Checks a typed code against the pending cookie. A wrong code comes back with a new pending
 * cookie that counts the try; after MAX_CODE_TRIES the owner has to ask for a new code.
 */
export async function checkCode(pendingToken: string | undefined, code: string, secret: string, now = Date.now()): Promise<CodeCheck> {
  const pending = await verify<Pending>(pendingToken, secret);
  if (!pending || typeof pending.email !== "string") return { ok: false, reason: "noCode" };
  if (pending.exp <= Math.floor(now / 1000)) return { ok: false, reason: "expired" };
  if (pending.tries >= MAX_CODE_TRIES) return { ok: false, reason: "tooManyTries" };
  const typed = code.replace(/\D/g, "");
  const expected = fromBase64Url(pending.codeHash);
  const actual = fromBase64Url(await hashCode(pending.email, typed, secret));
  if (typed.length === 6 && expected && actual && sameBytes(expected, actual)) return { ok: true, email: pending.email };
  const next: Pending = { ...pending, tries: pending.tries + 1 };
  return { ok: false, reason: next.tries >= MAX_CODE_TRIES ? "tooManyTries" : "wrong", pending: await sign(next, secret) };
}

/** Where to go after signing in: only paths inside this app, never another site. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/sign-in") || value.startsWith("/api/")) return "/";
  return value;
}
