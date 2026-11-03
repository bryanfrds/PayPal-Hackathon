// Sends a scan photo to the AI reader (Person 1's POST /api/scans) and reads back its lines.
// Errors come back as a kind the scan screen can word and offer the right next step for.

import type { ReadEntry, ScanMode } from "./scan";

export type ReadFailure =
  | "notConnected" // the AI reader isn't set up on this site
  | "tooBig" // the photo is over the upload limit
  | "tooMany" // too many scans in a minute
  | "signedOut" // the sign-in ran out
  | "failed"; // the reader or the network failed; worth another try

export type ReadResult =
  | { ok: true; scanId: string; entries: ReadEntry[] }
  | { ok: false; reason: ReadFailure; scanId?: string };

type Fetch = typeof fetch;

function failure(status: number): ReadFailure {
  if (status === 503) return "notConnected";
  if (status === 413) return "tooBig";
  if (status === 429) return "tooMany";
  if (status === 401) return "signedOut";
  return "failed";
}

async function toResult(res: Response, fallbackScanId?: string): Promise<ReadResult> {
  const body = (await res.json().catch(() => null)) as { scan?: { id?: unknown }; entries?: unknown } | null;
  const scanId = typeof body?.scan?.id === "string" ? body.scan.id : fallbackScanId;
  if (!res.ok) return { ok: false, reason: failure(res.status), scanId };
  if (!scanId || !Array.isArray(body?.entries)) return { ok: false, reason: "failed", scanId };
  return { ok: true, scanId, entries: body.entries as ReadEntry[] };
}

/** Uploads a photo and returns the lines the AI reader found. */
export async function readPhoto(photo: Blob, mode: ScanMode, fetchImpl: Fetch = fetch): Promise<ReadResult> {
  const form = new FormData();
  form.append("file", photo, "scan.jpg");
  form.append("mode", mode);
  try {
    return await toResult(await fetchImpl("/api/scans", { method: "POST", body: form }));
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Reads an already uploaded photo again, after a failed read. */
export async function retryRead(scanId: string, fetchImpl: Fetch = fetch): Promise<ReadResult> {
  try {
    return await toResult(await fetchImpl(`/api/scans/${encodeURIComponent(scanId)}/retry`, { method: "POST" }), scanId);
  } catch {
    return { ok: false, reason: "failed", scanId };
  }
}

/**
 * The photo as a JPEG no bigger than 1600px on its longest side: enough to read handwriting,
 * and well under the server's upload limit even for a full-size phone photo. Browser only.
 * Falls back to the original file if the browser can't draw it (some HEIC photos).
 */
export async function shrinkPhoto(src: string): Promise<Blob> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch {}
  return (await fetch(src)).blob();
}
