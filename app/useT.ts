"use client";

// The app's words in the owner's language: const { t } = useT(); t("status.overdue").
// Plurals: t("late.days", { count: 5 }). Dates go through Intl; money stays "RM 12.50".

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { formatDayIn, formatMonthIn, formatNumberIn, languageInfo, translator, type Language } from "@/lib/i18n";
import { usePrefs } from "./usePrefs";

// Pages that aren't the owner's (a customer's shared tab) choose their own language instead of
// the owner's setting: see app/t/[token].
const LanguageOverride = createContext<Language | null>(null);

export function LanguageProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  return createElement(LanguageOverride.Provider, { value: lang }, children);
}

export function useT() {
  const { prefs } = usePrefs();
  const override = useContext(LanguageOverride);
  const lang: Language = override ?? prefs.language;
  return useMemo(
    () => ({
      t: translator(lang),
      lang,
      locale: languageInfo(lang).locale,
      formatDay: (day: string, opts?: { year?: boolean; month?: "short" | "long" }) => formatDayIn(lang, day, opts),
      formatMonth: (month: string, currentYear?: number) => formatMonthIn(lang, month, currentYear),
      formatNumber: (n: number) => formatNumberIn(lang, n),
    }),
    [lang],
  );
}
