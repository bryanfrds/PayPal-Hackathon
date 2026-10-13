"use client";

import Link from "next/link";
import { useState } from "react";
import { ReminderStoreError } from "@/lib/reminder-store";
import { RULE_LIMITS, reminderMessage, type ReminderRules } from "@/lib/reminders";
import { BackIcon } from "../../components/icons";
import { useReminders } from "../../useReminders";

type NumberRule = keyof typeof RULE_LIMITS;

const STEPS: { key: NumberRule; label: string; hint?: string; unit: (n: number) => string }[] = [
  { key: "firstAfterDays", label: "First reminder", hint: "after the bill is due", unit: (n) => `${n} ${n === 1 ? "day" : "days"}` },
  { key: "everyDays", label: "Then every", unit: (n) => `${n} ${n === 1 ? "day" : "days"}` },
  { key: "maxCount", label: "Stop after", unit: (n) => `${n} ${n === 1 ? "reminder" : "reminders"}` },
  { key: "sendHour", label: "Send at", unit: (h) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}` },
];

export default function RulesScreen() {
  const { rules, setRules, clearMoves, moves } = useReminders();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(next: ReminderRules) {
    try {
      setRules(next);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ReminderStoreError ? e.message : "Couldn't save. Try again.");
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
        <Link href="/reminders" className="tab-back" aria-label="Back to Reminders">
          <BackIcon />
        </Link>
        <h1>Reminder rules</h1>
      </div>
      <p className="page-intro">Set them once and the schedule fills itself in. Changes save straight away.</p>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {saved && !error ? "Saved" : ""}
      </p>

      <div className="card rules-card">
        <div className="rule-row">
          <span className="rule-label" id="rule-on">
            Send reminders
            <small>Only for tabs with a PayPal invoice</small>
          </span>
          <button type="button" role="switch" className="collect-switch" aria-checked={rules.on} aria-labelledby="rule-on" onClick={() => save({ ...rules, on: !rules.on })} />
        </div>

        {STEPS.map(({ key, label, hint, unit }) => {
          const { min, max } = RULE_LIMITS[key];
          const value = rules[key];
          return (
            <div key={key} className="rule-row">
              <span className="rule-label" id={`rule-${key}`}>
                {label}
                {hint && <small>{hint}</small>}
              </span>
              <span className="stepper" role="group" aria-labelledby={`rule-${key}`}>
                <button type="button" aria-label={`Less: ${label}`} disabled={!rules.on || value <= min} onClick={() => step(key, -1)}>
                  −
                </button>
                <output aria-live="polite">{unit(value)}</output>
                <button type="button" aria-label={`More: ${label}`} disabled={!rules.on || value >= max} onClick={() => step(key, 1)}>
                  +
                </button>
              </span>
            </div>
          );
        })}

        <div className="rule-row">
          <span className="rule-label" id="rule-friday">
            Skip Friday 12–3pm
            <small>Moves Friday prayers reminders to 3pm</small>
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
        <p className="rules-preview-label">Preview</p>
        <p>{reminderMessage("Mak Cik Siti", 4850)}</p>
      </div>

      {moved > 0 && (
        <button
          type="button"
          className="button"
          onClick={() => {
            try {
              clearMoves();
            } catch (e) {
              setError(e instanceof ReminderStoreError ? e.message : "Couldn't save. Try again.");
            }
          }}
        >
          Put {moved} moved {moved === 1 ? "reminder" : "reminders"} back on schedule
        </button>
      )}
    </div>
  );
}
