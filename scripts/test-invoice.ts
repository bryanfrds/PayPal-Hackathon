/**
 * Creates and sends one sandbox invoice to PAYPAL_SANDBOX_BUYER_EMAIL, then
 * prints the invoice id and the payer link.
 *
 * Run with: npm run paypal:test-invoice
 * Needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_SANDBOX_BUYER_EMAIL
 * in .env.local (copy .env.example to start).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDraftInvoice, getInvoice, getPayerLink, PayPalError, sendInvoice } from "../lib/paypal";

const ENV_FILE = resolve(process.cwd(), ".env.local");
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

async function main(): Promise<void> {
  const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim();
  if (!buyerEmail) {
    throw new PayPalError(
      "PAYPAL_SANDBOX_BUYER_EMAIL is not set. Add a sandbox buyer email to .env.local.",
    );
  }

  console.log("Creating a draft invoice for Kopi O x2 (RM5.00)...");
  const draft = await createDraftInvoice({
    recipientEmail: buyerEmail,
    recipientName: "Sandbox Buyer",
    items: [{ name: "Kopi O x2", amount: 5 }],
  });
  console.log(`Draft created: ${draft.id}`);

  console.log("Sending the invoice to the sandbox buyer...");
  await sendInvoice(draft.id);

  // Read it back so the payer link is included even if the send response omits it.
  const invoice = await getInvoice(draft.id);
  const payerLink = getPayerLink(invoice);

  console.log("");
  console.log(`Invoice id:  ${invoice.id}`);
  console.log(`Status:      ${invoice.status ?? "unknown"}`);
  console.log(`Payer link:  ${payerLink ?? "not returned by PayPal; check the sandbox dashboard"}`);
}

main().catch((err: unknown) => {
  if (err instanceof PayPalError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
