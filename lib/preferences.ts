// The owner's app preferences on this device: theme, the WhatsApp message's default tone,
// whether to add the PayPal pay link, and whether the quick tour has been seen. Pure functions
// so reading, writing and theme choice can be tested in Node. Every storage call is wrapped:
// private modes can throw on access.

import { DEFAULT_LANGUAGE, isLanguage, LANGUAGES, type Language } from "./i18n/languages";
import { TONES, type Tone } from "./share";

export type ThemeChoice = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

export type Prefs = {
  theme: ThemeChoice;
  defaultTone: Tone;
  /** Add the PayPal pay link to WhatsApp messages when there's one. */
  payLink: boolean;
  /** The app's language (and the WhatsApp message's starting language). */
  language: Language;
  /** The first-visit quick tour was finished or skipped on this device, so it doesn't show on its own again. */
  tourSeen: boolean;
};

export const PREFS_KEY = "buku.prefs.v1";

/** Light by default, so nothing changes for anyone until they pick Dark or Auto. */
export const DEFAULT_PREFS: Prefs = { theme: "light", defaultTone: "friendly", payLink: true, language: DEFAULT_LANGUAGE, tourSeen: false };

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
    language: isLanguage(p.language) ? p.language : DEFAULT_PREFS.language,
    tourSeen: typeof p.tourSeen === "boolean" ? p.tourSeen : DEFAULT_PREFS.tourSeen,
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

const HTML_LANGS: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.htmlLang]));

/**
 * Runs in <head> before the page paints, so a dark-mode owner never sees a flash of light.
 * Sets data-theme on <html> to light, dark or auto (CSS handles auto with a media query), and
 * lang to the chosen language, so screen readers and fonts are right from the first paint.
 * A customer's shared tab (/t/...) isn't the owner's: it follows the visitor's own device
 * (auto theme, and their browser's language when it's one of ours).
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,L=${JSON.stringify(HTML_LANGS)},H=function(k){return Object.prototype.hasOwnProperty.call(L,k)};try{if(typeof location!=="undefined"&&location.pathname.indexOf("/t/")===0){d.setAttribute("data-theme","auto");var n=(typeof navigator!=="undefined"&&(navigator.languages||[navigator.language]))||[];for(var i=0;i<n.length;i++){var b=String(n[i]||"").toLowerCase().split(/[-_]/)[0];b=b==="tl"?"fil":b==="in"?"id":b;if(H(b)){d.setAttribute("lang",L[b]);break}}return}var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"{}")||{},t=p.theme;d.setAttribute("data-theme",t==="dark"||t==="auto"?t:"light");if(H(p.language))d.setAttribute("lang",L[p.language])}catch(e){d.setAttribute("data-theme","light")}})();`;
