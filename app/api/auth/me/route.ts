// Who's signed in, for the account sheet.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  return NextResponse.json({ email: owner.email, method: owner.method });
}
