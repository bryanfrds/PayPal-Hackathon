"use client";

// Sign-in for the shop owner: "Log in with PayPal", or an emailed 6-character code. After the
// first sign-in on a device, one screen to name the shop. Customers never see this: their tab
// links stay open. Mock: "555 Buku - Sign-in Mock.html".

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CODE_LENGTH, OWNER_CODE_LENGTH, safeNext, tidyCode } from "@/lib/auth";
import { initials } from "@/lib/home";
import type { TKey } from "@/lib/i18n";
import { BackIcon, BellIcon, CheckIcon, MailIcon, ScanIcon, SendIcon } from "../components/icons";
import { DEFAULT_SHOP_NAME, MAX_SHOP_NAME, SHOP_TYPES, useShop, type ShopType } from "../useShop";
import { useT } from "../useT";

type Step = "welcome" | "email" | "code" | "shop";

/** The ?error= codes the PayPal login sends back, as translation keys. */
const ERRORS: Record<string, TKey> = {
  "paypal-setup": "signin.error.paypalSetup",
  "paypal-cancelled": "signin.error.paypalCancelled",
  "paypal-state": "signin.error.paypalState",
  "paypal-email": "signin.error.paypalEmail",
  paypal: "signin.error.paypal",
  setup: "signin.error.setup",
  "not-owner": "signin.error.notOwner",
};

/** An error to show: one of ours (translated when shown) or the server's own words. */
type ErrorMsg = { key: TKey } | { text: string };

const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com"];

/** Reads the server's plain-English error (shown as it is), or a fallback. */
async function errorFrom(res: Response): Promise<ErrorMsg> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return { text: body.error };
  } catch {
    // not JSON
  }
  return { key: "common.tryAgain" };
}

function Brand() {
  return (
    <div className="si-brand">
      <span className="si-mark" aria-hidden="true">
        <span>555</span>
      </span>
      555 Buku
    </div>
  );
}

