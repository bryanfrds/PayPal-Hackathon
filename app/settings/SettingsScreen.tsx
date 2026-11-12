"use client";

// Settings: the shop's profile, theme, WhatsApp message defaults, demo data and Sign out.
// Each choice saves straight away and shows a small "Saved" note.
// Mock: "555 Buku - WhatsApp and Settings Mock.html", phones 3 and 4 (the language row and
// picker come in a later PR).

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { resetDemoData } from "@/lib/demo-reset";
import { initials } from "@/lib/home";
import { languageInfo } from "@/lib/i18n";
import { THEME_CHOICES } from "@/lib/preferences";
import { TONES } from "@/lib/share";
import { BackIcon, BellIcon, ChatIcon, CheckIcon, ChevronIcon, LinkIcon, PlayIcon, ResetIcon, SignOutIcon } from "../components/icons";
import { requestTourReplay } from "../components/tourReplay";
import { useDebts } from "../useDebts";
import { usePrefs } from "../usePrefs";
import { useReminders } from "../useReminders";
import { MAX_SHOP_NAME, SHOP_TYPES, shopTypeLabel, useShop, type ShopType } from "../useShop";
import { useSignOut, type Me } from "../useSignOut";
import { useT } from "../useT";
import { takeFlash } from "./flash";


