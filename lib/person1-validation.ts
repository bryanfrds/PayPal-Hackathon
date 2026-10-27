import { isValidEmail } from "./collect";

export const MAX_CUSTOMER_NAME_CHARS = 120;
export const MAX_CUSTOMER_EMAIL_CHARS = 254;
export const MAX_CUSTOMER_PHONE_CHARS = 32;
export const MAX_ENTRY_ITEM_CHARS = 500;

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateCustomerInput(value: Record<string, unknown>, requireName: boolean): Validation<Record<string, string | undefined>> {
  const name = typeof value.name === "string" ? value.name.trim() : undefined;
  const email = typeof value.email === "string" ? value.email.trim() : undefined;
  const phone = typeof value.phone === "string" ? value.phone.trim() : undefined;
  if (requireName && !name) return { ok: false, error: "Customer name is required." };
  if (name !== undefined && (!name || name.length > MAX_CUSTOMER_NAME_CHARS)) return { ok: false, error: `Customer name must be ${MAX_CUSTOMER_NAME_CHARS} characters or fewer.` };
  if (email !== undefined && (email.length > MAX_CUSTOMER_EMAIL_CHARS || (email && !isValidEmail(email)))) return { ok: false, error: "Customer email is invalid or too long." };
  if (phone !== undefined && phone.length > MAX_CUSTOMER_PHONE_CHARS) return { ok: false, error: `Customer phone must be ${MAX_CUSTOMER_PHONE_CHARS} characters or fewer.` };
  return { ok: true, value: { name, email: email || undefined, phone: phone || undefined } };
}

export function validateEntryPatch(value: Record<string, unknown>): Validation<Record<string, unknown>> {
  const patch: Record<string, unknown> = { ownerEdited: true };
  if (typeof value.customerName === "string") {
    const name = value.customerName.trim();
    if (!name || name.length > MAX_CUSTOMER_NAME_CHARS) return { ok: false, error: `Customer name must be 1-${MAX_CUSTOMER_NAME_CHARS} characters.` };
    patch.customerName = name;
  }
  if (typeof value.item === "string") {
    const item = value.item.trim();
    if (item.length > MAX_ENTRY_ITEM_CHARS) return { ok: false, error: `Item must be ${MAX_ENTRY_ITEM_CHARS} characters or fewer.` };
    patch.item = item;
  }
  if (typeof value.date === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(`${value.date}T00:00:00Z`))) return { ok: false, error: "Date must be a valid YYYY-MM-DD value." };
    patch.date = value.date;
  }
  return { ok: true, value: patch };
}

export function malaysiaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
