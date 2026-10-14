// Every owner screen and API needs a signed-in shop owner. Signed-out visitors go to
// /sign-in (pages) or get a 401 (APIs). Owner API routes also check for themselves
// (requireOwner), so this is the first gate, not the only one.
//
// Open to everyone: sign-in, a customer's own tab pages (/tab/...), reading one invoice's
// status (the customer's pay page polls it), and static files.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/auth";

function isPublic(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
  if (pathname.startsWith("/tab/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // One invoice's live status for the customer's pay page: GET /api/invoices/<id> only.
  const invoice = pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoice && req.method === "GET" && invoice[1] !== "status") return true;
  return false;
}

export async function proxy(req: NextRequest) {
  if (isPublic(req)) return NextResponse.next();

  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const session = secret.length >= 32 ? await readSession(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to do that." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next's own files, icons, the manifest and anything with a file extension.
  matcher: ["/((?!_next/|favicon\\.ico|icon|apple-icon|pwa-icon/|manifest\\.webmanifest|vendor/|.*\\.[a-zA-Z0-9]+$).*)"],
};
