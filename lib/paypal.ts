/**
 * PayPal REST client for the Invoicing v2 API (sandbox while we build).
 *
 * Server-only: it reads PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from the
 * environment. Import it from route handlers, server actions and scripts,
 * never from a "use client" component.
 *
 * Errors never include the client secret, the Basic auth header or the
 * access token; every message is passed through redact() first.
 */

export type PayPalConfig = {
  apiBase: string;
  clientId: string;
  clientSecret: string;
  currency: string;
};

export type PayPalDeps = {
  fetch?: typeof fetch;
  now?: () => number;
};

/** One line on the invoice. `amount` is in major units, e.g. 5 means RM5.00. */
export type InvoiceItem = {
  name: string;
  amount: number;
};

export type CreateDraftInvoiceInput = {
  recipientEmail: string;
  recipientName: string;
  items: InvoiceItem[];
  /**
   * Idempotency key (PayPal-Request-Id). Pass a stable value, such as our own
   * order id, so a retried create does not make a second invoice. If omitted,
   * a random one is generated per call.
   */
  requestId?: string;
};

export type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

export type PayPalInvoice = {
  id: string;
  status?: string;
  invoice_number?: string;
  links?: PayPalLink[];
};

export type PayPalClient = {
  getAccessToken: () => Promise<string>;
  createDraftInvoice: (input: CreateDraftInvoiceInput) => Promise<PayPalInvoice>;
  sendInvoice: (invoiceId: string) => Promise<void>;
  getInvoice: (invoiceId: string) => Promise<PayPalInvoice>;
};

export const DEFAULT_PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";
export const DEFAULT_PAYPAL_CURRENCY = "MYR";

// Refresh the token this long before PayPal says it expires.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class PayPalError extends Error {
  readonly status: number | null;
  readonly paypalName: string | null;
  readonly debugId: string | null;

  constructor(
    message: string,
    options: { status?: number | null; paypalName?: string | null; debugId?: string | null } = {},
  ) {
    super(message);
    this.name = "PayPalError";
    this.status = options.status ?? null;
    this.paypalName = options.paypalName ?? null;
    this.debugId = options.debugId ?? null;
  }
}

/**
 * Reads config from the environment. Throws a clear error naming the missing
 * variable (never its value).
 */
export function readPayPalConfigFromEnv(env: Record<string, string | undefined> = process.env): PayPalConfig {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();

  if (!clientId) {
    throw new PayPalError(
      "PAYPAL_CLIENT_ID is not set. Copy .env.example to .env.local and add your sandbox keys.",
    );
  }
  if (!clientSecret) {
    throw new PayPalError(
      "PAYPAL_CLIENT_SECRET is not set. Copy .env.example to .env.local and add your sandbox keys.",
    );
  }

  return {
    apiBase: (env.PAYPAL_API_BASE?.trim() || DEFAULT_PAYPAL_API_BASE).replace(/\/+$/, ""),
    clientId,
    clientSecret,
    currency: env.PAYPAL_CURRENCY?.trim().toUpperCase() || DEFAULT_PAYPAL_CURRENCY,
  };
}

/** Replaces every secret-bearing string in a message with [redacted]. */
function redact(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Turns an amount in RM (number) into PayPal's "5.00" string. Rejects sub-cent values. */
function toMoneyString(amount: number, label: string): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PayPalError(`${label} must be a positive number, got ${String(amount)}.`);
  }
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6) {
    throw new PayPalError(`${label} can have at most 2 decimal places, got ${String(amount)}.`);
  }
  return (cents / 100).toFixed(2);
}

function validateDraftInput(input: CreateDraftInvoiceInput): void {
  if (!input.recipientEmail.includes("@")) {
    throw new PayPalError("Recipient email looks invalid.");
  }
  if (!input.recipientName.trim()) {
    throw new PayPalError("Recipient name is required.");
  }
  if (input.items.length === 0) {
    throw new PayPalError("An invoice needs at least one item.");
  }
  for (const item of input.items) {
    if (!item.name.trim()) {
      throw new PayPalError("Every invoice item needs a name.");
    }
  }
}

