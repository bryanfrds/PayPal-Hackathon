import { describe, expect, it, vi } from "vitest";
import {
  createPayPalClient,
  getPayerLink,
  PayPalError,
  readPayPalConfigFromEnv,
  type PayPalConfig,
} from "./paypal";

const API_BASE = "https://api-m.sandbox.paypal.com";
const CONFIG: PayPalConfig = {
  apiBase: API_BASE,
  clientId: "test-client-id",
  clientSecret: "super-secret-value-123",
  currency: "MYR",
};
const BASIC = Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString("base64");

type Call = { url: string; init: RequestInit };
type Responder = (call: Call) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(token = "token-abc", expiresIn = 32400): Response {
  return json({ access_token: token, expires_in: expiresIn, token_type: "Bearer" });
}

/** Builds a fake fetch that records calls and answers each one with the responder. */
function fakeFetch(responder: Responder) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("getAccessToken", () => {
  it("posts client credentials with Basic auth and a form body", async () => {
    const { fetchImpl, calls } = fakeFetch(() => tokenResponse());
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await expect(client.getAccessToken()).resolves.toBe("token-abc");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_BASE}/v1/oauth2/token`);
    expect(calls[0].init.method).toBe("POST");
    expect(headerOf(calls[0].init, "Authorization")).toBe(`Basic ${BASIC}`);
    expect(headerOf(calls[0].init, "Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(calls[0].init.body).toBe("grant_type=client_credentials");
  });

  it("caches the token until it is close to expiry", async () => {
    let clock = 0;
    const { fetchImpl, calls } = fakeFetch(() => tokenResponse("token-abc", 3600));
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => clock });

    await client.getAccessToken();
    clock = 1_000;
    await client.getAccessToken();
    expect(calls).toHaveLength(1);

    // 3600s minus the 60s safety margin: 3540s in, the token is refreshed.
    clock = 3_540_000;
    await client.getAccessToken();
    expect(calls).toHaveLength(2);
  });

  it("shares one token request between concurrent callers", async () => {
    const { fetchImpl, calls } = fakeFetch(() => tokenResponse());
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const [a, b, c] = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]);

    expect([a, b, c]).toEqual(["token-abc", "token-abc", "token-abc"]);
    expect(calls).toHaveLength(1);
  });

  it("fails with a clear message that does not contain the secret", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ error: "invalid_client", error_description: "Client Authentication failed" }, 401),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const error = await client.getAccessToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect((error as PayPalError).message).toContain("HTTP 401");
    expect((error as PayPalError).message).toContain("PAYPAL_CLIENT_SECRET");
    expect((error as PayPalError).message).not.toContain(CONFIG.clientSecret);
    expect((error as PayPalError).message).not.toContain(BASIC);
  });

  it("redacts the secret if PayPal echoes it back in an error", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ error: "invalid_client", error_description: `bad secret ${CONFIG.clientSecret}` }, 401),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const error = await client.getAccessToken().catch((e: unknown) => e);

    expect((error as PayPalError).message).toContain("[redacted]");
    expect((error as PayPalError).message).not.toContain(CONFIG.clientSecret);
  });

  it("reports network failures without leaking credentials", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${CONFIG.clientSecret}`);
    }) as unknown as typeof fetch;
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const error = await client.getAccessToken().catch((e: unknown) => e);

    expect((error as PayPalError).message).toContain(`Could not reach PayPal at ${API_BASE}`);
    expect((error as PayPalError).message).not.toContain(CONFIG.clientSecret);
  });
});

