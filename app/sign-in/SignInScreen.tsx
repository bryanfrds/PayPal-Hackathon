"use client";

// Sign-in for the shop owner: "Log in with PayPal", or an emailed 6-character code. After the
// first sign-in on a device, one screen to name the shop. Customers never see this: their tab
// links stay open. Mock: "555 Buku - Sign-in Mock.html".

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CODE_LENGTH, OWNER_CODE_LENGTH, safeNext, tidyCode } from "@/lib/auth";
import { initials } from "@/lib/home";
import { BackIcon, BellIcon, CheckIcon, MailIcon, ScanIcon, SendIcon } from "../components/icons";
import { DEFAULT_SHOP_NAME, MAX_SHOP_NAME, SHOP_TYPES, useShop, type ShopType } from "../useShop";

type Step = "welcome" | "email" | "code" | "shop";

const ERRORS: Record<string, string> = {
  "paypal-setup": "Log in with PayPal isn't set up yet. Use your email instead.",
  "paypal-cancelled": "PayPal login was cancelled. Try again, or use your email.",
  "paypal-state": "That PayPal login expired. Try again.",
  "paypal-email": "PayPal didn't share an email for this account. Use your email instead.",
  paypal: "PayPal login didn't work just now. Try again, or use your email.",
  setup: "Sign-in isn't set up on this server yet.",
  "not-owner": "That PayPal account isn't set up as this shop's owner. Use the owner's email instead.",
};

const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com"];

/** Reads the server's plain-English error, or a fallback. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // not JSON
  }
  return "Something went wrong. Try again.";
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
  return (
    <div className="si-peek" aria-hidden="true">
      <div className="si-float si-float-owed">
        <span className="si-float-k">Still owed to you</span>
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
          Ah Hock paid
          <small>on PayPal · just now</small>
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

  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => ERRORS[params.get("error") ?? ""] ?? null);
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
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
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
      setError("You seem to be offline. Check your connection and try again.");
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
      setError("You seem to be offline. Check your connection and try again.");
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
            <h1 className="si-headline">Your buku 555, collected through PayPal.</h1>
            <p className="si-lede">Scan the notebook, send PayPal invoices, see who&apos;s paid.</p>
            <ul className="si-feats">
              <li>
                <i aria-hidden="true">
                  <ScanIcon />
                </i>
                Scan a page of your notebook
              </li>
              <li>
                <i aria-hidden="true">
                  <SendIcon />
                </i>
                Send PayPal invoices in one go
              </li>
              <li>
                <i aria-hidden="true">
                  <BellIcon />
                </i>
                Friendly reminders, written for you
              </li>
            </ul>
            <Peek />
          </section>
          <section className="si-sheet" aria-labelledby="si-ways">
            <h2 id="si-ways" className="si-sheet-title">
              Sign in to your shop
            </h2>
            {error && (
              <p className="si-error" role="alert" id="si-err">
                {error}
              </p>
            )}
            {/* Stand-in for PayPal's official Log in with PayPal button. */}
            <a className="si-paypal" href={`/api/auth/paypal/start?next=${encodeURIComponent(next)}`}>
              Log in with PayPal
            </a>
            <p className="si-or">or</p>
            <button
              type="button"
              className="si-btn si-btn-light"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              <MailIcon />
              Continue with email
            </button>
            <p className="si-fine">Customers don&apos;t need an account. They pay from the link you send.</p>
          </section>
        </>
      )}

      {step === "email" && (
        <form className="si-form" onSubmit={sendCode}>
          <button type="button" className="si-back" aria-label="Back" onClick={() => setStep("welcome")}>
            <BackIcon />
          </button>
          <h1 ref={titleRef} tabIndex={-1}>
            What&apos;s your email?
          </h1>
          <p className="si-sub">We&apos;ll send a 6-character code. No password to remember.</p>
          <label className="si-field">
            <span>Email</span>
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
            <div className="si-chips" aria-label="Finish the email">
              {DOMAINS.map((d) => (
                <button key={d} type="button" onClick={() => setEmail(`${email}${d}`)}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="si-error" role="alert" id="si-err">
              {error}
            </p>
          )}
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send code"}
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
          <button type="button" className="si-back" aria-label="Back" onClick={() => setStep("email")}>
            <BackIcon />
          </button>
          <h1 ref={titleRef} tabIndex={-1}>
            Check your email
          </h1>
          <p className="si-sub">
            We sent a code to <b>{email}</b>. It works for 10 minutes.
          </p>
          {/* One real input under the drawn boxes (6, or 12 for an owner code), so the phone can fill the code from the email. */}
          <label className="si-code">
            <span className="visually-hidden">Sign-in code</span>
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
              {error}
            </p>
          )}
          <p className="si-resend">
            Didn&apos;t get it?{" "}
            {resendIn > 0 ? (
              <>Send again in 0:{String(resendIn).padStart(2, "0")}</>
            ) : (
              <button type="button" className="link-button" onClick={() => void sendCode()} disabled={busy}>
                Send again
              </button>
            )}
          </p>
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={busy || !codeReady}>
            {busy ? "Checking…" : "Sign in"}
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
              setError("This browser isn't saving data (private mode), so the shop name won't be kept.");
            }
            router.replace(next);
            router.refresh();
          }}
        >
          <h1 ref={titleRef} tabIndex={-1}>
            Set up your shop
          </h1>
          <p className="si-sub">This is what customers see on their invoice and their tab.</p>
          <div className="si-preview" aria-hidden="true">
            <span className="si-preview-av">{initials(shopName.trim() || "Shop")}</span>
            <span>
              <small>Invoice from</small>
              {shopName.trim() || "Your shop"}
            </span>
          </div>
          <label className="si-field">
            <span>Shop name</span>
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
            <legend>Type of shop</legend>
            {SHOP_TYPES.map((t) => (
              <label key={t} className={t === shopType ? "on" : undefined}>
                <input type="radio" name="shop-type" checked={t === shopType} onChange={() => setShopType(t)} />
                {t}
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="si-error" role="alert" id="si-err">
              {error}
            </p>
          )}
          <div className="si-grow" />
          <button type="submit" className="si-btn" disabled={!shopName.trim()}>
            Open my buku
          </button>
        </form>
      )}
    </div>
  );
}
