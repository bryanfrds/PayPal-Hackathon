import type { Metadata } from "next";
import { Suspense } from "react";
import LedgerScreen, { LedgerLoading } from "./LedgerScreen";

export const metadata: Metadata = { title: "Ledger · 555 Buku" };

export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerLoading />}>
      <LedgerScreen />
    </Suspense>
  );
}
