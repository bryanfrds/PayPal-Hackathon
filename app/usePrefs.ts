"use client";

// The owner's preferences on this device (theme, default tone, pay link, language, and whether
// the quick tour has been seen), shared by every screen and re-rendering when they change here
// or in another tab. See lib/preferences.ts.

import { useCallback, useSyncExternalStore } from "react";
import { browserStorage } from "@/lib/debt-store";
import { languageInfo } from "@/lib/i18n/languages";
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, resolveTheme, writePrefs, type Prefs, type Theme } from "@/lib/preferences";

let cached: Prefs | undefined;
const listeners = new Set<() => void>();

function snapshot(): Prefs {
  if (cached === undefined) cached = readPrefs(browserStorage());
  return cached;
}

/** Puts the theme choice and language on <html>: globals.css reads data-theme, screen readers read lang. */
export function applyTheme(prefs: Prefs) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", prefs.theme);
  document.documentElement.setAttribute("lang", languageInfo(prefs.language).htmlLang);
}

function changed() {
  cached = readPrefs(browserStorage());
  applyTheme(cached);
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key === null || e.key === PREFS_KEY) changed();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PREFS);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  /** Returns false if this browser can't save (private mode or storage blocked). */
  const setPrefs = useCallback((patch: Partial<Prefs>): boolean => {
    const next = writePrefs(browserStorage(), patch);
    if (!next) return false;
    changed();
    return true;
  }, []);
  return { prefs, ready, setPrefs };
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeDevice(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * The theme actually showing, light or dark, for parts that can't follow CSS on their own
 * (AG Grid, AG Studio, Bryntum). Updates when the choice or the device setting changes.
 */
export function useResolvedTheme(): Theme {
  const { prefs } = usePrefs();
  const deviceDark = useSyncExternalStore(
    subscribeDevice,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return resolveTheme(prefs.theme, deviceDark);
}
