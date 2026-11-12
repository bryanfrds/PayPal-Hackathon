"use client";

// The shop's name and type, set once after the first sign-in and kept on this device next to
// the ledger. Every screen that shows the shop's name reads it from here.

import { useCallback, useSyncExternalStore } from "react";
import { browserStorage } from "@/lib/debt-store";
import type { T } from "@/lib/i18n";

export const SHOP_KEY = "buku.shop.v1";
export const SHOP_TYPES = ["Kedai runcit", "Kopitiam", "Mamak", "Pasar stall", "Other"] as const;
export type ShopType = (typeof SHOP_TYPES)[number];
export type Shop = { name: string; type: ShopType };

/** Shop types are saved as typed (Malaysian names); only what's shown is translated. */
const SHOP_TYPE_KEY = {
  "Kedai runcit": "settings.shopType.kedai",
  Kopitiam: "settings.shopType.kopitiam",
  Mamak: "settings.shopType.mamak",
  "Pasar stall": "settings.shopType.pasar",
  Other: "settings.shopType.other",
} as const satisfies Record<ShopType, string>;

export function shopTypeLabel(type: ShopType, t: T): string {
  return t(SHOP_TYPE_KEY[type]);
}

/** Shown until the owner names their shop (and in the demo data). */
export const DEFAULT_SHOP_NAME = "Kedai Ah Seng";
export const MAX_SHOP_NAME = 40;

function read(): Shop | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const v = JSON.parse(storage.getItem(SHOP_KEY) ?? "null") as Partial<Shop> | null;
    if (!v || typeof v.name !== "string" || !v.name.trim()) return null;
    const type = SHOP_TYPES.includes(v.type as ShopType) ? (v.type as ShopType) : "Kedai runcit";
    return { name: v.name.trim().slice(0, MAX_SHOP_NAME), type };
  } catch {
    return null;
  }
}

let cached: Shop | null | undefined;
const listeners = new Set<() => void>();

function snapshot(): Shop | null {
  if (cached === undefined) cached = read();
  return cached;
}

function changed() {
  cached = read();
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === SHOP_KEY) changed();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useShop() {
  const shop = useSyncExternalStore(subscribe, snapshot, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  /** Returns false if this browser can't save (private mode). */
  const saveShop = useCallback((next: Shop): boolean => {
    const storage = browserStorage();
    if (!storage) return false;
    try {
      storage.setItem(SHOP_KEY, JSON.stringify({ name: next.name.trim().slice(0, MAX_SHOP_NAME), type: next.type }));
    } catch {
      return false;
    }
    changed();
    return true;
  }, []);
  return { shop, ready, name: shop?.name ?? DEFAULT_SHOP_NAME, saveShop };
}
