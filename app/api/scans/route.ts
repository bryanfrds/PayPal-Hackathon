// POST /api/scans: Uploads a notebook/receipt photo and extracts reviewable draft entries
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { computeImageHash, MAX_SCAN_IMAGE_BYTES, saveScanImage } from "@/lib/image-storage";
import { getPerson1Store } from "@/lib/person1-store";
import type { ScanRecord } from "@/lib/person1-types";
import { extractNotebookEntries } from "@/lib/vision-extractor";
import { malaysiaDate } from "@/lib/person1-validation";
import { clientIp, createThrottle } from "@/lib/throttle";

const uploads = createThrottle(10, 60_000);
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export async function POST(req: Request) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;
  const wait = uploads.hit(`${owner.email}:${clientIp(req)}`);
  if (wait) return NextResponse.json({ error: "Too many scan uploads." }, { status: 429, headers: { "Retry-After": String(wait) } });
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SCAN_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: "Image file exceeds the 10MB limit." }, { status: 413 });
  }

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
  if (file.size > MAX_SCAN_IMAGE_BYTES) return NextResponse.json({ error: "Image file exceeds the 10MB limit." }, { status: 413 });

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
    status: "processing",
    mode,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };

  await store.saveScan(scan);

  let entries;
  try {
    entries = await extractNotebookEntries(bytes, mimeType, { scanId, revision: 1, today: malaysiaDate() });
    await store.saveEntries(entries);
    await store.updateScanStatus(owner.email, scanId, "completed");
    scan.status = "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image extraction failed.";
    await store.updateScanStatus(owner.email, scanId, "failed", message);
    return NextResponse.json({ scan: { ...scan, status: "failed", error: message }, error: "Image extraction failed. Retry this scan." }, { status: 502 });
  }

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
