// Turns off a customer's shared tab link. Owner only.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { revokeTab } from "@/lib/shared-tab";
import { tabDb } from "@/lib/tab-db";
import { createThrottle } from "@/lib/throttle";

const throttle = createThrottle(60, 60_000);
// The body is { slug }: a few hundred bytes at most.
const MAX_BODY = 2048;

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const wait = throttle.hit(owner.email);
  if (wait > 0) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(wait) } });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too big." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const result = await revokeTab(tabDb(), owner.email, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Couldn't turn the link off just now." }, { status: 502 });
  }
}
