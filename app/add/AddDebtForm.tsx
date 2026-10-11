"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DebtStoreError, newDebtId } from "@/lib/debt-store";
import {
  createManualDebt,
  MAX_ITEM_LENGTH,
  MAX_NAME_LENGTH,
  todayLocal,
  validateDebtInput,
  type DebtErrors,
  type DebtField,
  type DebtInput,
} from "@/lib/debts";
import { useDebts } from "../useDebts";

export default function AddDebtForm() {
  const router = useRouter();
  const { add, ready } = useDebts();
  const [today] = useState(() => todayLocal());
  const [input, setInput] = useState<DebtInput>(() => ({ customerName: "", item: "", amount: "", date: todayLocal() }));
  const [errors, setErrors] = useState<DebtErrors>({});
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
    const result = validateDebtInput(input, today);
    if (!result.ok) {
      setErrors(result.errors);
      const first = (["customerName", "amount", "date", "item"] as const).find((f) => result.errors[f]);
      if (first) document.getElementById(`debt-${first}`)?.focus();
      return;
    }
    setSaving(true);
    const debt = createManualDebt(result.value, { id: newDebtId(), now: new Date() });
    try {
      add(debt);
    } catch (error) {
      // The form keeps everything typed, so the owner can just try again.
      setSaveError(error instanceof DebtStoreError ? error.message : "Couldn't save. Try again.");
      setSaving(false);
      return;
    }
    router.push(`/ledger?added=${encodeURIComponent(debt.id)}`);
  }

  const describedBy = (field: DebtField, hint?: string) =>
    [hint, errors[field] ? `debt-${field}-error` : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      {saveError && (
        <p className="notice notice-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="field">
        <label htmlFor="debt-customerName">Customer name</label>
        <input
          id="debt-customerName"
          name="customerName"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={MAX_NAME_LENGTH + 20}
          placeholder="e.g. Ah Seng"
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
          What they took <span className="optional">(optional)</span>
        </label>
        <input
          id="debt-item"
          name="item"
          autoComplete="off"
          maxLength={MAX_ITEM_LENGTH + 20}
          placeholder="e.g. Milo 1kg, gula 1kg"
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
          <label htmlFor="debt-amount">Amount (RM)</label>
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
          <label htmlFor="debt-date">Date</label>
          <input
            id="debt-date"
            name="date"
            type="date"
            max={today}
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
        <button type="submit" className="button button-primary" disabled={!ready || saving}>
          {saving ? "Saving…" : "Save debt"}
        </button>
        <Link href="/ledger" className="button">
          Cancel
        </Link>
      </div>
    </form>
  );
}
