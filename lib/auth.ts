// Shop-owner sign-in without a database: everything the server needs is in signed cookies.
//
// - A session cookie says "this browser belongs to <email>".
// - While signing in by email, a pending cookie holds the email, a keyed hash of the code, when
//   it expires and how many wrong tries there have been. The code itself is never stored.
// - During "Log in with PayPal", a state cookie ties PayPal's answer to this browser.
//
// Each kind of cookie is signed with its own key (derived from AUTH_SECRET) and carries its
// kind, so one can never be passed off as another (a pending cookie is not a session).
//
// Honest limits of being stateless: the try counter lives in the cookie, so someone who replays
// an old pending cookie isn't slowed by it. What protects a code is that it's hard to guess
// (6 characters from 31, about 900 million options) and lives 10 minutes, and that only emails
// on the owner list (OWNER_EMAILS) can sign in at all.
//
// Uses Web Crypto (HMAC-SHA-256), so the same code runs in Node routes and in proxy.ts.

export const SESSION_COOKIE = "buku_session";
export const PENDING_COOKIE = "buku_pending";
export const PAYPAL_STATE_COOKIE = "buku_paypal_state";

/** Signed in for 7 days. A cookie can't be revoked server-side short of changing AUTH_SECRET. */
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
/** An emailed code works for 10 minutes. */
export const CODE_SECONDS = 10 * 60;
/** Wrong codes allowed on one pending cookie before the owner has to ask for a new one. */
export const MAX_CODE_TRIES = 5;
export const CODE_LENGTH = 6;
/** Owners' fixed codes (OWNER_CODES) are longer, since they never change. See fixedCode. */
export const OWNER_CODE_LENGTH = 12;
/** No 0/O, 1/I/L: easy to read out of an email and type on a phone. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export type Purpose = "session" | "pending" | "paypal-state";
export type Session = { typ: "session"; email: string; method: "email" | "paypal"; exp: number };
export type Pending = { typ: "pending"; email: string; codeHash: string; exp: number; tries: number };
export type PayPalState = { typ: "paypal-state"; nonce: string; next: string; exp: number };

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

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
}

/** A separate key per kind of cookie, so a signature for one kind never checks out as another. */
async function keyFor(purpose: Purpose | "code", secret: string): Promise<string> {
  return toBase64Url(await hmac(secret, `buku:${purpose}`));
}

/** Compares without leaking where the first difference is. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** "<payload>.<signature>", both base64url, signed with the key for `purpose`. */
export async function sign(value: { typ: Purpose }, purpose: Purpose, secret: string): Promise<string> {
  if (value.typ !== purpose) throw new Error("Cookie kind doesn't match its purpose.");
  const payload = toBase64Url(encoder.encode(JSON.stringify(value)));
  const sig = toBase64Url(await hmac(await keyFor(purpose, secret), payload));
  return `${payload}.${sig}`;
}

/** The value if it was signed for `purpose` and says so, else null. Doesn't check expiry; callers do. */
export async function verify<T extends { typ: Purpose }>(token: string | undefined, purpose: Purpose, secret: string): Promise<T | null> {
  if (!token || !secret) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const given = fromBase64Url(sig);
  if (!given || !sameBytes(given, await hmac(await keyFor(purpose, secret), payload))) return null;
  const raw = fromBase64Url(payload);
  if (!raw) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(raw)) as T;
    return value && value.typ === purpose ? value : null;
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

/**
 * Who may sign in: OWNER_EMAILS (comma-separated) plus DEMO_EMAIL. When neither is set, nobody in
 * production, and anyone in local development (so the app can be tried without setup).
 */
export function isAllowedOwner(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = [...(env.OWNER_EMAILS ?? "").split(","), env.DEMO_EMAIL ?? ""]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return env.NODE_ENV !== "production" || Boolean(env.VITEST);
  return list.includes(email.toLowerCase());
}

/** Six characters from CODE_ALPHABET, from a secure random source. */
export function newCode(): string {
  const out: string[] = [];
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  for (const b of bytes) {
    // Reject values that would bias the choice (256 isn't a multiple of 31).
    if (b >= 248) continue;
    out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    if (out.length === CODE_LENGTH) break;
  }
  return out.length === CODE_LENGTH ? out.join("") : newCode();
}

/** Upper-cased with spaces and dashes removed, so "abc 123" and "ABC-123" both work. */
export function tidyCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

/** The code tied to one email, so a code for someone else never works. */
export async function hashCode(email: string, code: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(await keyFor("code", secret), `${email}:${tidyCode(code)}`));
}

export async function makeSession(email: string, method: Session["method"], secret: string, now = Date.now()): Promise<string> {
  const session: Session = { typ: "session", email, method, exp: Math.floor(now / 1000) + SESSION_SECONDS };
  return sign(session, "session", secret);
}

