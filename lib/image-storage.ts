// Private image storage engine for uploaded scans
import { createHash } from "node:crypto";

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

// In-memory backing buffer store for serverless runtime & testing
const storageRegistry = new Map<string, { ownerEmail: string; bytes: Uint8Array; mimeType: string }>();

export function isSupportedMime(mime: string): mime is SupportedImageMime {
  return SUPPORTED_IMAGE_MIMES.includes(mime.toLowerCase() as SupportedImageMime);
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

  const ownerSlug = hashOwner(ownerEmail);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const imageKey = `scans/${ownerSlug}/${scanId}.${ext}`;
  const hash = computeImageHash(bytes);

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
  const item = storageRegistry.get(imageKey);
  if (!item) return null;

  if (item.ownerEmail !== ownerEmail.trim().toLowerCase()) {
    throw new ImageStorageError("Unauthorized access to image record.", 403);
  }

  return item.bytes;
}

export async function deleteScanImage(ownerEmail: string, imageKey: string): Promise<void> {
  const item = storageRegistry.get(imageKey);
  if (!item) return;

  if (item.ownerEmail !== ownerEmail.trim().toLowerCase()) {
    throw new ImageStorageError("Unauthorized access to image record.", 403);
  }

  storageRegistry.delete(imageKey);
}
