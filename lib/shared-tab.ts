// The server's side of shared customer tabs, kept apart from the Next.js routes so it can be
// tested: checking a publish request, and loading a public tab by its token.

import { customerSlug } from "./customer-tab";
import type { TabDb } from "./tab-db";
import { isTabToken, MAX_SLUG_LENGTH, parseTabSnapshot, snapshotToTab, tabLinkPath, type TabSnapshot } from "./tab-snapshot";

// customerSlug()'s output: letters, marks, digits and hyphens (or "~" plus a hash for names with none).
const SLUG = new RegExp(`^[\\p{L}\\p{M}\\p{N}-]{1,${MAX_SLUG_LENGTH}}$|^~[a-z0-9]{1,12}$`, "u");

export type HandlerResult = { status: number; body: Record<string, unknown> };

// Status codes the device acts on (app/tabLinks.ts):
// - 503 "not set up": no DATABASE_URL on this server, so sharing is off; the device stops trying
//   this visit and messages go out without a tab link, as before the feature;
// - 502 (from the routes): the database didn't answer; the device keeps the old link and says so.

/** POST /api/tabs/publish: { slug, snapshot } → { url }, the full link (origin + /t/<token>). */
export async function publishTab(db: TabDb | null, ownerEmail: string, body: unknown, origin = ""): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: "Sharing tabs isn't set up on this server." } };
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: 400, body: { error: "Send a slug and a snapshot." } };
  const { slug, snapshot, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { status: 400, body: { error: "Unexpected fields." } };
  if (typeof slug !== "string" || !SLUG.test(slug)) return { status: 400, body: { error: "Bad customer." } };
  const checked = parseTabSnapshot(snapshot);
  if (!checked.ok) return { status: 400, body: { error: checked.error } };
  if (customerSlug(checked.snapshot.customerName) !== slug) return { status: 400, body: { error: "The snapshot is for another customer." } };
  const token = await db.publish(ownerEmail, slug, checked.snapshot);
  return { status: 200, body: { url: `${origin}${tabLinkPath(token)}` } };
}

/** POST /api/tabs/revoke: { slug } → { revoked }. */
export async function revokeTab(db: TabDb | null, ownerEmail: string, body: unknown): Promise<HandlerResult> {
  if (!db) return { status: 503, body: { error: "Sharing tabs isn't set up on this server." } };
  const slug = typeof body === "object" && body !== null ? (body as Record<string, unknown>).slug : undefined;
  if (typeof slug !== "string" || !SLUG.test(slug)) return { status: 400, body: { error: "Bad customer." } };
  return { status: 200, body: { revoked: await db.revoke(ownerEmail, slug) } };
}

export type SharedTab = {
  slug: string;
  shopName: string;
  snapshot: TabSnapshot;
} & ReturnType<typeof snapshotToTab>;

/** A public tab by token, or null for a malformed, unknown or turned-off link (shown as "not active"). */
export async function loadSharedTab(db: TabDb | null, token: string): Promise<SharedTab | null> {
  if (!db || !isTabToken(token)) return null;
  const row = await db.read(token);
  if (!row) return null;
  // A row saved by an older or newer app version is checked again before it's shown.
  const checked = parseTabSnapshot(row.snapshot);
  if (!checked.ok) return null;
  return { ...snapshotToTab(checked.snapshot), shopName: checked.snapshot.shopName, snapshot: checked.snapshot };
}
