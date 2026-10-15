import { describe, expect, it } from "vitest";
import { en } from "./en";
import { DICTIONARIES, LANGUAGES, filterLanguages, formatDayIn, formatMonthIn, isLanguage, translate, translator } from "./index";

const EN_KEYS = Object.keys(en).sort();

describe("dictionaries", () => {
  for (const { code } of LANGUAGES) {
    it(`${code} has exactly the English keys, none empty`, () => {
      const dict = DICTIONARIES[code] as Record<string, string>;
      const keys = Object.keys(dict).sort();
      expect(keys.filter((k) => !(k in en))).toEqual([]); // no extra keys
      expect(EN_KEYS.filter((k) => !(k in dict))).toEqual([]); // no missing keys
      for (const k of keys) expect(dict[k].trim(), k).not.toBe("");
    });

    it(`${code} keeps every {placeholder} the English text has`, () => {
      const dict = DICTIONARIES[code] as Record<string, string>;
      for (const [k, text] of Object.entries(en)) {
        const want = (text.match(/\{\w+\}/g) ?? []).sort();
        const got = ((dict[k] ?? text).match(/\{\w+\}/g) ?? []).sort();
        // A plural's "one" form may write the number as a word; every other key keeps them all.
        const need = k.endsWith("_one") ? want.filter((p) => p !== "{count}") : want;
        for (const p of need) expect(got, `${code} ${k}`).toContain(p);
      }
    });
  }
});

describe("translate", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(translate("en", "settings.nameTooLong", { max: 40 })).toBe("Keep it to 40 characters or fewer.");
    expect(translate("en", "settings.nameTooLong")).toBe("Keep it to {max} characters or fewer.");
  });

  it("falls back to English for a key missing in a language", () => {
    const saved = DICTIONARIES.ms;
    try {
      DICTIONARIES.ms = {};
      expect(translate("ms", "status.paid")).toBe("Paid");
    } finally {
      DICTIONARIES.ms = saved;
    }
  });

  it("shows the key itself when no language has it", () => {
    // @ts-expect-error: not a real key
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });

  it("picks the plural form from count", () => {
    expect(translate("en", "late.days", { count: 1 })).toBe("1 day late");
    expect(translate("en", "late.days", { count: 0 })).toBe("0 days late");
    expect(translate("en", "late.days", { count: 12 })).toBe("12 days late");
    // Languages without plural forms always use "other".
    expect(translate("zh", "late.days", { count: 1 })).toBe(translate("zh", "late.days", { count: 2 }).replace("2", "1"));
  });

  it("translator() binds a language, English by default", () => {
    expect(translator()("status.overdue")).toBe("Overdue");
    expect(translator("en")("status.sent")).toBe("Invoice sent");
  });
});

describe("dates and numbers", () => {
  it("English keeps the app's existing date style", () => {
    expect(formatDayIn("en", "2026-10-02")).toBe("2 Oct 2026");
    expect(formatDayIn("en", "2026-10-02", { year: false })).toBe("2 Oct");
    expect(formatMonthIn("en", "2026-10", 2026)).toBe("October");
    expect(formatMonthIn("en", "2025-12", 2026)).toBe("December 2025");
  });

  it("other languages use their own month names", () => {
    expect(formatMonthIn("ms", "2026-10", 2026).toLowerCase()).toContain("oktober");
    expect(formatDayIn("zh", "2026-10-02")).toContain("2026");
  });
});

describe("languages", () => {
  it("lists Malaysia's four first, then five more", () => {
    expect(LANGUAGES.filter((l) => l.group === "my").map((l) => l.code)).toEqual(["en", "ms", "zh", "ta"]);
    expect(LANGUAGES.filter((l) => l.group === "more").map((l) => l.code)).toEqual(["id", "th", "vi", "fil", "bn"]);
    expect(isLanguage("ms")).toBe(true);
    expect(isLanguage("xx")).toBe(false);
  });

  it("search matches the own name or the English name, ignoring case and accents", () => {
    expect(filterLanguages("").length).toBe(9);
    expect(filterLanguages("malay").map((l) => l.code)).toEqual(["ms"]);
    expect(filterLanguages("MELAYU").map((l) => l.code)).toEqual(["ms"]);
    expect(filterLanguages("tieng viet").map((l) => l.code)).toEqual(["vi"]);
    expect(filterLanguages("中文").map((l) => l.code)).toEqual(["zh"]);
    expect(filterLanguages("தமிழ்").map((l) => l.code)).toEqual(["ta"]);
    expect(filterLanguages("bahasa").map((l) => l.code)).toEqual(["ms", "id"]);
    expect(filterLanguages("  thai ").map((l) => l.code)).toEqual(["th"]);
    expect(filterLanguages("klingon")).toEqual([]);
  });
});