function ThemePicture({ choice }: { choice: (typeof THEME_CHOICES)[number] }) {
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
  const { t } = useT();
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

  // Back from the language picker: show its "Saved" note here.
  useEffect(() => {
    const text = takeFlash();
    if (text) setToast({ text, n: 1 });
  }, []);

  // The "Saved" note hides itself after a moment.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function saved(ok: boolean, text = t("common.saved")) {
    if (ok) {
      setError(null);
      setToast((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    } else {
      setError(t("settings.saveFailed"));
    }
  }

  function doReset() {
    let ok = true;
    try {
      ok = resetDemoData(window.localStorage, window.sessionStorage);
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
    saved(ok, t("settings.resetDone"));
    // The Reset button comes back on the next render.
    window.setTimeout(() => resetButton.current?.focus(), 0);
  }

  // The Edit button comes back on the next render, after the form closes.
  function focusEdit() {
    window.setTimeout(() => editButton.current?.focus(), 0);
  }

  const reminderSummary = !rules.on
    ? t("settings.rulesOff")
    : t("settings.rulesSummary", {
        first: t("settings.days", { count: rules.firstAfterDays }),
        every: t("settings.days", { count: rules.everyDays }),
      });

  return (
    <div className="settings">
      <div className="tab-top">
        <Link href="/" className="tab-back set-back" aria-label={t("settings.backHome")}>
          <BackIcon />
        </Link>
        <h1>{t("settings.title")}</h1>
        <span className="tab-back set-back-space" aria-hidden="true" />
      </div>

      <section className="card set-profile" aria-label={t("settings.profile")}>
        <span className="set-pav" aria-hidden="true">
          {initials(name)}
        </span>
        {editing ? (
          <ProfileForm
            name={name}
            type={shop?.type ?? "Kedai runcit"}
            onCancel={() => {
              setEditing(false);
              focusEdit();
            }}
            onSave={(next) => {
              const ok = saveShop(next);
              saved(ok);
              if (ok) {
                setEditing(false);
                focusEdit();
              }
              return ok;
            }}
          />
        ) : (
          <>
            <div className="set-profile-main">
              <h2>{name}</h2>
              <p>
                {shopTypeLabel(shop?.type ?? "Kedai runcit", t)}
                {me?.email ? ` · ${me.email}` : ""}
              </p>
              <span className="set-pill">
                <CheckIcon />
                {t("settings.paypalPill")}
              </span>
            </div>
            <button ref={editButton} type="button" className="set-edit" onClick={() => setEditing(true)}>
              {t("settings.edit")}
            </button>
          </>
        )}
      </section>

      <h2 className="set-label" id={`${ids}-theme`}>
        {t("settings.theme")}
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
              {t(`settings.theme.${choice}`)}
            </span>
          </label>
        ))}
      </div>
      <p className="set-hint">{t("settings.themeHint")}</p>

      <h2 className="set-label">{t("settings.language")}</h2>
      <div className="card set-group">
        <Link href="/settings/language" className="set-item set-item-link">
          <span className="set-ic set-ic-plain" aria-hidden="true">
            Aa
          </span>
          <span className="set-grow">
            {t("settings.appLanguage")}
            <small>{t("settings.appLanguageHint")}</small>
          </span>
          <span className="set-val" lang={languageInfo(prefs.language).htmlLang}>
            {languageInfo(prefs.language).name}
          </span>
          <ChevronIcon className="icon set-chev" />
        </Link>
      </div>

      <h2 className="set-label">{t("settings.messages")}</h2>
      <div className="card set-group">
        <div className="set-item set-item-stack">
          <span className="set-ic set-ic-wa" aria-hidden="true">
            <ChatIcon />
          </span>
          <span className="set-grow" id={`${ids}-tone`}>
            {t("settings.defaultTone")}
            <small>{t("settings.defaultToneHint")}</small>
          </span>
          <div className="set-tones" role="radiogroup" aria-labelledby={`${ids}-tone`}>
            {TONES.map((tn) => (
              <label key={tn.id} className="set-tone">
                <input
                  type="radio"
                  name={`${ids}-tone`}
                  value={tn.id}
                  checked={prefs.defaultTone === tn.id}
                  onChange={() => saved(setPrefs({ defaultTone: tn.id }))}
                />
                <span className="set-tone-tile">
                  <span aria-hidden="true">{tn.emoji} </span>
                  {t(`tone.${tn.id}`)}
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
            {t("settings.payLink")}
            <small>{t("settings.payLinkHint")}</small>
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
            {t("settings.reminderRules")}
            <small>{reminderSummary}</small>
          </span>
          <ChevronIcon className="icon set-chev" />
        </Link>
      </div>

      <h2 className="set-label">{t("settings.help")}</h2>
      <div className="card set-group">
        {/* Goes to Home, which starts the quick tour at step 1. */}
        <Link
          href="/"
          className="set-item set-item-link"
          onClick={(e) => {
            // Opening Home in a new tab doesn't start the tour here.
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) requestTourReplay();
          }}
        >
          <span className="set-ic set-ic-violet" aria-hidden="true">
            <PlayIcon />
          </span>
          <span className="set-grow">
            {t("settings.replayTour")}
            <small>{t("settings.replayTourHint")}</small>
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
            <b id={`${ids}-demo`}>{t("settings.demo")}</b>
            <small>{t("settings.demoHint")}</small>
          </span>
          {!confirmReset && (
            <button ref={resetButton} type="button" className="set-btn" onClick={() => setConfirmReset(true)}>
              {t("settings.reset")}
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
        {signingOut ? t("settings.signingOut") : t("settings.signOut")}
      </button>
      <p className="set-foot">{t("settings.footer")}</p>

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
  const { t } = useT();
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="set-confirm" role="group" aria-label={t("settings.confirmReset")}>
      <p>{t("settings.resetSure")}</p>
      <p className="set-confirm-sub">{t("settings.resetKeeps")}</p>
      <div className="set-confirm-btns">
        <button ref={cancelRef} type="button" className="set-btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="set-btn set-btn-danger" onClick={onReset}>
          {t("settings.reset")}
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
  const { t } = useT();

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = draftName.trim();
    if (!clean) {
      setNameError(t("settings.nameRequired"));
      nameRef.current?.focus();
      return;
    }
    if (clean.length > MAX_SHOP_NAME) {
      setNameError(t("settings.nameTooLong", { max: MAX_SHOP_NAME }));
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    onSave({ name: clean, type: draftType });
  }

  return (
    <form className="set-form" onSubmit={submit} noValidate>
      <label htmlFor={`${ids}-name`}>{t("settings.shopName")}</label>
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
      <label htmlFor={`${ids}-type`}>{t("settings.shopType")}</label>
      <select id={`${ids}-type`} value={draftType} onChange={(e) => setDraftType(e.target.value as ShopType)}>
        {SHOP_TYPES.map((st) => (
          <option key={st} value={st}>
            {shopTypeLabel(st, t)}
          </option>
        ))}
      </select>
      <div className="set-form-btns">
        <button type="button" className="set-btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="set-btn set-btn-primary">
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}
