"use client";

// The app's words in the owner's language: const { t } = useT(); t("status.overdue").
// Plurals: t("late.days", { count: 5 }). Dates go through Intl; money stays "RM 12.50".

import { useMemo } from "react";
import { formatDayIn, formatMonthIn, formatNumberIn, languageInfo, translator, type Language } from "@/lib/i18n";
import { usePrefs } from "./usePrefs";

export function useT() {
  const { prefs } = usePrefs();
  const lang: Language = prefs.language;
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
