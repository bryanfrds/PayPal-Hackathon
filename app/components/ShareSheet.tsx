"use client";

// "Send on WhatsApp": a preview of the message the customer will get, three tones, Copy, and
// a link that opens WhatsApp with the text filled in. A bottom sheet on phones, a centred
// dialog on laptops. Mock: "555 Buku - WhatsApp and Settings Mock.html", phone 2.
//
// No phone numbers are stored, so WhatsApp asks the owner who to send it to.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { customerSlug } from "@/lib/customer-tab";
import { formatSen, todayLocal } from "@/lib/debts";
import { lateLabel, owedBoard } from "@/lib/home";
import { languageInfo, LANGUAGES, translate, type Language } from "@/lib/i18n";
import { buildShareMessage, chooseLink, payLinkFor, TONES, unpaidItems, whatsappUrl, type Tone } from "@/lib/share";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { usePrefs } from "../usePrefs";
import { useT } from "../useT";
import { useShop } from "../useShop";
import Avatar from "./Avatar";
import { ChatIcon, CloseIcon, CopyIcon, LinkIcon } from "./icons";

/** WhatsApp's *bold* shown as bold, the way the customer will see it. */
function withBold(text: string): ReactNode[] {
  return text.split(/\*([^*]+)\*/g).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

export default function ShareSheet({
  slug,
  onClose,
  returnFocusTo,
}: {
  slug: string;
  onClose: () => void;
  /** The button that opened the sheet; focus goes back to it on close. */
  returnFocusTo?: HTMLElement | null;
}) {
  const { debts } = useDebts();
  const { invoices } = useCollect();
  const { name: shopName } = useShop();
  const { prefs } = usePrefs();
  const { t, lang, formatDay } = useT();
  // Starts on the owner's default tone from Settings, and in the app's language.
  const [tone, setTone] = useState<Tone>(prefs.defaultTone);
  const [msgLang, setMsgLang] = useState<Language>(lang);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const today = todayLocal();

  const row = useMemo(() => owedBoard(debts, today).find((r) => r.slug === slug), [debts, today, slug]);
  const mine = useMemo(() => debts.filter((d) => d.status !== "paid" && customerSlug(d.customerName) === slug), [debts, slug]);
  const lookup = useMemo(() => payLinkFor(invoices, debts, slug), [invoices, debts, slug]);
  const { pay, note } = chooseLink(lookup, prefs.payLink, t);
  const since = mine.reduce((min, d) => (d.date < min ? d.date : min), mine[0]?.date ?? today);
  const message = row
    ? buildShareMessage({ customerName: row.customerName, shopName, owedSen: row.owedSen, items: unpaidItems(mine), tone, pay, language: msgLang })
    : null;

  // Focus moves in, stays in, Escape closes, and focus goes back to the opener afterwards.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(".share-tone[aria-pressed='true']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !sheet) return;
      const items = [...sheet.querySelectorAll<HTMLElement>("button, a[href], select")].filter((el) => !el.hasAttribute("disabled"));
      const first = items[0];
      const last = items[items.length - 1];
      if (!sheet.contains(document.activeElement)) {
        e.preventDefault();
        first?.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [returnFocusTo]);

  // Paid off in another tab while open: nothing left to send.
  useEffect(() => {
    if (debts.length > 0 && !row) onCloseRef.current();
  }, [debts.length, row]);

  if (!row || !message) return null;

  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  function pickTone(next: Tone) {
    setTone(next);
    setCopied("idle");
  }

  const late = row.status === "overdue";

  return createPortal(
    <div className="share-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="share-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="share-grab" aria-hidden="true" />
        <button type="button" className="share-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>

        <div className="share-who">
          <Avatar name={row.customerName} />
          <div className="share-who-main">
            <h2 id={titleId}>
              <span className="visually-hidden">{t("share.title")} </span>
              {row.customerName}
            </h2>
            <p>
              {t("share.items", { count: mine.length, date: formatDay(since, { year: false }) })}
            </p>
          </div>
          <div className="share-owed">
            <b>RM {formatSen(row.owedSen)}</b>
            <span className={late ? "share-late" : undefined}>{lateLabel(row, t)}</span>
          </div>
        </div>

        <figure className="share-preview">
          <figcaption className="share-preview-top">
            <Avatar name={row.customerName} className="avatar share-preview-av" />
            <span>
              {row.customerName}
              <small>{t("share.preview")}</small>
            </span>
          </figcaption>
          <div className="share-preview-body">
            <div className="share-bubble" lang={languageInfo(msgLang).htmlLang}>
              <p>{withBold(message.intro)}</p>
              {message.link && (
                <p>
                  {message.payLine}
                  <span className="share-paylink">
                    <span className="share-paylink-ic" aria-hidden="true">
                      <LinkIcon />
                    </span>
                    <span>
                      {/* The invoice's own amount: it can be less than the whole tab. */}
                      <b>{translate(msgLang, "msg.payCard", { amount: `RM ${formatSen(message.linkSen ?? 0)}` })}</b>
                      <small>{message.link.replace(/^https:\/\//, "")}</small>
                    </span>
                  </span>
                </p>
              )}
              <p>{message.closing}</p>
            </div>
          </div>
        </figure>

        {!message.link && note && <p className="share-note">{note}</p>}

        <div className="share-label-row">
          <p className="share-label" id={`${titleId}-tone`}>
            {t("share.tone")}
          </p>
          {/* The message can go out in another language than the app's. */}
          <label className="share-lang">
            <span className="visually-hidden">{t("share.messageLanguage")}</span>
            <select value={msgLang} onChange={(e) => { setMsgLang(e.target.value as Language); setCopied("idle"); }}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="share-tones" role="group" aria-labelledby={`${titleId}-tone`}>
          {TONES.map((tn) => (
            <button
              key={tn.id}
              type="button"
              className="share-tone"
              aria-pressed={tone === tn.id}
              onClick={() => pickTone(tn.id)}
            >
              <span aria-hidden="true">{tn.emoji} </span>
              {t(`tone.${tn.id}`)}
              <small>{t(`tone.${tn.id}.hint`)}</small>
            </button>
          ))}
        </div>

        <div className="share-btns">
          <button type="button" className="share-copy" onClick={copy} aria-label={t("share.copy")}>
            <CopyIcon />
            {copied !== "idle" && <span>{copied === "done" ? t("share.copied") : t("share.copyFailed")}</span>}
          </button>
          <a className="share-send" href={whatsappUrl(message.text)} target="_blank" rel="noopener noreferrer">
            <ChatIcon />
            {t("share.send")}
          </a>
        </div>
        <p className="visually-hidden" role="status">
          {copied === "done" ? t("share.copiedStatus") : copied === "failed" ? t("share.copyFailedStatus") : ""}
        </p>
      </div>
    </div>,
    document.body,
  );
}