describe("createDraftInvoice", () => {
  it("sends the expected Invoicing v2 request shape", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token")
        ? tokenResponse()
        : json({ id: "INV2-TEST-1", status: "DRAFT" }, 201),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const invoice = await client.createDraftInvoice({
      recipientEmail: "buyer@example.com",
      recipientName: "Mak Cik Siti",
      items: [{ name: "Kopi O x2", amount: 5 }],
    });

    expect(invoice).toEqual({ id: "INV2-TEST-1", status: "DRAFT" });
    const create = calls[1];
    expect(create.url).toBe(`${API_BASE}/v2/invoicing/invoices`);
    expect(create.init.method).toBe("POST");
    expect(headerOf(create.init, "Authorization")).toBe("Bearer token-abc");
    expect(headerOf(create.init, "Content-Type")).toBe("application/json");
    expect(headerOf(create.init, "PayPal-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    expect(JSON.parse(create.init.body as string)).toEqual({
      detail: { currency_code: "MYR" },
      primary_recipients: [
        {
          billing_info: {
            email_address: "buyer@example.com",
            name: { full_name: "Mak Cik Siti" },
          },
        },
      ],
      items: [
        {
          name: "Kopi O x2",
          quantity: "1",
          unit_amount: { currency_code: "MYR", value: "5.00" },
        },
      ],
    });
  });

  it("asks PayPal to return the full invoice on create", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json({ id: "INV2-PREFER" }, 201),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await client.createDraftInvoice({
      recipientEmail: "buyer@example.com",
      recipientName: "Ah Seng",
      items: [{ name: "Milo", amount: 3 }],
    });

    expect(headerOf(calls[1].init, "Prefer")).toBe("return=representation");
  });

  it("reads the invoice id from the self link when the create response is link-only", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token")
        ? tokenResponse()
        : json(
            {
              href: `${API_BASE}/v2/invoicing/invoices/INV2-LINK-ONLY?fields=all`,
              rel: "self",
              method: "GET",
            },
            201,
          ),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const invoice = await client.createDraftInvoice({
      recipientEmail: "buyer@example.com",
      recipientName: "Ah Seng",
      items: [{ name: "Milo", amount: 3 }],
    });

    expect(invoice.id).toBe("INV2-LINK-ONLY");
  });

  it("fails clearly when the create response has neither an id nor a self link", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json({ status: "DRAFT" }, 201),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await expect(
      client.createDraftInvoice({
        recipientEmail: "buyer@example.com",
        recipientName: "Ah Seng",
        items: [{ name: "Milo", amount: 3 }],
      }),
    ).rejects.toThrow(/did not return an invoice id/);
  });

  it("uses a caller-supplied requestId as the idempotency key", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json({ id: "INV2-KEY" }, 201),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await client.createDraftInvoice({
      recipientEmail: "buyer@example.com",
      recipientName: "Ah Seng",
      items: [{ name: "Milo", amount: 3 }],
      requestId: "order-42-create",
    });

    expect(headerOf(calls[1].init, "PayPal-Request-Id")).toBe("order-42-create");
  });

  it("uses the configured currency for detail and every item", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json({ id: "INV2-USD" }, 201),
    );
    const client = createPayPalClient({ ...CONFIG, currency: "USD" }, { fetch: fetchImpl, now: () => 0 });

    await client.createDraftInvoice({
      recipientEmail: "buyer@example.com",
      recipientName: "Ah Seng",
      items: [{ name: "Milo", amount: 12.5 }],
    });

    const body = JSON.parse(calls[1].init.body as string);
    expect(body.detail.currency_code).toBe("USD");
    expect(body.items[0].unit_amount).toEqual({ currency_code: "USD", value: "12.50" });
  });

  it("rejects amounts that are not positive or have more than 2 decimals", async () => {
    const { fetchImpl } = fakeFetch(() => tokenResponse());
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });
    const base = { recipientEmail: "buyer@example.com", recipientName: "Ah Seng" };

    await expect(client.createDraftInvoice({ ...base, items: [{ name: "x", amount: 0 }] })).rejects.toThrow(
      /positive number/,
    );
    await expect(client.createDraftInvoice({ ...base, items: [{ name: "x", amount: -1 }] })).rejects.toThrow(
      /positive number/,
    );
    await expect(client.createDraftInvoice({ ...base, items: [{ name: "x", amount: 5.005 }] })).rejects.toThrow(
      /2 decimal places/,
    );
  });

  it("does not call PayPal when the recipient is invalid", async () => {
    const { fetchImpl, calls } = fakeFetch(() => tokenResponse());
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await expect(
      client.createDraftInvoice({ recipientEmail: "not-an-email", recipientName: "x", items: [{ name: "x", amount: 1 }] }),
    ).rejects.toThrow(/email/);
    expect(calls).toHaveLength(0);
  });

  it("turns a PayPal error into a message with name, detail and debug id", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token")
        ? tokenResponse()
        : json(
            {
              name: "UNPROCESSABLE_ENTITY",
              message: "The requested action could not be performed.",
              debug_id: "dbg-123",
              details: [{ field: "/items/0", issue: "Currency not supported" }],
            },
            422,
          ),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const error = await client
      .createDraftInvoice({ recipientEmail: "buyer@example.com", recipientName: "x", items: [{ name: "x", amount: 1 }] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    const message = (error as PayPalError).message;
    expect(message).toContain("createDraftInvoice failed (HTTP 422, UNPROCESSABLE_ENTITY)");
    expect(message).toContain("Currency not supported");
    expect(message).toContain("dbg-123");
    expect(message).not.toContain(CONFIG.clientSecret);
    expect((error as PayPalError).status).toBe(422);
    expect((error as PayPalError).debugId).toBe("dbg-123");
  });

  it("redacts the access token from a 401 error message", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token")
        ? tokenResponse("token-secret-401")
        : json({ name: "AUTHENTICATION_FAILURE", message: "Token token-secret-401 is invalid" }, 401),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const error = await client
      .createDraftInvoice({ recipientEmail: "buyer@example.com", recipientName: "x", items: [{ name: "x", amount: 1 }] })
      .catch((e: unknown) => e);

    expect((error as PayPalError).message).toContain("[redacted]");
    expect((error as PayPalError).message).not.toContain("token-secret-401");
    expect((error as PayPalError).status).toBe(401);
  });

  it("drops the cached token on 401 so the next call fetches a new one", async () => {
    let tokenCount = 0;
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/v1/oauth2/token")) {
        tokenCount += 1;
        return tokenResponse(`token-${tokenCount}`);
      }
      return call.init.headers && headerOf(call.init, "Authorization") === "Bearer token-1"
        ? json({ name: "AUTHENTICATION_FAILURE" }, 401)
        : json({ id: "INV2-OK" }, 201);
    });
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });
    const input = { recipientEmail: "buyer@example.com", recipientName: "x", items: [{ name: "x", amount: 1 }] };

    await expect(client.createDraftInvoice(input)).rejects.toThrow(/401/);
    await expect(client.createDraftInvoice(input)).resolves.toEqual({ id: "INV2-OK" });

    expect(tokenCount).toBe(2);
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });
});

