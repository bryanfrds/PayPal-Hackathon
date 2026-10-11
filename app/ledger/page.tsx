import { Suspense } from "react";
import LedgerScreen from "./LedgerScreen";

export default function LedgerPage() {
  return (
    <Suspense fallback={<p className="card loading">Loading your ledger…</p>}>
      <LedgerScreen />
    </Suspense>
  );
}
