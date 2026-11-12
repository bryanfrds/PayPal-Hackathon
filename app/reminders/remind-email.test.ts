import { describe, expect, it, vi } from "vitest";
import { remindByEmail } from "./remind-email";

function answer(status: number, body?: unknown) {
  return vi.fn(async () => new Response(body === undefined ? "<html>timeout</html>" : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("remindByEmail", () => {
  it("posts to the invoice's remind route", async () => {
    const fetchImpl = answer(200, { ok: true });
    await expect(remindByEmail("INV2-A", fetchImpl)).resolves.toEqual({ kind: "sent" });
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe("/api/invoices/INV2-A/remind");
  });

  it("counts a reminder already sent recently as maybe sent, so it's marked and not retried", async () => {
    await expect(remindByEmail("INV2-A", answer(409, { error: "already", alreadySent: true }))).resolves.toEqual({ kind: "maybe", message: "already" });
  });

  it("counts the server's maybe-sent answer as maybe sent", async () => {
    await expect(remindByEmail("INV2-A", answer(502, { error: "no answer", maybeSent: true }))).resolves.toMatchObject({ kind: "maybe" });
  });

  it("counts an unreadable server error as maybe sent", async () => {
    await expect(remindByEmail("INV2-A", answer(504))).resolves.toMatchObject({ kind: "maybe" });
  });

  it("counts a clear refusal as not sent, with the server's reason", async () => {
    await expect(remindByEmail("INV2-A", answer(409, { error: "already paid", reason: "paid" }))).resolves.toEqual({ kind: "refused", message: "already paid" });
    await expect(remindByEmail("INV2-A", answer(401, { error: "Sign in to do that." }))).resolves.toMatchObject({ kind: "refused" });
  });

  it("counts a lost connection as maybe sent", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(remindByEmail("INV2-A", fetchImpl)).resolves.toMatchObject({ kind: "maybe" });
  });
});
