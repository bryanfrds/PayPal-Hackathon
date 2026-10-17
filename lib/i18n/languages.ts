// The app's languages: Malaysia's four main ones first, then more from the region.
// Each is shown by its own name, with the English name under it.

export const LANGUAGES = [
  { code: "en", name: "English", english: "English", group: "my", locale: "en-MY", htmlLang: "en" },
  { code: "ms", name: "Bahasa Melayu", english: "Malay", group: "my", locale: "ms-MY", htmlLang: "ms" },
  { code: "zh", name: "中文 (简体)", english: "Chinese, Simplified", group: "my", locale: "zh-Hans-MY", htmlLang: "zh-Hans" },
  { code: "ta", name: "தமிழ்", english: "Tamil", group: "my", locale: "ta-MY", htmlLang: "ta" },
  { code: "id", name: "Bahasa Indonesia", english: "Indonesian", group: "more", locale: "id-ID", htmlLang: "id" },
  { code: "th", name: "ไทย", english: "Thai", group: "more", locale: "th-TH", htmlLang: "th" },
  { code: "vi", name: "Tiếng Việt", english: "Vietnamese", group: "more", locale: "vi-VN", htmlLang: "vi" },
  { code: "fil", name: "Filipino", english: "Filipino", group: "more", locale: "fil-PH", htmlLang: "fil" },
  { code: "bn", name: "বাংলা", english: "Bengali", group: "more", locale: "bn-BD", htmlLang: "bn" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
export type LanguageInfo = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && LANGUAGES.some((l) => l.code === v);
}

export function languageInfo(code: Language): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** The language picker's search: matches the own name or the English name, ignoring case and accents. */
export function filterLanguages(query: string): LanguageInfo[] {
  const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...LANGUAGES];
  return LANGUAGES.filter((l) => fold(l.name).includes(q) || fold(l.english).includes(q) || l.code === q);
}

/**
 * The best of our languages for a browser's preferred list (navigator.languages), else English.
 * Matches by the language part: "ms-MY" → Malay, "zh-Hans-CN" / "zh-CN" → Chinese,
 * "tl" (Tagalog) → Filipino, "in" (old code) → Indonesian.
 */
export function pickLanguage(preferred: readonly string[] | undefined): Language {
  const alias: Record<string, Language> = { tl: "fil", in: "id" };
  for (const tag of preferred ?? []) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    const code = alias[base] ?? base;
    if (isLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}