/** The two cards from Home, as a peek at the app. Decorative. */
function Peek() {
  const { t } = useT();
  return (
    <div className="si-peek" aria-hidden="true">
      <div className="si-float si-float-owed">
        <span className="si-float-k">{t("home.stillOwed")}</span>
        <span className="si-float-v">RM 197.10</span>
        <span className="si-float-meter">
          <b />
          <b className="si-float-late" />
        </span>
      </div>
      <div className="si-float si-float-paid">
        <i>
          <CheckIcon />
        </i>
        <span>
          {t("signin.peekPaid", { name: "Ah Hock" })}
          <small>{t("signin.peekWhen")}</small>
        </span>
      </div>
    </div>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { shop, ready: shopReady, saveShop } = useShop();
  const { t } = useT();

  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMsg | null>(() => {
    const key = ERRORS[params.get("error") ?? ""];
    return key ? { key } : null;
  });
  const errorText = error ? ("key" in error ? t(error.key) : error.text) : null;
  const [resendIn, setResendIn] = useState(0);
  const [shopName, setShopName] = useState(DEFAULT_SHOP_NAME);
  const [shopType, setShopType] = useState<ShopType>("Kedai runcit");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus the field to fill (so the phone keyboard opens), else the step's heading.
  useEffect(() => {
    if (step === "email") emailRef.current?.focus();
    else if (step === "code") codeRef.current?.focus();
    else if (step !== "welcome") titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function finish() {
    // First sign-in on this device: name the shop. Otherwise straight in.
    if (shopReady && !shop) {
      setStep("shop");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        return;
      }
      const body = (await res.json()) as { email: string; resendAfter: number };
      setEmail(body.email);
      setCode("");
      setResendIn(body.resendAfter);
      setStep("code");
    } catch {
      setError({ key: "signin.error.offline" });
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      if (!res.ok) {
        setError(await errorFrom(res));
        setCode("");
        codeRef.current?.focus();
        return;
      }
      finish();
    } catch {
      setError({ key: "signin.error.offline" });
    } finally {
      setBusy(false);
    }
  }

  // Emailed codes are 6 characters; an owner's private code is 12. A 6-character code that
  // arrives in one go (pasted or filled from the email) signs in straight away; typed by hand,
  // the owner taps Sign in, so typing a 12-character code doesn't stop halfway.
  function onCode(value: string) {
    const typed = tidyCode(value).replace(/[^A-Z0-9]/g, "").slice(0, OWNER_CODE_LENGTH);
    const filled = typed.length - code.length > 1;
    setCode(typed);
    if (busy) return;
    if (typed.length === OWNER_CODE_LENGTH || (typed.length === CODE_LENGTH && filled)) void verify(typed);
  }

  const codeReady = code.length === CODE_LENGTH || code.length === OWNER_CODE_LENGTH;
  const boxes = code.length > CODE_LENGTH ? OWNER_CODE_LENGTH : CODE_LENGTH;

  const atDomain = email.includes("@") ? email.split("@")[1] : null;

  return (
    <div className={`si si-${step}`}>
      {step === "welcome" && (
        <>
          <section className="si-hero">
            <Brand />
            <h1 className="si-headline">{t("signin.headline")}</h1>
            <p className="si-lede">{t("signin.lede")}</p>
            <ul className="si-feats">
              <li>
                <i aria-hidden="true">
                  <ScanIcon />
                </i>
                {t("signin.featScan")}
              </li>
              <li>
                <i aria-hidden="true">
                  <SendIcon />
                </i>
                {t("signin.featSend")}
              </li>
              <li>
                <i aria-hidden="true">
                  <BellIcon />
                </i>
                {t("signin.featRemind")}
              </li>
            </ul>
            <Peek />
          </section>
          <section className="si-sheet" aria-labelledby="si-ways">
            <h2 id="si-ways" className="si-sheet-title">
              {t("signin.title")}
            </h2>
            {error && (
              <p className="si-error" role="alert" id="si-err">
                {errorText}
              </p>
            )}
            {/* Stand-in for PayPal's official Log in with PayPal button. */}
            <a className="si-paypal" href={`/api/auth/paypal/start?next=${encodeURIComponent(next)}`}>
              {t("signin.paypal")}
            </a>
            <p className="si-or">{t("signin.or")}</p>
            <button
              type="button"
              className="si-btn si-btn-light"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              <MailIcon />
              {t("signin.withEmail")}
            </button>
            <p className="si-fine">{t("signin.customersFine")}</p>
          </section>
        </>
      )}

      {step === "email" && (
        <form className="si-form" onSubmit={sendCode}>
          <button type="button" className="si-back" aria-label={t("common.back")} onClick={() => setStep("welcome")}>
            <BackIcon />
          </button>
          <h1 ref={titleRef} tabIndex={-1}>
            {t("signin.emailTitle")}
          </h1>
          <p className="si-sub">{t("signin.emailSub")}</p>
          <label className="si-field">
            <span>{t("signin.email")}</span>
            <span className="si-field-row">
              <MailIcon />
              <input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "si-err" : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </span>
          </label>
          {atDomain !== null && atDomain === "" && (
            <div className="si-chips" aria-label={t("signin.finishEmail")}>
              {DOMAINS.map((d) => (
                <button key={d} type="button" onClick={() => setEmail(`${email}${d}`)}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="si-error" role="alert" id="si-err">
              {errorText}
            </p>
          )}
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={busy || !email.trim()}>
            {busy ? t("signin.sending") : t("signin.sendCode")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form
          className="si-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeReady) void verify(code);
          }}
        >
          <button type="button" className="si-back" aria-label={t("common.back")} onClick={() => setStep("email")}>
            <BackIcon />
          </button>
          <h1 ref={titleRef} tabIndex={-1}>
            {t("signin.codeTitle")}
          </h1>
          <p className="si-sub">
            {t("signin.sentTo")} <b>{email}</b>. {t("signin.codeLasts")}
          </p>
          {/* One real input under the drawn boxes (6, or 12 for an owner code), so the phone can fill the code from the email. */}
          <label className="si-code">
            <span className="visually-hidden">{t("signin.codeLabel")}</span>
            <input
              ref={codeRef}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={OWNER_CODE_LENGTH + 4}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "si-err" : undefined}
              value={code}
              onChange={(e) => onCode(e.target.value)}
              // Read-only (not disabled) while checking, so it keeps focus for the next try.
              readOnly={busy}
            />
            <span className={boxes > CODE_LENGTH ? "si-code-boxes long" : "si-code-boxes"} aria-hidden="true">
              {Array.from({ length: boxes }, (_, i) => (
                <span key={i} className={i === code.length && !busy ? "on" : undefined}>
                  {code[i] ?? ""}
                </span>
              ))}
            </span>
          </label>
          {error && (
            <p className="si-error" role="alert" id="si-err">
              {errorText}
            </p>
          )}
          <p className="si-resend">
            {t("signin.didntGet")}{" "}
            {resendIn > 0 ? (
              <>{t("signin.resendIn", { time: `0:${String(resendIn).padStart(2, "0")}` })}</>
            ) : (
              <button type="button" className="link-button" onClick={() => void sendCode()} disabled={busy}>
                {t("signin.resend")}
              </button>
            )}
          </p>
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={busy || !codeReady}>
            {busy ? t("signin.checking") : t("signin.signIn")}
          </button>
        </form>
      )}

      {step === "shop" && (
        <form
          className="si-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shopName.trim()) return;
            if (!saveShop({ name: shopName, type: shopType })) {
              setError({ key: "signin.error.noStorage" });
            }
            router.replace(next);
            router.refresh();
          }}
        >
          <h1 ref={titleRef} tabIndex={-1}>
            {t("signin.shopTitle")}
          </h1>
          <p className="si-sub">{t("signin.shopSub")}</p>
          <div className="si-preview" aria-hidden="true">
            <span className="si-preview-av">{initials(shopName.trim() || t("signin.shopFallback"))}</span>
            <span>
              <small>{t("signin.invoiceFrom")}</small>
              {shopName.trim() || t("signin.yourShop")}
            </span>
          </div>
          <label className="si-field">
            <span>{t("signin.shopName")}</span>
            <span className="si-field-row">
              <input
                required
                maxLength={MAX_SHOP_NAME}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
              />
            </span>
          </label>
          <fieldset className="si-types">
            <legend>{t("signin.shopType")}</legend>
            {SHOP_TYPES.map((type) => (
              <label key={type} className={type === shopType ? "on" : undefined}>
                <input type="radio" name="shop-type" checked={type === shopType} onChange={() => setShopType(type)} />
                {type}
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="si-error" role="alert" id="si-err">
              {errorText}
            </p>
          )}
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={!shopName.trim()}>
            {t("signin.open")}
          </button>
        </form>
      )}
    </div>
  );
}
