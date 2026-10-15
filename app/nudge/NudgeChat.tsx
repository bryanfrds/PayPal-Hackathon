"use client";

// Chat with Nudge, the reminder assistant. It reads a summary of the ledger, answers questions
// and drafts reminders; the owner sends each draft on WhatsApp. See app/api/nudge/route.ts.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPayPalUrl } from "@/lib/customer-pay";
import { formatSen, todayLocal } from "@/lib/debts";
import { MAX_MESSAGE_CHARS, buildNudgeContext, type NudgeContext } from "@/lib/nudge";
import type { T } from "@/lib/i18n";
import { buildSchedule } from "@/lib/reminders";
import { BackIcon, ChatIcon, SendIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useReminders } from "../useReminders";
import { useShop } from "../useShop";
import { useT } from "../useT";


const SUGGESTIONS = ["nudge.suggest.remind", "nudge.suggest.drafts", "nudge.suggest.month"] as const;

type Draft = { ok: true; slug: string; name: string; owedSen: number; message: string } | { ok: false; error: string };

function whatsAppLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The server's plain-English error (left as it comes), or a fallback in the app's language. */
function errorText(error: Error | undefined, t: T): string {
  if (!error) return "";
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // not JSON
  }
  return t("nudge.errorFallback");
}

export default function NudgeChat() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent } = useReminders();
  const { name: shopName } = useShop();
  const { t } = useT();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const today = todayLocal();
  const context = useMemo<NudgeContext>(() => {
    const schedule = buildSchedule(debts, invoices, rules, moves, today, sent);
    return buildNudgeContext(shopName, debts, invoices, schedule, today);
  }, [shopName, debts, invoices, rules, moves, sent, today]);
  // The transport reads the latest summary when each message goes out.
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/nudge", body: () => ({ context: contextRef.current }) }), []);
  const { messages, sendMessage, status, error, setMessages, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  const payLinks = useMemo(() => {
    const links = new Map<string, string>();
    for (const inv of invoices) if (inv.payerLink && isPayPalUrl(inv.payerLink) && !links.has(inv.slug)) links.set(inv.slug, inv.payerLink);
    return links;
  }, [invoices]);

  // Follow new messages, unless the owner has scrolled up to read something. Whether they're
  // following is decided when they scroll, so a tall draft card arriving doesn't switch it off.
  const following = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (following.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    void sendMessage({ text: trimmed.slice(0, MAX_MESSAGE_CHARS) });
    setInput("");
  }

  return (
    <div className="nudge">
      <div className="tab-top">
        <Link href="/insights" className="tab-back" aria-label={t("nudge.backAria")}>
          <BackIcon />
        </Link>
        <h1>Nudge</h1>
        {messages.length > 0 ? (
          <button type="button" className="link-button nudge-new" onClick={() => setMessages([])} disabled={busy}>
            {t("nudge.newChat")}
          </button>
        ) : (
          <span className="nudge-new" aria-hidden="true" />
        )}
      </div>

      {/* Busy while a reply streams in, so screen readers don't read every word as it lands. */}
      <div className="nudge-log" aria-busy={busy} aria-live="polite">
        {messages.length === 0 && (
          <div className="nudge-hello">
            <p>
              {t("nudge.hello", {
                summary: ready ? t("nudge.helloSummary", { count: context.customers.length, amount: `RM ${formatSen(context.owedSen)}` }) : "",
              })}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "nudge-me" : "nudge-bot"}>
            {message.parts.map((part, i) => {
              const key = `${message.id}-${i}`;
              if (part.type === "text") return <p key={key}>{part.text}</p>;
              if (part.type === "tool-draft_reminder") {
                if (part.state === "output-error") {
                  return (
                    <p key={key} className="nudge-working">
                      {t("nudge.draftBroke")}
                    </p>
                  );
                }
                if (part.state !== "output-available") {
                  // Still being written, unless the reply stopped or failed part-way.
                  return busy ? (
                    <p key={key} className="nudge-working">
                      {t("nudge.writing")}
                    </p>
                  ) : null;
                }
                const draft = part.output as Draft;
                if (!draft.ok) return null;
                const link = payLinks.get(draft.slug);
                const text = link ? `${draft.message} ${link}` : draft.message;
                return (
                  <div key={key} className="nudge-draft">
                    <p className="nudge-draft-to">
                      {t("nudge.draftTo", { name: draft.name, amount: `RM ${formatSen(draft.owedSen)}` })}
                    </p>
                    <p className="nudge-draft-text">{draft.message}</p>
                    {link && <p className="nudge-draft-link">{t("nudge.payLink")}</p>}
                    <a className="button button-primary nudge-draft-send" href={whatsAppLink(text)} target="_blank" rel="noopener noreferrer" aria-label={t("nudge.sendWhatsAppAria", { name: draft.name })}>
                      <ChatIcon />
                      {t("nudge.sendWhatsApp")}
                    </a>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}

        {status === "submitted" && <p className="nudge-working">{t("nudge.thinking")}</p>}
        {error && (
          <p className="notice notice-error" role="alert">
            {errorText(error, t)}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {messages.length === 0 && (
        <div className="nudge-suggest">
          {SUGGESTIONS.map((key) => (
            <button key={key} type="button" className="chip" onClick={() => send(t(key))} disabled={!ready || busy}>
              {t(key)}
            </button>
          ))}
        </div>
      )}

      <form
        className="nudge-ask"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="nudge-input" className="visually-hidden">
          {t("insights.askNudge")}
        </label>
        <input
          id="nudge-input"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={t("nudge.inputPlaceholder")}
          onChange={(event) => setInput(event.target.value)}
          disabled={!ready}
        />
        <button type="submit" aria-label={t("nudge.send")} disabled={!ready || busy || !input.trim()}>
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
