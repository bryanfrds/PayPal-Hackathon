"use client";

// Links to customers' shared tabs (/t/<token>), so a customer can open their tab on their own
// phone. The owner's device publishes a customer's tab when the owner shares it, and refreshes
// an already-published one when an invoice goes out or a payment comes in (debounced). Without
// the database (or signed out), publishing quietly stops and messages just leave the link out.
//
// The links are kept on this device (localStorage) so the share sheet has them at once.

import { useSyncExternalStore } from "react";
import type { InvoiceRecord } from "@/lib/collect-store";
import type { Debt } from "@/lib/debts";
import { buildTabSnapshot } from "@/lib/tab-snapshot";

export const TAB_LINKS_KEY = "buku.tabLinks.v1";
const DEBOUNCE_MS = 1500;

type Data = { debts: Debt[]; invoices: InvoiceRecord[]; shopName: string };
type State = { links: Record<string, string>; available: boolean | null; failed: Record<string, boolean> };

let state: State = { links: readLinks(), available: null, failed: {} };
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let getData: (() => Data) | null = null;

function readLinks(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(TAB_LINKS_KEY) ?? "{}") as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, url]) => typeof url === "string" && /^\/t\/[A-Za-z0-9_-]{22,64}$/.test(url as string))) as Record<string, string>;
  } catch {
    return {};
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.links) {
    try {
      window.localStorage.setItem(TAB_LINKS_KEY, JSON.stringify(state.links));
    } catch {
      // Private mode: the link still works this visit.
    }
  }
  for (const l of listeners) l();
}

/** TabPublisher hands over a way to read the latest ledger, so a debounced publish sends current data. */
export function registerTabData(fn: (() => Data) | null) {
  getData = fn;
}

async function publishNow(slug: string) {
  if (!getData || state.available === false) return;
  const { debts, invoices, shopName } = getData();
  const snapshot = buildTabSnapshot(slug, debts, invoices, shopName);
  if (!snapshot) return;
  try {
    const res = await fetch("/api/tabs/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, snapshot }),
    });
    if (res.status === 503) {
      set({ available: false });
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { url?: unknown };
    if (!res.ok || typeof body.url !== "string") throw new Error();
    set({ available: true, links: { ...state.links, [slug]: body.url }, failed: { ...state.failed, [slug]: false } });
  } catch {
    // Offline or a server hiccup: keep the old link (it still shows the last copy) and say so quietly.
    set({ failed: { ...state.failed, [slug]: true } });
  }
}

/** Publishes (or re-publishes) one customer's tab after a short pause. */
export function publishTabSoon(slug: string, delayMs = DEBOUNCE_MS) {
  if (typeof window === "undefined") return;
  const timer = timers.get(slug);
  if (timer) clearTimeout(timer);
  timers.set(
    slug,
    setTimeout(() => {
      timers.delete(slug);
      void publishNow(slug);
    }, delayMs),
  );
}

/** Refreshes only customers whose tab is already published (after an invoice or a payment). */
export function refreshPublishedTabs(slugs: Iterable<string>) {
  for (const slug of new Set(slugs)) if (state.links[slug]) publishTabSoon(slug);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER: State = { links: {}, available: null, failed: {} };

/** This customer's shared tab link (a full URL), whether sharing works here, and if the last update failed. */
export function useTabLink(slug: string): { url?: string; available: boolean | null; failed: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const path = s.links[slug];
  return {
    url: path && typeof window !== "undefined" ? `${window.location.origin}${path}` : undefined,
    available: s.available,
    failed: s.failed[slug] === true,
  };
}
