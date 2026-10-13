import type { PayPalError } from "@/lib/paypal";

/** Turns a PayPal failure into a short message the shop owner can act on. Never echoes secrets. */
export function paypalFailure(error: PayPalError | null): { status: number; message: string } {
  if (!error) return { status: 502, message: "PayPal didn't answer. Try again." };
  if (/ is not set\./.test(error.message)) {
    return { status: 503, message: "PayPal isn't connected on this server yet." };
  }
  if (error.status === 401 || error.status === 403) {
    return { status: 502, message: "PayPal didn't accept the shop's keys. Check the PayPal setup." };
  }
  if (error.status === 422 || error.status === 400) {
    return { status: 422, message: "PayPal didn't accept this invoice. Check the email and amount." };
  }
  if (error.status === 429) return { status: 503, message: "PayPal is busy. Try again in a minute." };
  return { status: 502, message: "PayPal didn't answer. Try again." };
}
