// Server helpers for sign-in: the secret, cookie settings, and "who is signed in" for API
// routes. Every owner API route calls requireOwner(), even though proxy.ts already checks,
// so a route can never be reached without a valid session.

import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAllowedOwner, readSession, SESSION_COOKIE, SESSION_SECONDS, type Session } from "./auth";

/** AUTH_SECRET signs every cookie. Missing means sign-in can't work, so say so plainly. */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters. Add it to .env.local (and to Vercel).");
  }
  return secret;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_COOKIE_OPTIONS = cookieOptions(SESSION_SECONDS);

/** The signed-in owner, or null. A session for an email no longer on the owner list doesn't count. */
export async function currentOwner(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(token, authSecret());
  return session && isAllowedOwner(session.email) ? session : null;
}

/** For owner API routes: the session, or a 401 response to return as-is. */
export async function requireOwner(): Promise<Session | NextResponse> {
  try {
    const owner = await currentOwner();
    if (owner) return owner;
  } catch {
    return NextResponse.json({ error: "Sign-in isn't set up on this server yet." }, { status: 503 });
  }
  return NextResponse.json({ error: "Sign in to do that." }, { status: 401 });
}

/**
 * The site's own origin for links PayPal sends people back to. Never taken from the request's
 * Host header on Vercel: SITE_URL, else Vercel's own production or deployment address.
 */
export function siteOrigin(req: Request): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const prod = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
  const host = prod || process.env.VERCEL_URL;
  if (host) return `https://${host}`;
  // Local development only.
  return new URL(req.url).origin;
}
