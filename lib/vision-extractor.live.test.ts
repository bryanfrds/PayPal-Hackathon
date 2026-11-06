import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { extractNotebookEntries } from "./vision-extractor";

const enabled = process.env.RUN_LIVE_VISION_SMOKE === "true" && Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

it.skipIf(!enabled)("extracts the sanitized clear notebook fixture through the live vision provider", async () => {
  const bytes = new Uint8Array(await readFile("test/fixtures/scans/clear-notebook.jpg"));
  const entries = await extractNotebookEntries(bytes, "image/jpeg", {
    scanId: "live-smoke",
    revision: 1,
    today: "2026-10-18",
  });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.scanId === "live-smoke")).toBe(true);
});
