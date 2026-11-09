import { requireOwner } from "@/lib/auth-server";
import { getScanImage } from "@/lib/image-storage";
import { getPerson1Store } from "@/lib/person1-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (owner instanceof Response) return owner;

  const { id } = await params;
  const scan = await getPerson1Store().getScan(owner.email, id);
  if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });

  const bytes = await getScanImage(owner.email, scan.imageKey);
  if (!bytes) return Response.json({ error: "Source scan image unavailable." }, { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": scan.mimeType,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
