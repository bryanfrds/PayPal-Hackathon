"use client";

// Settings: the shop's profile, theme, WhatsApp message defaults, demo data and Sign out.
// Each choice saves straight away and shows a small "Saved" note.
// Mock: "555 Buku - WhatsApp and Settings Mock.html", phones 3 and 4 (the language row and
// picker come in a later PR).

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { resetDemoData } from "@/lib/demo-reset";
import { initials } from "@/lib/home";
import { THEME_CHOICES, type ThemeChoice } from "@/lib/preferences";
import { TONES } from "@/lib/share";
import { BackIcon, BellIcon, ChatIcon, CheckIcon, ChevronIcon, LinkIcon, ResetIcon, SignOutIcon } from "../components/icons";
import { useDebts } from "../useDebts";
import { usePrefs } from "../usePrefs";
import { useReminders } from "../useReminders";
import { MAX_SHOP_NAME, SHOP_TYPES, useShop, type ShopType } from "../useShop";
import { useSignOut, type Me } from "../useSignOut";

const THEME_LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", auto: "Auto" };

const SAVE_FAILED = "Couldn't save on this device (private mode or storage blocked).";

function ThemePicture({ choice }: { choice: ThemeChoice }) {
  return (
    <span className={`set-mini set-mini-${choice}`} aria-hidden="true">
      {choice !== "auto" && (
        <>
          <b className="set-mini-t" />
          <b />
          <b />
          <b className="set-mini-n" />
        </>
      )}
    </span>
  );
}

