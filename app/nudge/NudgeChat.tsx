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
import { buildSchedule } from "@/lib/reminders";
import { BackIcon, ChatIcon, SendIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useReminders } from "../useReminders";

const SHOP_NAME = "Kedai Ah Seng";

const SUGGESTIONS = ["Who should I remind today?", "Draft reminders for the overdue ones", "Summarise this month"];

type Draft = { ok: true; slug: string; name: string; owedSen: number; message: string } | { ok: false; error: string };

function whatsAppLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The server's plain-English error, or a fallback. */
function errorText(error: Error | undefined): string {
  if (!error) return "";
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // not JSON
  }
  return "Nudge couldn't answer just now. Try again in a moment.";
}

export default function NudgeChat() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent } = useReminders();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const today = todayLocal();
  const context = useMemo<NudgeContext>(() => {
    const schedule = buildSchedule(debts, invoices, rules, moves, today, sent);
    return buildNudgeContext(SHOP_NAME, debts, invoices, schedule, today);
  }, [debts, invoices, rules, moves, sent, today]);
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
        <Link href="/insights" className="tab-back" aria-label="Back to Insights">
          <BackIcon />
        </Link>
        <h1>Nudge</h1>
        {messages.length > 0 ? (
          <button type="button" className="link-button nudge-new" onClick={() => setMessages([])} disabled={busy}>
            New chat
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
              Hi! I&apos;m Nudge. I know who owes you and how late they are
              {ready ? ` (${context.customers.length} ${context.customers.length === 1 ? "customer" : "customers"}, RM ${formatSen(context.owedSen)} in total)` : ""}. I can
              tell you who to remind and write friendly reminders. You send them.
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
                      That draft didn't work. Ask again.
                    </p>
                  );
                }
                if (part.state !== "output-available") {
                  // Still being written, unless the reply stopped or failed part-way.
                  return busy ? (
                    <p key={key} className="nudge-working">
                      Writing a reminder…
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
                      To {draft.name} · RM {formatSen(draft.owedSen)}
                    </p>
                    <p className="nudge-draft-text">{draft.message}</p>
                    {link && <p className="nudge-draft-link">+ their PayPal pay link</p>}
                    <a className="button button-primary nudge-draft-send" href={whatsAppLink(text)} target="_blank" rel="noopener noreferrer" aria-label={`Send to ${draft.name} on WhatsApp`}>
                      <ChatIcon />
                      Send on WhatsApp
                    </a>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}

        {status === "submitted" && <p className="nudge-working">Nudge is thinking…</p>}
        {error && (
          <p className="notice notice-error" role="alert">
            {errorText(error)}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {messages.length === 0 && (
        <div className="nudge-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={!ready || busy}>
              {s}
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
          Ask Nudge
        </label>
        <input
          id="nudge-input"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder="Ask Nudge about your tabs…"
          onChange={(event) => setInput(event.target.value)}
          disabled={!ready}
        />
        <button type="submit" aria-label="Send" disabled={!ready || busy || !input.trim()}>
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
