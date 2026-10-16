// The Customers screen's "Add customer" decision, kept pure so it can be tested: check the
// form, spot a customer who's already saved (so their email isn't quietly replaced), and
// save in an order that never leaves half a customer behind.

import { isValidEmail } from "./collect";
import { customerSlug } from "./customer-tab";
import { createManualDebt, validateDebtInput, type Debt } from "./debts";
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
