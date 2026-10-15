"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DebtStoreError, newDebtId } from "@/lib/debt-store";
import {
  createManualDebt,
  formDefaults,
  MAX_ITEM_LENGTH,
  MAX_NAME_LENGTH,
  todayLocal,
  validateDebtInput,
  type DebtErrors,
  type DebtField,
  type DebtInput,
} from "@/lib/debts";
import { useDebts } from "../useDebts";
import { useT } from "../useT";

/** The page heading and intro, in the owner's language. */
export function AddDebtIntro() {
  const { t } = useT();
  return (
    <>
      <h1 className="page-title">{t("add.title")}</h1>
      <p className="page-intro">{t("add.intro")}</p>
    </>
  );
}

export default function AddDebtForm() {
  const { t } = useT();
  const router = useRouter();
  const { add, ready } = useDebts();
  // The page is built ahead of time, so "today" must come from the owner's browser after
  // it loads, never from the build. It's read again on submit, for a form left open
  // past midnight.
  const [today, setToday] = useState<string | null>(null);
  const [input, setInput] = useState<DebtInput>({ customerName: "", item: "", amount: "", date: "" });
  const [errors, setErrors] = useState<DebtErrors>({});
  // Bumped on each failed submit; focus moves once the messages are on screen.
  const [focusRequest, setFocusRequest] = useState(0);
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  useEffect(() => {
    const defaults = formDefaults();
    setToday(defaults.date);
    setInput((prev) => (prev.date ? prev : { ...prev, date: defaults.date }));
  }, []);

  useEffect(() => {
    if (focusRequest === 0) return;
    const first = (["customerName", "item", "amount", "date"] as const).find((f) => errorsRef.current[f]);
    if (first) document.getElementById(`debt-${first}`)?.focus();
  }, [focusRequest]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(field: DebtField, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }));
    // Clear a field's message as soon as it's edited; it's re-checked on submit.
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    const now = todayLocal();
    setToday(now);
    const result = validateDebtInput(input, now, t);
    if (!result.ok) {
      setErrors(result.errors);
      setFocusRequest((n) => n + 1);
      return;
    }
    setSaving(true);
    const debt = createManualDebt(result.value, { id: newDebtId(), now: new Date() });
    try {
      add(debt);
    } catch (error) {
      // The form keeps everything typed, so the owner can just try again.
      setSaveError(error instanceof DebtStoreError ? error.message : t("add.saveFailed"));
      setSaving(false);
      return;
    }
    router.push(`/ledger?added=${encodeURIComponent(debt.id)}`);
  }

  const describedBy = (field: DebtField, hint?: string) =>
    [hint, errors[field] ? `debt-${field}-error` : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      {Object.values(errors).some(Boolean) && (
        <p className="visually-hidden" role="alert">
          {t("add.fieldsNeedFixing", { count: Object.values(errors).filter(Boolean).length })}
        </p>
      )}

      {saveError && (
        <p className="notice notice-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="field">
        <label htmlFor="debt-customerName">{t("add.customerName")}</label>
        <input
          id="debt-customerName"
          name="customerName"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={MAX_NAME_LENGTH + 20}
          placeholder={t("add.namePlaceholder")}
          value={input.customerName}
          onChange={(e) => set("customerName", e.target.value)}
          aria-invalid={Boolean(errors.customerName)}
          aria-describedby={describedBy("customerName")}
        />
        {errors.customerName && (
          <p className="field-error" id="debt-customerName-error">
            {errors.customerName}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="debt-item">
          {t("add.item")} <span className="optional">{t("add.optional")}</span>
        </label>
        <input
          id="debt-item"
          name="item"
          autoComplete="off"
          maxLength={MAX_ITEM_LENGTH + 20}
          placeholder={t("add.itemPlaceholder")}
          value={input.item}
          onChange={(e) => set("item", e.target.value)}
          aria-invalid={Boolean(errors.item)}
          aria-describedby={describedBy("item")}
        />
        {errors.item && (
          <p className="field-error" id="debt-item-error">
            {errors.item}
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="debt-amount">{t("add.amount")}</label>
          <input
            id="debt-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="12.50"
            value={input.amount}
            onChange={(e) => set("amount", e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={describedBy("amount")}
          />
          {errors.amount && (
            <p className="field-error" id="debt-amount-error">
              {errors.amount}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="debt-date">{t("add.date")}</label>
          <input
            id="debt-date"
            name="date"
            type="date"
            max={today ?? undefined}
            value={input.date}
            onChange={(e) => set("date", e.target.value)}
            aria-invalid={Boolean(errors.date)}
            aria-describedby={describedBy("date")}
          />
          {errors.date && (
            <p className="field-error" id="debt-date-error">
              {errors.date}
            </p>
          )}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={!ready || !today || saving}>
          {saving ? t("add.saving") : t("add.save")}
        </button>
        <Link href="/ledger" className="button">
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
