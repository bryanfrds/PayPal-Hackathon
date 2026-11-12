// Asks the server to have PayPal email a reminder about one invoice, and sorts the answer
// into sent, maybe sent, or refused. Anything unclear counts as maybe sent: a customer missing
// one reminder is better than getting the same one twice.

export type EmailOutcome = { kind: "sent" } | { kind: "maybe"; message: string } | { kind: "refused"; message: string };

const TIMEOUT_MS = 20_000;

export async function remindByEmail(invoiceId: string, fetchImpl: typeof fetch = fetch): Promise<EmailOutcome> {
  // AbortController rather than AbortSignal.timeout, which older iPhone Safari lacks.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`/api/invoices/${encodeURIComponent(invoiceId)}/remind`, { method: "POST", signal: controller.signal });
    const body = (await res.json().catch(() => null)) as { error?: string; maybeSent?: boolean; alreadySent?: boolean } | null;
    if (res.ok) return { kind: "sent" };
    if (body?.alreadySent) return { kind: "maybe", message: body.error ?? "PayPal emailed this reminder recently." };
    // No readable answer from a server error (e.g. a platform timeout): PayPal may have sent it.
    if (body?.maybeSent || (!body && res.status >= 500)) {
      return { kind: "maybe", message: body?.error ?? "No clear answer from the server, so the reminder may have gone out." };
    }
    return { kind: "refused", message: body?.error ?? "PayPal couldn't send the reminder. Try again." };
  } catch {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { kind: "refused", message: "You're offline, so no reminder was sent. Try again once you're connected." };
    }
    return { kind: "maybe", message: "Lost touch with the server, so the reminder may have gone out." };
  } finally {
    clearTimeout(timer);
  }
}
