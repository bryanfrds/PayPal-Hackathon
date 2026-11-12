// A small translation layer: one dictionary per language, English as the source of keys and
// the fallback for anything missing. Pure, so it works in lib/ code and in tests.

import { formatDay, formatMonth } from "../customer-tab";
import { bn } from "./bn";
import { en, type Dictionary, type MessageKey } from "./en";
import { fil } from "./fil";
import { id } from "./id";
import { DEFAULT_LANGUAGE, languageInfo, type Language } from "./languages";
import { ms } from "./ms";
import { ta } from "./ta";
import { th } from "./th";
import { vi } from "./vi";
import { zh } from "./zh";

export { DEFAULT_LANGUAGE, LANGUAGES, filterLanguages, isLanguage, languageInfo, pickLanguage, type Language, type LanguageInfo } from "./languages";
export type { Dictionary, MessageKey } from "./en";

export const DICTIONARIES: Record<Language, Partial<Dictionary>> = { en, ms, zh, ta, id, th, vi, fil, bn };

/** "late.days" for the pair "late.days_one" / "late.days_other": pass { count } to pick the form. */
export type PluralKey = { [K in MessageKey]: K extends `${infer B}_other` ? B : never }[MessageKey];
export type TKey = MessageKey | PluralKey;
export type TVars = Record<string, string | number>;
export type T = (key: TKey, vars?: TVars) => string;

const pluralRules = new Map<Language, Intl.PluralRules>();

function pluralForm(lang: Language, count: number): "one" | "other" {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(languageInfo(lang).locale);
    pluralRules.set(lang, rules);
  }
  // Our dictionaries only carry "one" and "other"; every other category reads as "other".
  return rules.select(count) === "one" ? "one" : "other";
}

const countFormats = new Map<Language, Intl.NumberFormat>();

/** A count in the language's own digits (Bengali ১২, the rest 12), no thousands separator. */
function formatCount(lang: Language, n: number): string {
  let f = countFormats.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(languageInfo(lang).locale, { useGrouping: false, maximumFractionDigits: 0 });
    countFormats.set(lang, f);
  }
  return f.format(n);
}

function lookup(lang: Language, key: string): string | undefined {
  const dict = DICTIONARIES[lang] as Record<string, string | undefined>;
  return dict[key] ?? (en as Record<string, string | undefined>)[key];
}

/**
 * The text for `key` in `lang`, with {placeholders} filled from `vars`. A plural key picks
 * _one or _other from vars.count. Missing in `lang` → English; missing everywhere → the key.
 * vars.count is written in the language's digits, so counts match the dates (Bengali uses its
 * own digits). Every other var is shown as given: amounts stay "RM 12.50", hours stay as passed.
 */
export function translate(lang: Language, key: TKey, vars?: TVars): string {
  let text = lookup(lang, key);
  if (text === undefined && vars && typeof vars.count === "number") {
    text = lookup(lang, `${key}_${pluralForm(lang, vars.count)}`) ?? lookup(lang, `${key}_other`);
  }
  if (text === undefined) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!(name in vars)) return m;
    const v = vars[name];
    return name === "count" && typeof v === "number" ? formatCount(lang, v) : String(v);
  });
}

/** A t() bound to one language. */
export function translator(lang: Language = DEFAULT_LANGUAGE): T {
  return (key, vars) => translate(lang, key, vars);
}

/** "2026-10-15" → "15 Oct 2026" in English, the local form elsewhere. `year: false` leaves the year out. */
export function formatDayIn(lang: Language, day: string, opts: { year?: boolean; month?: "short" | "long" } = {}): string {
  // English keeps the app's existing "15 Oct 2026" exactly.
  if (lang === "en" && opts.month !== "long") {
    const text = formatDay(day);
    return opts.year === false ? text.replace(/ \d{4}$/, "") : text;
  }
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(languageInfo(lang).locale, {
    day: "numeric",
    month: opts.month ?? "short",
    year: opts.year === false ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2026-10" → "October" (with the year when it isn't `currentYear`), in the language. */
export function formatMonthIn(lang: Language, month: string, currentYear?: number): string {
  if (lang === "en") return formatMonth(month, currentYear);
  const [y, m] = month.split("-").map(Number);
  const withYear = currentYear !== undefined && y !== currentYear;
  return new Intl.DateTimeFormat(languageInfo(lang).locale, {
    month: "long",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** A plain number in the language's style (money is never formatted here: it stays "RM 12.50"). */
export function formatNumberIn(lang: Language, n: number): string {
  return new Intl.NumberFormat(languageInfo(lang).locale).format(n);
}