/** Creates a PayPal client with its own token cache. Tests pass fetch and now. */
export function createPayPalClient(config: PayPalConfig, deps: PayPalDeps = {}): PayPalClient {
  const doFetch: typeof fetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;

  let cachedToken: { value: string; expiresAt: number } | null = null;
  let pendingToken: Promise<string> | null = null;

  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const secretsToRedact = (): Array<string | null> => [
    config.clientSecret,
    basicAuth,
    cachedToken?.value ?? null,
  ];

  function failureMessage(operation: string, status: number, body: unknown): PayPalError {
    const record = asRecord(body);
    const name = typeof record?.name === "string" ? record.name : null;
    const detail = typeof record?.message === "string" ? record.message : null;
    const debugId = typeof record?.debug_id === "string" ? record.debug_id : null;
    const details = Array.isArray(record?.details)
      ? record.details
          .map((d) => asRecord(d)?.issue)
          .filter((issue): issue is string => typeof issue === "string")
          .join("; ")
      : "";

    const parts = [`PayPal ${operation} failed (HTTP ${status}${name ? `, ${name}` : ""})`];
    if (detail) parts.push(`: ${detail}`);
    if (details) parts.push(` (${details})`);
    if (debugId) parts.push(` [debug_id ${debugId}]`);

    return new PayPalError(redact(parts.join(""), secretsToRedact()), {
      status,
      paypalName: name,
      debugId,
    });
  }

  async function fetchAccessToken(): Promise<string> {
    const url = `${config.apiBase}/v1/oauth2/token`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
    } catch (err) {
      throw new PayPalError(
        redact(`Could not reach PayPal at ${config.apiBase} to get a token: ${errorText(err)}`, secretsToRedact()),
      );
    }

    const body = parseJson(await res.text());
    if (!res.ok) {
      const record = asRecord(body);
      const reason = typeof record?.error_description === "string" ? record.error_description : null;
      throw new PayPalError(
        redact(
          `PayPal rejected the sandbox keys (HTTP ${res.status})${reason ? `: ${reason}` : ""}. ` +
            "Check that PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET come from the same sandbox app.",
          secretsToRedact(),
        ),
        { status: res.status },
      );
    }

    const record = asRecord(body);
    const token = record?.access_token;
    const expiresIn = record?.expires_in;
    if (typeof token !== "string" || typeof expiresIn !== "number") {
      throw new PayPalError("PayPal token response was missing access_token or expires_in.", {
        status: res.status,
      });
    }

    cachedToken = {
      value: token,
      expiresAt: now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return token;
  }

  async function getAccessToken(): Promise<string> {
    if (cachedToken && now() < cachedToken.expiresAt) {
      return cachedToken.value;
    }
    // Share one in-flight request between concurrent callers.
    pendingToken ??= fetchAccessToken().finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  async function request<T>(
    operation: string,
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; idempotent?: boolean; requestId?: string; prefer?: string } = {},
  ): Promise<T | undefined> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.prefer) headers.Prefer = options.prefer;
    if (options.idempotent) {
      headers["PayPal-Request-Id"] = options.requestId ?? globalThis.crypto.randomUUID();
    }

    const url = `${config.apiBase}${path}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (err) {
      throw new PayPalError(
        redact(`Could not reach PayPal at ${config.apiBase} during ${operation}: ${errorText(err)}`, secretsToRedact()),
      );
    }

    const text = await res.text();
    const body = parseJson(text);

    if (res.status === 401) {
      // Token was revoked or expired early: drop it so the next call fetches a new one.
      cachedToken = null;
    }
    if (!res.ok) {
      throw failureMessage(operation, res.status, body);
    }
    return body as T | undefined;
  }

  async function createDraftInvoice(input: CreateDraftInvoiceInput): Promise<PayPalInvoice> {
    validateDraftInput(input);

    const body = {
      detail: {
        currency_code: config.currency,
      },
      primary_recipients: [
        {
          billing_info: {
            email_address: input.recipientEmail,
            name: { full_name: input.recipientName },
          },
        },
      ],
      items: input.items.map((item) => ({
        name: item.name,
        quantity: "1",
        unit_amount: {
          currency_code: config.currency,
          value: toMoneyString(item.amount, `Amount for "${item.name}"`),
        },
      })),
    };

    // Prefer asks PayPal to send the full invoice back. If it still sends only a
    // HATEOAS link, the id is the last segment of the self link.
    const response = await request<PayPalInvoice | PayPalLink>("createDraftInvoice", "POST", "/v2/invoicing/invoices", {
      body,
      idempotent: true,
      requestId: input.requestId,
      prefer: "return=representation",
    });
    const id = invoiceIdFromCreateResponse(response);
    if (!id) {
      throw new PayPalError("PayPal created the invoice but did not return an invoice id.");
    }
    return isInvoice(response) ? response : { id, links: [] };
  }

  async function sendInvoice(invoiceId: string): Promise<void> {
    await request<unknown>(
      "sendInvoice",
      "POST",
      `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
      {
        body: { send_to_recipient: true, send_to_invoicer: false },
        idempotent: true,
      },
    );
  }

  async function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
    const invoice = await request<PayPalInvoice>(
      "getInvoice",
      "GET",
      `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    );
    if (!invoice || typeof invoice.id !== "string") {
      throw new PayPalError(`PayPal returned no invoice for id ${invoiceId}.`);
    }
    return invoice;
  }

  return { getAccessToken, createDraftInvoice, sendInvoice, getInvoice };
}

function isInvoice(value: unknown): value is PayPalInvoice {
  const record = asRecord(value);
  return typeof record?.id === "string" && record.id.length > 0;
}

/** Gets the invoice id from a create response: the body id, else the last segment of the self link. */
function invoiceIdFromCreateResponse(value: unknown): string | undefined {
  if (isInvoice(value)) return value.id;
  const record = asRecord(value);
  if (record?.rel !== "self" || typeof record.href !== "string") return undefined;
  const path = record.href.split(/[?#]/)[0].replace(/\/+$/, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  return last || undefined;
}

/** Returns the link a payer opens to view and pay the invoice, if PayPal gave one. */
export function getPayerLink(invoice: PayPalInvoice): string | undefined {
  return invoice.links?.find((link) => link.rel === "payer-view")?.href;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Default client for app code: reads env on first use, so importing this module
// never throws when keys are missing.
let defaultClient: PayPalClient | undefined;

function getDefaultClient(): PayPalClient {
  if (typeof window !== "undefined") {
    throw new PayPalError("lib/paypal.ts is server-only and cannot run in the browser.");
  }
  defaultClient ??= createPayPalClient(readPayPalConfigFromEnv());
  return defaultClient;
}

export function getAccessToken(): Promise<string> {
  return getDefaultClient().getAccessToken();
}

export function createDraftInvoice(input: CreateDraftInvoiceInput): Promise<PayPalInvoice> {
  return getDefaultClient().createDraftInvoice(input);
}

export function sendInvoice(invoiceId: string): Promise<void> {
  return getDefaultClient().sendInvoice(invoiceId);
}

export function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
  return getDefaultClient().getInvoice(invoiceId);
}
