"use client";

// Settings → App language: each language in its own words with the English name under it,
// Malaysia's four first. Picking one saves it and goes back to Settings.
// Mock: "555 Buku - WhatsApp and Settings Mock.html", phone 3b.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { filterLanguages, translate, type LanguageInfo } from "@/lib/i18n";
import { BackIcon, CheckIcon, SearchIcon } from "../../components/icons";
import { usePrefs } from "../../usePrefs";
import { useT } from "../../useT";
import { flashSaved } from "../flash";

/** A short mark for each language's tile, in its own script. */
const GLYPH: Record<LanguageInfo["code"], string> = {
  en: "Aa",
  ms: "Ms",
  zh: "中",
  ta: "த",
  id: "Id",
  th: "ไ",
  vi: "Vi",
  fil: "Fil",
  bn: "বা",
};

export default function LanguageScreen() {
  const { prefs, setPrefs } = usePrefs();
  const { t } = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const shown = filterLanguages(query);
  // One radio is in the tab order: the current language, or the first shown if it's filtered out.
  const focusable = shown.some((l) => l.code === prefs.language) ? prefs.language : shown[0]?.code;
  const groups = [
    { id: "my", title: t("language.inMalaysia"), items: shown.filter((l) => l.group === "my") },
    { id: "more", title: t("language.more"), items: shown.filter((l) => l.group === "more") },
  ].filter((g) => g.items.length > 0);

  function pick(lang: LanguageInfo) {
    if (!setPrefs({ language: lang.code })) {
      setError(t("settings.saveFailed"));
      return;
    }
    // "Saved" in the language just picked, shown when Settings opens.
    flashSaved(translate(lang.code, "common.saved"));
    router.push("/settings");
  }

  // Arrow keys move between the languages (Enter or Space picks one), like a radio group.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const radios = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='radio']") ?? [])];
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (radios.length === 0) return;
    e.preventDefault();
    let next = at;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = radios.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (at + 1) % radios.length;
    else next = (at - 1 + radios.length) % radios.length;
    radios[next]?.focus();
  }

  return (
    <div className="settings">
      <div className="tab-top">
        <Link href="/settings" className="tab-back set-back" aria-label={t("language.backToSettings")}>
          <BackIcon />
        </Link>
        <h1>{t("language.title")}</h1>
        <span className="tab-back set-back-space" aria-hidden="true" />
      </div>

      <label className="lang-search">
        <SearchIcon />
        <span className="visually-hidden">{t("language.search")}</span>
        <input
          type="search"
          value={query}
          placeholder={t("language.search")}
          onChange={(e) => setQuery(e.target.value)}
          aria-controls={`${ids}-list`}
        />
      </label>

      {/* Always present, so screen readers announce when nothing matches. */}
      <p className="set-hint lang-status" role="status">
        {groups.length === 0 ? t("language.noMatch", { query: query.trim() }) : ""}
      </p>

      <div id={`${ids}-list`} ref={listRef} role="radiogroup" aria-label={t("language.title")} onKeyDown={onKey}>
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`${ids}-${g.id}`}>
            <h2 className="set-label" id={`${ids}-${g.id}`}>
              {g.title}
            </h2>
            <ul className="card lang-list" role="presentation">
              {g.items.map((l) => {
                const on = prefs.language === l.code;
                return (
                  <li key={l.code} role="presentation">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={l.code === focusable ? 0 : -1}
                      className="lang-item"
                      onClick={() => pick(l)}
                    >
                      <span className="lang-glyph" aria-hidden="true" lang={l.htmlLang}>
                        {GLYPH[l.code]}
                      </span>
                      <span className="set-grow">
                        <b lang={l.htmlLang}>{l.name}</b>
                        <small>{l.english}</small>
                      </span>
                      {on && (
                        <span className="lang-tick" aria-hidden="true">
                          <CheckIcon />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {error && (
        <p className="si-error" role="alert">
          {error}
        </p>
      )}
      <p className="set-foot">{t("language.keepsNames")}</p>
    </div>
  );
}
