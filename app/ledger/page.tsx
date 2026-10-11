import LedgerGrid from "./LedgerGrid";
import { SAMPLE_LEDGER_ROWS } from "./sample-data";

export default function LedgerPage() {
  return (
    <>
      <h1 className="page-title">Ledger</h1>
      <p className="page-intro">Who still owes you, overdue first.</p>
      <LedgerGrid rows={SAMPLE_LEDGER_ROWS} />
    </>
  );
}
