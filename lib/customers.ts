// The Customers screen's "Add customer" decision, kept pure so it can be tested: check the
// form, spot a customer who's already saved (so their email isn't quietly replaced), and
// save in an order that never leaves half a customer behind.

import { isValidEmail } from "./collect";
import { customerSlug } from "./customer-tab";
import { createManualDebt, outstanding, validateDebtInput, type Debt } from "./debts";
import { translator, type T } from "./i18n";

/** What the owner types into the Add customer form. */
export type AddCustomerInput = {
  name: string;
  email: string;
  /** True when the "add what they owe now" box is ticked. */
  withDebt: boolean;
  item: string;
  /** As typed, e.g. "12.5" or "RM 12.50". Ignored unless withDebt. */
  amount: string;
};

export type AddCustomerField = "name" | "email" | "item" | "amount";
export type AddCustomerErrors = Partial<Record<AddCustomerField, string>>;

/** A debt ready to save: everything but the id and timestamps. */
export type NewDebtValue = Omit<Debt, "id" | "status" | "source" | "createdAt">;

export type AddCustomerPlan =
  | { kind: "invalid"; errors: AddCustomerErrors }
  /** Already saved with a different email: never overwrite it; offer to add the debt only. */
  | { kind: "exists"; slug: string; name: string; existingName: string; existingEmail: string; debt?: NewDebtValue }
  /** Safe to save: a new customer, or a known one with no email yet (or the same email). */
  | { kind: "new"; slug: string; name: string; email: string; debt?: NewDebtValue };

/**
 * Checks the form against the same rules as Add debt (name and item length, RM 10,000 cap),
 * then decides whether saving would replace a saved email. `today` is YYYY-MM-DD.
 */
export function planAddCustomer(
  input: AddCustomerInput,
  debts: Debt[],
  emails: Record<string, string>,
  today: string,
  t: T = translator(),
): AddCustomerPlan {
  const errors: AddCustomerErrors = {};
  // Without a debt only the name rules apply; a stand-in amount keeps validateDebtInput happy.
  const checked = validateDebtInput(
    {
      customerName: input.name,
      item: input.withDebt ? input.item : "",
      amount: input.withDebt ? input.amount : "1",
      date: today,
    },
    today,
    t,
  );
  if (!checked.ok) {
    // validateDebtInput calls it customerName; the form calls it name. The date is always today.
    if (checked.errors.customerName) errors.name = checked.errors.customerName;
    if (checked.errors.item) errors.item = checked.errors.item;
    if (checked.errors.amount) errors.amount = checked.errors.amount;
  }
  const email = input.email.trim();
  if (!isValidEmail(email)) errors.email = t("collect.email.invalid");
  if (Object.keys(errors).length > 0 || !checked.ok) return { kind: "invalid", errors };

  const name = checked.value.customerName;
  const slug = customerSlug(name);
  const debt = input.withDebt ? checked.value : undefined;
  const existingEmail = emails[slug];

  if (existingEmail && existingEmail.trim().toLowerCase() !== email.toLowerCase()) {
    const existingName = debts.find((d) => customerSlug(d.customerName) === slug)?.customerName ?? name;
    return { kind: "exists", slug, name, existingName, existingEmail, debt };
  }
  return { kind: "new", slug, name, email, debt };
}

export type SaveDeps = {
  addDebt: (debt: Debt) => void;
  setEmail: (slug: string, email: string) => void;
  newId: () => string;
  now: Date;
};

/** On failure, `saved` says what did get kept: nothing, or the debt without the email. */
export type SaveResult = { ok: true } | { ok: false; saved: "nothing" | "debtOnly" };

/**
 * Saves a plan. The debt goes first: if it fails nothing is saved; if the email then fails,
 * the caller is told exactly that. An "exists" plan only ever adds the debt, so the saved
 * email is kept. Store errors (CollectStoreError, DebtStoreError) are caught here.
 */
export function saveAddCustomer(plan: Exclude<AddCustomerPlan, { kind: "invalid" }>, deps: SaveDeps): SaveResult {
  if (plan.debt) {
    try {
      deps.addDebt(createManualDebt(plan.debt, { id: deps.newId(), now: deps.now }));
    } catch {
      return { ok: false, saved: "nothing" };
    }
  }
  if (plan.kind === "new") {
    try {
      deps.setEmail(plan.slug, plan.email);
    } catch {
      return { ok: false, saved: plan.debt ? "debtOnly" : "nothing" };
    }
  }
  return { ok: true };
}

export type CustomerRow = {
  name: string;
  slug: string;
  email?: string;
  totalDebts: number;
  /** Not invoiced yet ("Not sent"). */
  unpaidCount: number;
  /** Invoiced, not paid yet ("Invoice sent"). */
  sentCount: number;
  overdueCount: number;
  /** Everything not paid, the same rule as Home's "Still owed" (outstanding() in lib/debts). */
  owedSen: number;
  lastDate?: string;
};

/** "kak-lina" → "Kak Lina", for a customer known only by a saved email. */
export function nameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * One row per customer, from their debts plus any saved email. Customers known only by an
 * email are named from `knownNames` (e.g. their last invoice), else from the slug. Biggest
 * balance first.
 */
export function customerRows(debts: Debt[], emails: Record<string, string>, knownNames: Map<string, string> = new Map()): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const d of debts) {
    const slug = customerSlug(d.customerName);
    let row = map.get(slug);
    if (!row) {
      row = { name: d.customerName, slug, email: emails[slug], totalDebts: 0, unpaidCount: 0, sentCount: 0, overdueCount: 0, owedSen: 0, lastDate: d.date };
      map.set(slug, row);
    }
    row.totalDebts += 1;
    if (d.status === "unpaid") row.unpaidCount += 1;
    else if (d.status === "sent") row.sentCount += 1;
    else if (d.status === "overdue") row.overdueCount += 1;
    if (!row.lastDate || d.date > row.lastDate) row.lastDate = d.date;
  }
  for (const row of map.values()) {
    row.owedSen = outstanding(debts.filter((d) => customerSlug(d.customerName) === row.slug)).totalSen;
  }
  for (const [slug, email] of Object.entries(emails)) {
    const row = map.get(slug);
    if (row) row.email = email;
    else map.set(slug, { name: knownNames.get(slug) ?? nameFromSlug(slug), slug, email, totalDebts: 0, unpaidCount: 0, sentCount: 0, overdueCount: 0, owedSen: 0 });
  }
  return [...map.values()].sort((a, b) => b.owedSen - a.owedSen || a.name.localeCompare(b.name));
}

export type CustomerTotals = {
  /** Still owed across every customer: matches Home's total. */
  owedSen: number;
  /** Customers who owe anything. */
  owing: number;
  missingEmail: number;
  /** Have an email and a tab Collect can invoice now (isInvoiceable: not sent yet, or overdue). */
  readyToInvoice: number;
};

export function customerTotals(rows: CustomerRow[]): CustomerTotals {
  let owedSen = 0;
  let owing = 0;
  let missingEmail = 0;
  let readyToInvoice = 0;
  for (const r of rows) {
    owedSen += r.owedSen;
    if (r.owedSen > 0) owing += 1;
    if (!r.email) missingEmail += 1;
    if (r.email && r.unpaidCount + r.overdueCount > 0) readyToInvoice += 1;
  }
  return { owedSen, owing, missingEmail, readyToInvoice };
}
