// Loads a shared tab for the /t/<token> pages, on the server. Turns away a flood of guesses
// from one address before the database is asked, and treats anything not live as not found.

import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadSharedTab, type SharedTab } from "@/lib/shared-tab";
import { tabDb } from "@/lib/tab-db";
import { createThrottle } from "@/lib/throttle";

// A customer opens their tab a few times; 60 page loads a minute per address is generous.
const throttle = createThrottle(60, 60_000);

export type SharedTabProps = Omit<SharedTab, "snapshot"> & { base: string };

export async function loadForPage(token: string): Promise<SharedTabProps> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  // Over the limit: the same "not active" page as a wrong token, so guessing gets no signal.
  if (throttle.hit(ip) > 0) notFound();
  let tab: SharedTab | null = null;
  try {
    tab = await loadSharedTab(tabDb(), token);
  } catch {
    tab = null;
  }
  if (!tab) notFound();
  const { snapshot: _snapshot, ...rest } = tab;
  void _snapshot;
  return { ...rest, base: `/t/${token}` };
}
