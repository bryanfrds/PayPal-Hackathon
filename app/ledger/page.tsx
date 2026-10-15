import { Suspense } from "react";
import LedgerScreen, { LedgerLoading } from "./LedgerScreen";

export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerLoading />}>
      <LedgerScreen />
    </Suspense>
  );
}
