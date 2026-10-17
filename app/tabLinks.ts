"use client";

// Links to customers' shared tabs (…/t/<token>), so a customer can open their tab on their own
// phone. A customer's tab is published only on a deliberate step: the owner sends or copies a
// WhatsApp message with "add a link to their tab" ticked. After that, the copy is kept fresh:
// when the ledger changes, an invoice goes out or a payment comes in, tabs that already have a
// link are re-published (debounced), and a tab whose customer has no debts left (deleted or
// renamed) has its link turned off. The owner can also turn a link off at any time.
//
// Without the database (the server answers 503) or signed out, publishing quietly stops and
// messages just leave the link out. Links are kept on this device (localStorage) and cleared on
// sign-out, so the next owner on this device doesn't see them.

import { useSyncExternalStore } from "react";
import type { InvoiceRecord } from "@/lib/collect-store";
import type { Debt } from "@/lib/debts";
import { buildTabSnapshot } from "@/lib/tab-snapshot";

export const TAB_LINKS_KEY = "buku.tabLinks.v1";
export const DEBOUNCE_MS = 1500;
// Same rule as isTabLink in lib/share.ts: https, or http only on this computer (development).
const LINK = /^(?:https:\/\/[^/\s?#]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/t\/[A-Za-z0-9_-]{22,64}$/;

/** `ready`: the ledger has loaded and could be read. Nothing is published or revoked until it is. */
type Data = { debts: Debt[]; invoices: InvoiceRecord[]; shopName: string; ready: boolean };
type State = { links: Record<string, string>; available: boolean | null; failed: Record<string, boolean> };

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Saved links, keeping only ones that look like ours (anything tampered with is dropped). */
export function readLinks(): Record<string, string> {
  try {
    const v = JSON.parse(storage()?.getItem(TAB_LINKS_KEY) ?? "{}") as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([slug, url]) => slug.length <= 200 && typeof url === "string" && LINK.test(url))) as Record<string, string>;
  } catch {
    return {};
  }
}

let state: State = { links: readLinks(), available: null, failed: {} };
const listeners = new Set<() => void>();
// What was last sent for each customer, so an unchanged tab isn't sent again.
const lastSent = new Map<string, string>();
let getData: (() => Data) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshAll = false;
const refreshSlugs = new Set<string>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.links) {
    try {
      storage()?.setItem(TAB_LINKS_KEY, JSON.stringify(state.links));
    } catch {
      // Private mode: the link still works this visit.
    }
  }
  for (const l of listeners) l();
}

function withoutLink(slug: string): Record<string, string> {
  const links = { ...state.links };
  delete links[slug];
  return links;
}

/** TabPublisher hands over a way to read the latest ledger, so a publish always sends current data. */
export function registerTabData(fn: (() => Data) | null) {
  getData = fn;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * Publishes one customer's tab now and returns its link, or undefined (sharing isn't set up,
 * offline, or the customer has no debts). Used when the owner sends or copies a message.
 */
export async function publishTab(slug: string): Promise<string | undefined> {
  if (!getData || state.available === false) return undefined;
  const { debts, invoices, shopName, ready } = getData();
  if (!ready) return state.links[slug];
  const snapshot = buildTabSnapshot(slug, debts, invoices, shopName);
  if (!snapshot) {
    // Nothing left to show: a link that was published for them is turned off.
    if (state.links[slug]) await revokeTabLink(slug);
    return undefined;
  }
  const json = JSON.stringify(snapshot);
  try {
    const res = await post("/api/tabs/publish", { slug, snapshot });
    if (res.status === 503) {
      set({ available: false });
      return undefined;
    }
    const body = (await res.json().catch(() => ({}))) as { url?: unknown };
    if (!res.ok || typeof body.url !== "string" || !LINK.test(body.url)) throw new Error();
    lastSent.set(slug, json);
    set({ available: true, links: { ...state.links, [slug]: body.url }, failed: { ...state.failed, [slug]: false } });
    return body.url;
  } catch {
    // Offline or a server hiccup: keep the old link (it still shows the last copy) and say so quietly.
    set({ failed: { ...state.failed, [slug]: true } });
    return state.links[slug];
  }
}

/** Waits at most `ms` for a promise, so a slow server can't hold up opening WhatsApp. */
export function withinMs<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Turns a customer's link off on the server and forgets it here. False if the server couldn't be told. */
export async function revokeTabLink(slug: string): Promise<boolean> {
  lastSent.delete(slug);
  try {
    const res = await post("/api/tabs/revoke", { slug });
    if (!res.ok && res.status !== 503) throw new Error();
    set({ links: withoutLink(slug), failed: { ...state.failed, [slug]: false } });
    return true;
  } catch {
    set({ failed: { ...state.failed, [slug]: true } });
    return false;
  }
}

async function runRefresh() {
  refreshTimer = null;
  const slugs = refreshAll ? Object.keys(state.links) : [...refreshSlugs].filter((s) => state.links[s]);
  refreshAll = false;
  refreshSlugs.clear();
  if (!getData) return;
  for (const slug of slugs) {
    const { debts, invoices, shopName, ready } = getData();
    // Not loaded, or unreadable: never revoke (or send) on a ledger that only looks empty.
    if (!ready) return;
    const snapshot = buildTabSnapshot(slug, debts, invoices, shopName);
    if (!snapshot) await revokeTabLink(slug);
    else if (lastSent.get(slug) !== JSON.stringify(snapshot)) await publishTab(slug);
  }
}

/**
 * Re-publishes customers whose tab already has a link (all of them when no slugs are given),
 * after a short pause: only ones that changed are sent, and ones with no debts left lose their link.
 * Never creates a link.
 */
export function refreshPublishedTabs(slugs?: Iterable<string>) {
  if (typeof window === "undefined") return;
  if (slugs === undefined) refreshAll = true;
  else for (const s of slugs) refreshSlugs.add(s);
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void runRefresh(), DEBOUNCE_MS);
}

/** Forgets every link on this device (sign-out). The links themselves stay on for the customers. */
export function clearTabLinks() {
  lastSent.clear();
  try {
    storage()?.removeItem(TAB_LINKS_KEY);
  } catch {
    // nothing to clear
  }
  state = { links: {}, available: null, failed: {} };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER: State = { links: {}, available: null, failed: {} };

/** This customer's shared tab link, whether sharing works here (null: not known yet), and if the last update failed. */
export function useTabLink(slug: string): { url?: string; available: boolean | null; failed: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  return { url: s.links[slug], available: s.available, failed: s.failed[slug] === true };
}
