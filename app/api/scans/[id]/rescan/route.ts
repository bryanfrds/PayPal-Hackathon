// POST /api/scans/[id]/rescan: Triggers a new extraction pass with an incremented revision
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-server";
import { getScanImage } from "@/lib/image-storage";
import { getPerson1Store } from "@/lib/person1-store";
import { extractNotebookEntries, resolveFixtureScenario } from "@/lib/vision-extractor";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let rawFixture: unknown;
  try {
    const url = new URL(req.url);
    const fixtureParam = url.searchParams.get("fixtureScenario");
    if (fixtureParam !== null) rawFixture = fixtureParam;
    if (rawFixture === undefined) {
      const body = await req.clone().json().catch(() => null);
      if (body && "fixtureScenario" in body) rawFixture = body.fixtureScenario;
    }
  } catch {}

  const resolvedFixture = resolveFixtureScenario(rawFixture);
  if (resolvedFixture.error) {
    return NextResponse.json({ error: resolvedFixture.error }, { status: 400 });
  }
  const fixtureScenario = resolvedFixture.scenario;

  const newRevision = scan.revision + 1;
  const now = new Date().toISOString();

  let entries;
  try {
    entries = await extractNotebookEntries(bytes, scan.mimeType, {
      scanId: scan.id,
      revision: newRevision,
      today: now.slice(0, 10),
      fixtureScenario,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rescan extraction failed.";
    const isUnconfigured = message.includes("not configured");
    return NextResponse.json(
      { error: isUnconfigured ? "AI document scanning is not configured." : message },
      { status: isUnconfigured ? 503 : 502 },
    );
  }

  const updatedScan = {
    ...scan,
    revision: newRevision,
    updatedAt: now,
  };

  await store.saveScan(updatedScan);
  await store.saveEntries(entries);

  return NextResponse.json({ scan: updatedScan, entries });
}
