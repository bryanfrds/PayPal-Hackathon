// POST /api/scans: Uploads a notebook/receipt photo and extracts reviewable draft entries
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { computeImageHash, saveScanImage } from "@/lib/image-storage";
import { getPerson1Store } from "@/lib/person1-store";
import type { ScanRecord } from "@/lib/person1-types";
import { extractNotebookEntries } from "@/lib/vision-extractor";

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data submission." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Image file is required." }, { status: 400 });
  }

  const mode = formData.get("mode") === "receipt" ? "receipt" : "notebook";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";
  const store = getPerson1Store();

  const imageHash = computeImageHash(bytes);
  const existingScan = await store.findScanByHash(owner.email, imageHash);
  const isDuplicate = existingScan !== null;

  const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let imageKey: string;
  try {
    const saved = await saveScanImage(owner.email, scanId, bytes, mimeType);
    imageKey = saved.imageKey;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to store image.";
    const status = (err as { statusCode?: number }).statusCode || 400;
    return NextResponse.json({ error: message }, { status });
  }

  const now = new Date().toISOString();
  const scan: ScanRecord = {
    id: scanId,
    ownerEmail: owner.email,
    imageKey,
    imageHash,
    mimeType,
    sizeBytes: bytes.byteLength,
    status: "completed",
    mode,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };

  await store.saveScan(scan);

  // Extract entries
  const entries = await extractNotebookEntries(bytes, mimeType, {
    scanId,
    revision: 1,
    today: now.slice(0, 10),
  });

  await store.saveEntries(entries);

  return NextResponse.json(
    {
      scan,
      entries,
      isDuplicate,
      warning: isDuplicate ? "This photo matches a previously uploaded scan." : undefined,
    },
    { status: isDuplicate ? 200 : 201 },
  );
}
