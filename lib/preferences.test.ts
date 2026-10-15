import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, THEME_SCRIPT, parsePrefs, readPrefs, resolveTheme, writePrefs } from "./preferences";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("parsePrefs", () => {
  it("defaults to light, friendly, pay link on", () => {
    expect(DEFAULT_PREFS).toEqual({ theme: "light", defaultTone: "friendly", payLink: true });
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
  });

  it("reads good values", () => {
    expect(parsePrefs(JSON.stringify({ theme: "dark", defaultTone: "firm", payLink: false }))).toEqual({
      theme: "dark",
      defaultTone: "firm",
      payLink: false,
    });
  });

  it("falls back field by field on bad values", () => {
    expect(parsePrefs(JSON.stringify({ theme: "purple", defaultTone: "rude", payLink: "yes" }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ theme: "auto", defaultTone: 3 }))).toEqual({ ...DEFAULT_PREFS, theme: "auto" });
    for (const raw of ["not json", "[]", "null", "42", '"dark"']) expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });
});

describe("readPrefs / writePrefs", () => {
  it("round-trips and merges a patch with what's saved", () => {
    const s = memory();
    expect(writePrefs(s, { theme: "dark" })).toEqual({ ...DEFAULT_PREFS, theme: "dark" });
    expect(writePrefs(s, { payLink: false })).toEqual({ ...DEFAULT_PREFS, theme: "dark", payLink: false });
    expect(readPrefs(s)).toEqual({ ...DEFAULT_PREFS, theme: "dark", payLink: false });
    expect(JSON.parse(s.data[PREFS_KEY])).toEqual({ theme: "dark", defaultTone: "friendly", payLink: false });
  });

  it("doesn't save bad values", () => {
    const s = memory();
    // @ts-expect-error: a bad value from outside the types
    expect(writePrefs(s, { theme: "neon" })?.theme).toBe("light");
  });

  it("copes with no storage or storage that throws", () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(writePrefs(null, { theme: "dark" })).toBeNull();
    expect(readPrefs(throwing)).toEqual(DEFAULT_PREFS);
    expect(writePrefs(throwing, { theme: "dark" })).toBeNull();
  });
});

describe("resolveTheme", () => {
  it("light and dark are fixed; auto follows the device", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });
});

describe("THEME_SCRIPT", () => {
  function run(stored: string | null, throws = false) {
    const attrs: Record<string, string> = {};
    const localStorage = {
      getItem: () => {
        if (throws) throw new Error("blocked");
        return stored;
      },
    };
    const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    new Function("localStorage", "document", THEME_SCRIPT)(localStorage, document);
    return attrs["data-theme"];
  }

  it("sets data-theme from the saved choice, light otherwise", () => {
    expect(run(JSON.stringify({ theme: "dark" }))).toBe("dark");
    expect(run(JSON.stringify({ theme: "auto" }))).toBe("auto");
    expect(run(JSON.stringify({ theme: "<script>" }))).toBe("light");
    expect(run(null)).toBe("light");
    expect(run("{bad")).toBe("light");
    expect(run(null, true)).toBe("light");
  });
});
