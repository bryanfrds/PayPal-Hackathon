// Where the owner goes when they tap a customer in the app: their row on the Customers screen
// (balance, email, invoice and "View tab"), found by name. Not /tab/<slug>, which is the
// customer-facing tab with a Pay button, meant for the customer.

/** "/customers?q=<name>": the Customers screen with the search box filled in. */
export function customerPagePath(name: string): string {
  return `/customers?q=${encodeURIComponent(name.trim())}`;
}

/** The search text from ?q=, trimmed and capped, or "" when there's none. */
export function initialCustomerQuery(q: string | string[] | undefined): string {
  const value = Array.isArray(q) ? q[0] : q;
  return (value ?? "").trim().slice(0, 100);
}
