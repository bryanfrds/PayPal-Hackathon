// Turns off a customer's shared tab link. Owner only.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { revokeTab } from "@/lib/shared-tab";
import { tabDb } from "@/lib/tab-db";

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  let body: unknown;
  try {
    body = await req.json();
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
