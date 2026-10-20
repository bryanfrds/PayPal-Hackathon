// Which menu item is the current one. Screens without an item of their own light up the one
// they belong to: adding a debt and the customer list are part of the Ledger.

const ALSO_ACTIVE: Record<string, string[]> = { "/ledger": ["/add", "/customers"] };

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether the menu item for `href` is the current one at `pathname`. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return under(pathname, href) || (ALSO_ACTIVE[href] ?? []).some((p) => under(pathname, p));
}
