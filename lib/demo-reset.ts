// "Reset demo data" in Settings: puts the sample customers back and clears everything the
// demo has done since (invoices sent, unfinished sends, saved emails, reminder rules, moved and
// sent reminders). Pure, so what it clears and what it keeps can be tested in Node.
//
// It never touches sign-in (cookies, not storage), the shop's name and type, or the owner's
// preferences. With the debts key removed, the debt store starts from the sample tabs again,
// exactly like a first visit.

import { EMAILS_KEY, INVOICES_KEY, PENDING_KEY } from "./collect-store";
import { STORAGE_KEY as DEBTS_KEY } from "./debt-store";
import { MOVES_KEY, RULES_KEY, SENT_KEY } from "./reminder-store";

/** What a reset clears. Anything else on the device is left alone. */
export const DEMO_KEYS = [DEBTS_KEY, INVOICES_KEY, PENDING_KEY, EMAILS_KEY, RULES_KEY, MOVES_KEY, SENT_KEY] as const;

type StorageLike = Pick<Storage, "removeItem">;

/** Clears the demo keys. Returns false if storage is missing or a removal failed (some may be cleared). */
export function resetDemoData(storage: StorageLike | null): boolean {
  if (!storage) return false;
  let ok = true;
  for (const key of DEMO_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      ok = false;
    }
  }
  return ok;
}
