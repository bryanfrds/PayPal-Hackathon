// POST /api/scans/[id]/retry: Retries extraction on an existing scan
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

  try {
    const entries = await extractNotebookEntries(bytes, scan.mimeType, {
      scanId: scan.id,
      revision: scan.revision,
      today: new Date().toISOString().slice(0, 10),
      fixtureScenario,
    });

    await store.saveEntries(entries);
    await store.updateScanStatus(owner.email, scan.id, "completed");

    return NextResponse.json({ scan: { ...scan, status: "completed" }, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry extraction failed.";
    const isUnconfigured = message.includes("not configured");
    await store.updateScanStatus(owner.email, scan.id, "failed", message);
    return NextResponse.json(
      { error: isUnconfigured ? "AI document scanning is not configured." : message },
      { status: isUnconfigured ? 503 : 502 },
    );
  }
}
