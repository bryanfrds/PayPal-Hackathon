// Server helpers for sign-in: the secret, cookie settings, and "who is signed in" for API
// routes. Every owner API route calls requireOwner(), even though proxy.ts already checks,
// so a route can never be reached without a valid session.

import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE, SESSION_SECONDS, type Session } from "./auth";

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

/** The signed-in owner, or null. */
export async function currentOwner(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSession(token, authSecret());
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

/** The site's own origin for links PayPal and emails send people back to. */
export function siteOrigin(req: Request): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}
