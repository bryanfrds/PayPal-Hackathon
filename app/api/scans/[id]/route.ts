// GET /api/scans/[id]: Retrieves a scan and its extracted draft entries
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  const store = getPerson1Store();

  const scan = await store.getScan(owner.email, id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const entries = await store.getEntriesByScan(owner.email, id, scan.revision);
  return NextResponse.json({ scan, entries });
}
