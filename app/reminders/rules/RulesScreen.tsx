"use client";

import Link from "next/link";
import { useState } from "react";
import { ReminderStoreError } from "@/lib/reminder-store";
import { RULE_LIMITS, reminderMessage, type ReminderRules } from "@/lib/reminders";
import { BackIcon } from "../../components/icons";
import { useReminders } from "../../useReminders";
import { useT } from "../../useT";
import type { T, TKey } from "@/lib/i18n";

type NumberRule = keyof typeof RULE_LIMITS;

// Words are keys, read in the owner's language when drawn.
const STEPS: { key: NumberRule; label: TKey; hint?: TKey; unit: (n: number, t: T) => string }[] = [
  { key: "firstAfterDays", label: "rules.first", hint: "rules.firstHint", unit: (n, t) => t("rules.days", { count: n }) },
  { key: "everyDays", label: "rules.every", unit: (n, t) => t("rules.days", { count: n }) },
  { key: "maxCount", label: "rules.max", unit: (n, t) => t("rules.reminders", { count: n }) },
  { key: "sendHour", label: "rules.hour", unit: (h, t) => t(h < 12 ? "rules.am" : "rules.pm", { hour: h % 12 === 0 ? 12 : h % 12 }) },
];

export default function RulesScreen() {
  const { rules, setRules, clearMoves, moves } = useReminders();
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(next: ReminderRules) {
    try {
      setRules(next);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : t("rules.saveFailed"));
    }
  }

  function step(key: NumberRule, by: number) {
    const { min, max } = RULE_LIMITS[key];
    save({ ...rules, [key]: Math.min(max, Math.max(min, rules[key] + by)) });
  }

  const moved = Object.keys(moves).length;

  return (
    <div className="rules">
      <div className="tab-top">
        <Link href="/reminders" className="tab-back" aria-label={t("rules.back")}>
          <BackIcon />
        </Link>
        <h1>{t("rules.title")}</h1>
      </div>
      <p className="page-intro">{t("rules.intro")}</p>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {saved && !error ? t("common.saved") : ""}
      </p>

      <div className="card rules-card">
        <div className="rule-row">
          <span className="rule-label" id="rule-on">
            {t("rules.on")}
            <small>{t("rules.onHint")}</small>
          </span>
          <button type="button" role="switch" className="collect-switch" aria-checked={rules.on} aria-labelledby="rule-on" onClick={() => save({ ...rules, on: !rules.on })} />
        </div>

        {STEPS.map(({ key, label: labelKey, hint, unit }) => {
          const { min, max } = RULE_LIMITS[key];
          const label = t(labelKey);
          const value = rules[key];
          return (
            <div key={key} className="rule-row">
              <span className="rule-label" id={`rule-${key}`}>
                {label}
                {hint && <small>{t(hint)}</small>}
              </span>
              <span className="stepper" role="group" aria-labelledby={`rule-${key}`}>
                <button type="button" aria-label={t("rules.less", { label })} disabled={!rules.on || value <= min} onClick={() => step(key, -1)}>
                  −
                </button>
                <output aria-live="polite">{unit(value, t)}</output>
                <button type="button" aria-label={t("rules.more", { label })} disabled={!rules.on || value >= max} onClick={() => step(key, 1)}>
                  +
                </button>
              </span>
            </div>
          );
        })}

        <div className="rule-row">
          <span className="rule-label" id="rule-friday">
            {t("rules.friday")}
            <small>{t("rules.fridayHint")}</small>
          </span>
          <button
            type="button"
            role="switch"
            className="collect-switch"
            aria-checked={rules.skipFridayPrayers}
            aria-labelledby="rule-friday"
            disabled={!rules.on}
            onClick={() => save({ ...rules, skipFridayPrayers: !rules.skipFridayPrayers })}
          />
        </div>
      </div>

      <div className="rules-preview">
        <p className="rules-preview-label">{t("rules.preview")}</p>
        <p>{reminderMessage("Mak Cik Siti", 4850, undefined, t)}</p>
      </div>

      {moved > 0 && (
        <button
          type="button"
          className="button"
          onClick={() => {
            try {
              clearMoves();
            } catch (e) {
              setError(e instanceof ReminderStoreError ? e.message : t("rules.saveFailed"));
            }
          }}
        >
          {t("rules.putBack", { count: moved })}
        </button>
      )}
    </div>
  );
}