describe("sendInvoice and getInvoice", () => {
  it("sends the invoice to the recipient only", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : new Response(null, { status: 202 }),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await client.sendInvoice("INV2-TEST-1");

    const send = calls[1];
    expect(send.url).toBe(`${API_BASE}/v2/invoicing/invoices/INV2-TEST-1/send`);
    expect(send.init.method).toBe("POST");
    expect(JSON.parse(send.init.body as string)).toEqual({ send_to_recipient: true, send_to_invoicer: false });
  });

  it("returns the payer link from the documented 202 send response", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token")
        ? tokenResponse()
        : json(
            { href: "https://api-m.paypal.com/invoice/p#INV2-Z56S-5LLA-Q52L-CPZ5", rel: "payer-view", method: "GET" },
            202,
          ),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await expect(client.sendInvoice("INV2-Z56S-5LLA-Q52L-CPZ5")).resolves.toBe(
      "https://api-m.paypal.com/invoice/p#INV2-Z56S-5LLA-Q52L-CPZ5",
    );
  });

  it("returns undefined from send when the response has no body", async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : new Response(null, { status: 202 }),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    await expect(client.sendInvoice("INV2-TEST-1")).resolves.toBeUndefined();
  });

  it("fetches an invoice by id with GET, using the documented get-invoice shape", async () => {
    // Shape from PayPal's get-invoice example: no payer-view link in `links`;
    // the payer URL lives in detail.metadata.recipient_view_url.
    const invoice = {
      id: "INV2-Z56S-5LLA-Q52L-CPZ5",
      status: "SENT",
      detail: {
        invoice_number: "#123",
        currency_code: "MYR",
        metadata: {
          create_time: "2018-11-12T08:00:20Z",
          recipient_view_url: "https://www.api-m.paypal.com/invoice/p#Z56S5LLAQ52LCPZ5",
          invoicer_view_url: "https://www.api-m.paypal.com/invoice/details/INV2-Z56S-5LLA-Q52L-CPZ5",
        },
      },
      links: [
        { href: `${API_BASE}/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5`, rel: "self", method: "GET" },
        { href: `${API_BASE}/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5/send`, rel: "send", method: "POST" },
      ],
    };
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json(invoice),
    );
    const client = createPayPalClient(CONFIG, { fetch: fetchImpl, now: () => 0 });

    const result = await client.getInvoice("INV2-Z56S-5LLA-Q52L-CPZ5");

    expect(result).toEqual(invoice);
    expect(calls[1].url).toBe(`${API_BASE}/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5`);
    expect(calls[1].init.method).toBe("GET");
    expect(getPayerLink(result)).toBe("https://www.api-m.paypal.com/invoice/p#Z56S5LLAQ52LCPZ5");
  });

  it("falls back to a payer-view link when there is no metadata URL", () => {
    expect(
      getPayerLink({
        id: "INV2-X",
        links: [{ href: "https://www.sandbox.paypal.com/invoice/p/#INV2-X", rel: "payer-view", method: "GET" }],
      }),
    ).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-X");
  });

  it("prefers detail.metadata.recipient_view_url over a payer-view link", () => {
    expect(
      getPayerLink({
        id: "INV2-X",
        detail: { metadata: { recipient_view_url: "https://metadata.example/p" } },
        links: [{ href: "https://links.example/p", rel: "payer-view" }],
      }),
    ).toBe("https://metadata.example/p");
  });

  it("returns undefined for a payer link when PayPal gives none", () => {
    expect(getPayerLink({ id: "INV2-X" })).toBeUndefined();
  });
});

describe("readPayPalConfigFromEnv", () => {
  it("defaults to the sandbox API base and MYR", () => {
    const config = readPayPalConfigFromEnv({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec" });
    expect(config).toEqual({
      apiBase: "https://api-m.sandbox.paypal.com",
      clientId: "id",
      clientSecret: "sec",
      currency: "MYR",
    });
  });

  it("honours overrides and strips trailing slashes", () => {
    const config = readPayPalConfigFromEnv({
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "sec",
      PAYPAL_API_BASE: "https://example.test/",
      PAYPAL_CURRENCY: "usd",
    });
    expect(config.apiBase).toBe("https://example.test");
    expect(config.currency).toBe("USD");
  });

  it("names the missing variable without printing any value", () => {
    expect(() => readPayPalConfigFromEnv({ PAYPAL_CLIENT_SECRET: "sec" })).toThrow(/PAYPAL_CLIENT_ID is not set/);
    let message = "";
    try {
      readPayPalConfigFromEnv({ PAYPAL_CLIENT_ID: "client-id-value-XYZ" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/PAYPAL_CLIENT_SECRET is not set/);
    expect(message).not.toContain("client-id-value-XYZ");
  });
});