export default function SettingsScreen() {
  const { shop, name, saveShop } = useShop();
  const { prefs, setPrefs } = usePrefs();
  const { rules } = useReminders();
  const { reset: resetDebts } = useDebts();
  const { signOut, busy: signingOut, error: signOutError } = useSignOut();
  const [me, setMe] = useState<Me | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ids = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((body) => {
        if (live) setMe(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The "Saved" note hides itself after a moment.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function saved(ok: boolean, text = "Saved") {
    if (ok) {
      setError(null);
      setToast((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    } else {
      setError(SAVE_FAILED);
    }
  }

  function doReset() {
    let ok = true;
    try {
      ok = resetDemoData(window.localStorage);
    } catch {
      ok = false; // storage blocked: the sample tabs still come back for this visit
    }
    try {
      resetDebts();
    } catch {
      ok = false;
    }
    // Tell every screen's store to re-read, the same signal another tab's change sends.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    setConfirmReset(false);
    saved(ok, "Sample tabs are back");
    // The Reset button comes back on the next render.
    window.setTimeout(() => resetButton.current?.focus(), 0);
  }

  const reminderSummary = !rules.on
    ? "Off"
    : `${rules.firstAfterDays} ${rules.firstAfterDays === 1 ? "day" : "days"} after due, every ${rules.everyDays} ${rules.everyDays === 1 ? "day" : "days"}`;

  return (
    <div className="settings">
      <div className="tab-top">
        <Link href="/" className="tab-back set-back" aria-label="Back to Home">
          <BackIcon />
        </Link>
        <h1>Settings</h1>
        <span className="tab-back set-back-space" aria-hidden="true" />
      </div>

      <section className="card set-profile" aria-label="Shop profile">
        <span className="set-pav" aria-hidden="true">
          {initials(name)}
        </span>
        {editing ? (
          <ProfileForm
            name={name}
            type={shop?.type ?? "Kedai runcit"}
            onCancel={() => {
              setEditing(false);
              editButton.current?.focus();
            }}
            onSave={(next) => {
              const ok = saveShop(next);
              saved(ok);
              if (ok) setEditing(false);
              return ok;
            }}
          />
        ) : (
          <>
            <div className="set-profile-main">
              <h2>{name}</h2>
              <p>
                {shop?.type ?? "Kedai runcit"}
                {me?.email ? ` · ${me.email}` : ""}
              </p>
              <span className="set-pill">
                <CheckIcon />
                PayPal sandbox
              </span>
            </div>
            <button ref={editButton} type="button" className="set-edit" onClick={() => setEditing(true)}>
              Edit
            </button>
          </>
        )}
      </section>

      <h2 className="set-label" id={`${ids}-theme`}>
        Theme
      </h2>
      <div className="card set-themes" role="radiogroup" aria-labelledby={`${ids}-theme`}>
        {THEME_CHOICES.map((choice) => (
          <label key={choice} className="set-theme">
            <input
              type="radio"
              name={`${ids}-theme`}
              value={choice}
              checked={prefs.theme === choice}
              onChange={() => saved(setPrefs({ theme: choice }))}
            />
            <ThemePicture choice={choice} />
            <span className="set-theme-name">
              <span className="set-radio" aria-hidden="true" />
              {THEME_LABEL[choice]}
            </span>
          </label>
        ))}
      </div>
      <p className="set-hint">Auto follows your phone or computer&apos;s light or dark setting.</p>

      <h2 className="set-label">Messages</h2>
      <div className="card set-group">
        <div className="set-item set-item-stack">
          <span className="set-ic set-ic-wa" aria-hidden="true">
            <ChatIcon />
          </span>
          <span className="set-grow" id={`${ids}-tone`}>
            Default tone
            <small>WhatsApp messages start on this tone</small>
          </span>
          <div className="set-tones" role="radiogroup" aria-labelledby={`${ids}-tone`}>
            {TONES.map((t) => (
              <label key={t.id} className="set-tone">
                <input
                  type="radio"
                  name={`${ids}-tone`}
                  value={t.id}
                  checked={prefs.defaultTone === t.id}
                  onChange={() => saved(setPrefs({ defaultTone: t.id }))}
                />
                <span className="set-tone-tile">
                  <span aria-hidden="true">{t.emoji} </span>
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="set-item">
          <span className="set-ic set-ic-blue" aria-hidden="true">
            <LinkIcon />
          </span>
          <span className="set-grow" id={`${ids}-link`}>
            Add PayPal pay link
            <small>When there&apos;s an invoice</small>
          </span>
          <button
            type="button"
            role="switch"
            className="set-toggle"
            aria-checked={prefs.payLink}
            aria-labelledby={`${ids}-link`}
            onClick={() => saved(setPrefs({ payLink: !prefs.payLink }))}
          />
        </div>
        <Link href="/reminders/rules" className="set-item set-item-link">
          <span className="set-ic set-ic-yellow" aria-hidden="true">
            <BellIcon />
          </span>
          <span className="set-grow">
            Reminder rules
            <small>{reminderSummary}</small>
          </span>
          <ChevronIcon className="icon set-chev" />
        </Link>
      </div>

      <section className="card set-demo" aria-labelledby={`${ids}-demo`}>
        <div className="set-demo-row">
          <span className="set-ic set-ic-violet" aria-hidden="true">
            <ResetIcon />
          </span>
          <span className="set-grow">
            <b id={`${ids}-demo`}>Demo data</b>
            <small>Put the sample customers back</small>
          </span>
          {!confirmReset && (
            <button ref={resetButton} type="button" className="set-btn" onClick={() => setConfirmReset(true)}>
              Reset
            </button>
          )}
        </div>
        {confirmReset && (
          <ResetConfirm
            onCancel={() => {
              setConfirmReset(false);
              // The Reset button comes back on the next render.
              window.setTimeout(() => resetButton.current?.focus(), 0);
            }}
            onReset={doReset}
          />
        )}
      </section>

      {(error || signOutError) && (
        <p className="si-error" role="alert">
          {error ?? signOutError}
        </p>
      )}

      <button type="button" className="set-signout" onClick={signOut} disabled={signingOut}>
        <SignOutIcon />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      <p className="set-foot">555 Buku · PayPal sandbox</p>

      <p className="set-toast-wrap" role="status" aria-live="polite">
        {toast && (
          <span key={toast.n} className="set-toast">
            <CheckIcon />
            {toast.text}
          </span>
        )}
      </p>
    </div>
  );
}

function ResetConfirm({ onCancel, onReset }: { onCancel: () => void; onReset: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="set-confirm" role="group" aria-label="Confirm reset">
      <p>Are you sure? This replaces everything on this device.</p>
      <p className="set-confirm-sub">Your sign-in, shop name and settings stay as they are.</p>
      <div className="set-confirm-btns">
        <button ref={cancelRef} type="button" className="set-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="set-btn set-btn-danger" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}

function ProfileForm({
  name,
  type,
  onCancel,
  onSave,
}: {
  name: string;
  type: ShopType;
  onCancel: () => void;
  onSave: (shop: { name: string; type: ShopType }) => boolean;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftType, setDraftType] = useState<ShopType>(type);
  const [nameError, setNameError] = useState<string | null>(null);
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = draftName.trim();
    if (!clean) {
      setNameError("Enter your shop's name.");
      nameRef.current?.focus();
      return;
    }
    if (clean.length > MAX_SHOP_NAME) {
      setNameError(`Keep it to ${MAX_SHOP_NAME} characters or fewer.`);
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    onSave({ name: clean, type: draftType });
  }

  return (
    <form className="set-form" onSubmit={submit} noValidate>
      <label htmlFor={`${ids}-name`}>Shop name</label>
      <input
        ref={nameRef}
        id={`${ids}-name`}
        value={draftName}
        maxLength={MAX_SHOP_NAME}
        autoComplete="organization"
        aria-invalid={nameError ? true : undefined}
        aria-describedby={nameError ? `${ids}-err` : undefined}
        onChange={(e) => setDraftName(e.target.value)}
      />
      {nameError && (
        <p className="set-field-error" id={`${ids}-err`}>
          {nameError}
        </p>
      )}
      <label htmlFor={`${ids}-type`}>Shop type</label>
      <select id={`${ids}-type`} value={draftType} onChange={(e) => setDraftType(e.target.value as ShopType)}>
        {SHOP_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="set-form-btns">
        <button type="button" className="set-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="set-btn set-btn-primary">
          Save
        </button>
      </div>
    </form>
  );
}
