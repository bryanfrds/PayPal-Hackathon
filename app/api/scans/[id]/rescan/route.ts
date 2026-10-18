// POST /api/scans/[id]/rescan: Triggers a new extraction pass with an incremented revision
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getScanImage } from "@/lib/image-storage";
import { getPerson1Store } from "@/lib/person1-store";
import { extractNotebookEntries } from "@/lib/vision-extractor";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  const store = getPerson1Store();

  const scan = await store.getScan(owner.email, id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const bytes = await getScanImage(owner.email, scan.imageKey);
  if (!bytes) {
    return NextResponse.json({ error: "Source scan image unavailable." }, { status: 410 });
  }

  const newRevision = scan.revision + 1;
  const now = new Date().toISOString();

  const entries = await extractNotebookEntries(bytes, scan.mimeType, {
    scanId: scan.id,
    revision: newRevision,
    today: now.slice(0, 10),
  });

  const updatedScan = {
    ...scan,
    revision: newRevision,
    updatedAt: now,
  };

  await store.saveScan(updatedScan);
  await store.saveEntries(entries);

  return NextResponse.json({ scan: updatedScan, entries });
}
