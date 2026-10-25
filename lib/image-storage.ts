// Private image storage engine for uploaded scans
import { createHash } from "node:crypto";
import { del, get, put } from "@vercel/blob";

export const MAX_SCAN_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB limit
export const SUPPORTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number];

export class ImageStorageError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "ImageStorageError";
  }
}

export function computeImageHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashOwner(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function assertOwnerKey(ownerEmail: string, imageKey: string): void {
  if (imageKey.includes("..") || !imageKey.startsWith(`scans/${hashOwner(ownerEmail)}/`)) {
    throw new ImageStorageError("Unauthorized access to image record.", 403);
  }
}

// In-memory backing buffer store for serverless runtime & testing
const storageRegistry = new Map<string, { ownerEmail: string; bytes: Uint8Array; mimeType: string }>();

export function isSupportedMime(mime: string): mime is SupportedImageMime {
  return SUPPORTED_IMAGE_MIMES.includes(mime.toLowerCase() as SupportedImageMime);
}

export function verifyImageMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.byteLength < 3) return false;
  const mime = mimeType.toLowerCase();
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes.byteLength >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === "image/webp") {
    return (
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 && // RIFF
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50 // WEBP
    );
  }
  return false;
}

export async function saveScanImage(
  ownerEmail: string,
  scanId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ imageKey: string; hash: string }> {
  if (!isSupportedMime(mimeType)) {
    throw new ImageStorageError(
      `Unsupported image type "${mimeType}". Please upload a JPEG, PNG, or WebP image.`,
      415,
    );
  }

  if (bytes.byteLength > MAX_SCAN_IMAGE_BYTES) {
    throw new ImageStorageError(
      `Image file exceeds limit of ${MAX_SCAN_IMAGE_BYTES / (1024 * 1024)}MB.`,
      413,
    );
  }

  if (!verifyImageMagicBytes(bytes, mimeType)) {
    throw new ImageStorageError(
      `File content header does not match image format "${mimeType}".`,
      400,
    );
  }

  const ownerSlug = hashOwner(ownerEmail);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const imageKey = `scans/${ownerSlug}/${scanId}.${ext}`;
  const hash = computeImageHash(bytes);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(imageKey, Buffer.from(bytes), { access: "private", addRandomSuffix: false, contentType: mimeType });
    return { imageKey: blob.pathname, hash };
  }
  if (process.env.NODE_ENV === "production" && !process.env.VITEST) {
    throw new ImageStorageError("Private scan storage is not configured.", 503);
  }

  storageRegistry.set(imageKey, {
    ownerEmail: ownerEmail.trim().toLowerCase(),
    bytes,
    mimeType,
  });

  return { imageKey, hash };
}

export async function getScanImage(
  ownerEmail: string,
  imageKey: string,
): Promise<Uint8Array | null> {
  assertOwnerKey(ownerEmail, imageKey);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await get(imageKey, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }
  const item = storageRegistry.get(imageKey);
  if (!item) return null;

  if (item.ownerEmail !== ownerEmail.trim().toLowerCase()) {
    throw new ImageStorageError("Unauthorized access to image record.", 403);
  }

  return item.bytes;
}

export async function deleteScanImage(ownerEmail: string, imageKey: string): Promise<void> {
  assertOwnerKey(ownerEmail, imageKey);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await del(imageKey);
    return;
  }
  const item = storageRegistry.get(imageKey);
  if (!item) return;

  if (item.ownerEmail !== ownerEmail.trim().toLowerCase()) {
    throw new ImageStorageError("Unauthorized access to image record.", 403);
  }

  storageRegistry.delete(imageKey);
}
