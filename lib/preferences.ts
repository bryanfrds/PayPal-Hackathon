// The owner's app preferences on this device: theme, the WhatsApp message's default tone, and
// whether to add the PayPal pay link. Pure functions so reading, writing and theme choice can
// be tested in Node. Every storage call is wrapped: private modes can throw on access.

import { TONES, type Tone } from "./share";

export type ThemeChoice = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

export type Prefs = {
  theme: ThemeChoice;
  defaultTone: Tone;
  /** Add the PayPal pay link to WhatsApp messages when there's one. */
  payLink: boolean;
};

export const PREFS_KEY = "buku.prefs.v1";

/** Light by default, so nothing changes for anyone until they pick Dark or Auto. */
export const DEFAULT_PREFS: Prefs = { theme: "light", defaultTone: "friendly", payLink: true };

export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "auto"];

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isTheme(v: unknown): v is ThemeChoice {
  return typeof v === "string" && (THEME_CHOICES as string[]).includes(v);
}

function isTone(v: unknown): v is Tone {
  return typeof v === "string" && TONES.some((t) => t.id === v);
}

/** Saved text → prefs. Anything missing or wrong falls back to its default, field by field. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ...DEFAULT_PREFS };
  const p = v as Record<string, unknown>;
  return {
    theme: isTheme(p.theme) ? p.theme : DEFAULT_PREFS.theme,
    defaultTone: isTone(p.defaultTone) ? p.defaultTone : DEFAULT_PREFS.defaultTone,
    payLink: typeof p.payLink === "boolean" ? p.payLink : DEFAULT_PREFS.payLink,
  };
}

export function readPrefs(storage: StorageLike | null): Prefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    return parsePrefs(storage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Saves the prefs with `patch` applied. Returns the new prefs, or null if it couldn't be saved. */
export function writePrefs(storage: StorageLike | null, patch: Partial<Prefs>): Prefs | null {
  if (!storage) return null;
  const next = parsePrefs(JSON.stringify({ ...readPrefs(storage), ...patch }));
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    return null;
  }
  return next;
}

/** The theme to show: Auto follows the device's light or dark setting. */
export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): Theme {
  if (choice === "auto") return deviceDark ? "dark" : "light";
  return choice;
}

/**
 * Runs in <head> before the page paints, so a dark-mode owner never sees a flash of light.
 * Sets data-theme on <html> to light, dark or auto (CSS handles auto with a media query).
 */
export const THEME_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"{}").theme;document.documentElement.setAttribute("data-theme",t==="dark"||t==="auto"?t:"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;