/** The signed-in owner, or null if there's no valid, unexpired session cookie. */
export async function readSession(token: string | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  const s = await verify<Session>(token, "session", secret);
  if (!s || typeof s.email !== "string" || typeof s.exp !== "number") return null;
  if (s.method !== "email" && s.method !== "paypal") return null;
  return s.exp > Math.floor(now / 1000) ? s : null;
}

export async function makePending(email: string, code: string, secret: string, now = Date.now()): Promise<string> {
  const pending: Pending = {
    typ: "pending",
    email,
    codeHash: await hashCode(email, code, secret),
    exp: Math.floor(now / 1000) + CODE_SECONDS,
    tries: 0,
  };
  return sign(pending, "pending", secret);
}

export type CodeCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "noCode" | "expired" | "tooManyTries" | "wrong"; pending?: string };

/**
 * Checks a typed code against the pending cookie. A wrong code comes back with a new pending
 * cookie that counts the try; after MAX_CODE_TRIES the owner has to ask for a new code.
 */
export async function checkCode(pendingToken: string | undefined, code: string, secret: string, now = Date.now()): Promise<CodeCheck> {
  const pending = await verify<Pending>(pendingToken, "pending", secret);
  if (!pending || typeof pending.email !== "string" || typeof pending.codeHash !== "string") return { ok: false, reason: "noCode" };
  if (pending.exp <= Math.floor(now / 1000)) return { ok: false, reason: "expired" };
  if (pending.tries >= MAX_CODE_TRIES) return { ok: false, reason: "tooManyTries" };
  const typed = tidyCode(code);
  const expected = fromBase64Url(pending.codeHash);
  const actual = fromBase64Url(await hashCode(pending.email, typed, secret));
  if ((typed.length === CODE_LENGTH || typed.length === OWNER_CODE_LENGTH) && expected && actual && sameBytes(expected, actual)) return { ok: true, email: pending.email };
  const next: Pending = { ...pending, tries: pending.tries + 1 };
  return { ok: false, reason: next.tries >= MAX_CODE_TRIES ? "tooManyTries" : "wrong", pending: await sign(next, "pending", secret) };
}

export async function makePayPalState(nonce: string, next: string, secret: string, now = Date.now()): Promise<string> {
  const state: PayPalState = { typ: "paypal-state", nonce, next, exp: Math.floor(now / 1000) + 10 * 60 };
  return sign(state, "paypal-state", secret);
}

export async function readPayPalState(token: string | undefined, secret: string, now = Date.now()): Promise<PayPalState | null> {
  const s = await verify<PayPalState>(token, "paypal-state", secret);
  if (!s || typeof s.nonce !== "string" || typeof s.exp !== "number") return null;
  return s.exp > Math.floor(now / 1000) ? s : null;
}

/**
 * Where to go after signing in: only a path inside this app, never another site. Parsed the way
 * a browser would, so tricks like "/\t/evil.com" or "/\\evil.com" can't escape.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  // Control characters and backslashes have no business in our paths and are how escapes sneak in.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, "http://buku.invalid");
  } catch {
    return "/";
  }
  if (url.origin !== "http://buku.invalid") return "/";
  const path = url.pathname + url.search + url.hash;
  if (path.startsWith("//") || path.startsWith("/sign-in") || path.startsWith("/api/")) return "/";
  return path;
}

/**
 * A fixed code for an email, from the environment, used instead of emailing one: the judges'
 * demo login (DEMO_EMAIL + DEMO_CODE) and owners' private codes (OWNER_CODES, as
 * "email:CODE,email:CODE"). Null if the email has none or isn't an allowed owner.
 *
 * An owner's code never changes, and the try count lives in a cookie the browser can replay,
 * so only the per-IP throttle slows guessing. Owner codes are therefore 12 characters; the
 * demo code stays 6 because it's switched off after judging.
 */
export function fixedCode(email: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!isAllowedOwner(email, env)) return null;
  const ok = (code: string | undefined, length: number) => {
    const c = code?.trim().toUpperCase();
    return c && c.length === length && /^[A-Z0-9]+$/.test(c) ? c : null;
  };
  const target = email.trim().toLowerCase();
  for (const pair of (env.OWNER_CODES ?? "").split(",")) {
    const at = pair.lastIndexOf(":");
    if (at <= 0) continue;
    if (pair.slice(0, at).trim().toLowerCase() === target) {
      const code = ok(pair.slice(at + 1), OWNER_CODE_LENGTH);
      if (code) return code;
    }
  }
  if (env.DEMO_EMAIL?.trim().toLowerCase() === target) return ok(env.DEMO_CODE, CODE_LENGTH);
  return null;
}
