import { beforeEach, describe, expect, it } from "vitest";
import {
  computeImageHash,
  deleteScanImage,
  getScanImage,
  MAX_SCAN_IMAGE_BYTES,
  saveScanImage,
  SUPPORTED_IMAGE_MIMES,
} from "./image-storage";

describe("image-storage", () => {
  const owner = "owner@example.com";
  const intruder = "intruder@example.com";
  const sampleBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // JPEG header bytes
  const samplePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header bytes

  it("computes deterministic SHA-256 image hash", () => {
    const hash1 = computeImageHash(sampleBytes);
    const hash2 = computeImageHash(sampleBytes);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unsupported MIME types", async () => {
    await expect(saveScanImage(owner, "test-1", sampleBytes, "application/pdf")).rejects.toThrow(
      /unsupported image type/i,
    );
  });

  it("rejects oversized images exceeding 10MB limit", async () => {
    const oversized = new Uint8Array(MAX_SCAN_IMAGE_BYTES + 1);
    await expect(saveScanImage(owner, "test-2", oversized, "image/jpeg")).rejects.toThrow(
      /image file exceeds limit/i,
    );
  });

  it("saves and retrieves private image for authorized owner", async () => {
    const { imageKey, hash } = await saveScanImage(owner, "scan-123", sampleBytes, "image/jpeg");
    expect(imageKey).toBeDefined();
    expect(hash).toBe(computeImageHash(sampleBytes));

    const retrieved = await getScanImage(owner, imageKey);
    expect(retrieved).toEqual(sampleBytes);

    // Intruder cannot access it
    await expect(getScanImage(intruder, imageKey)).rejects.toThrow(/unauthorized/i);
  });

  it("rejects file content that does not match declared MIME signature", async () => {
    // Attempting to upload PNG header with image/jpeg MIME
    await expect(saveScanImage(owner, "test-mismatch", samplePngBytes, "image/jpeg")).rejects.toThrow(
      /file content header does not match/i,
    );
  });

  it("deletes private image safely", async () => {
    const { imageKey } = await saveScanImage(owner, "scan-456", samplePngBytes, "image/png");
    await deleteScanImage(owner, imageKey);
    const retrieved = await getScanImage(owner, imageKey);
    expect(retrieved).toBeNull();
  });
});
