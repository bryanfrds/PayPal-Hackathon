// Publishes one customer's tab so they can open it on their own phone (/t/<token>).
// Owner only. The snapshot is built on the device and checked strictly here (lib/shared-tab.ts).

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { publishTab } from "@/lib/shared-tab";
import { tabDb } from "@/lib/tab-db";
import { MAX_SNAPSHOT_BYTES } from "@/lib/tab-snapshot";
import { createThrottle } from "@/lib/throttle";

// Re-publishing happens on share, send and payment, debounced on the device: 60 a minute is plenty.
const throttle = createThrottle(60, 60_000);

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const wait = throttle.hit(owner.email);
  if (wait > 0) return NextResponse.json({ error: "Too many updates. Try again shortly." }, { status: 429, headers: { "Retry-After": String(wait) } });

  const raw = await req.text();
  if (raw.length > MAX_SNAPSHOT_BYTES + 1024) return NextResponse.json({ error: "Too big." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const result = await publishTab(tabDb(), owner.email, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Couldn't save the tab just now." }, { status: 502 });
  }
}
