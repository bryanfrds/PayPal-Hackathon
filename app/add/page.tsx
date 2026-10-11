import AddDebtForm from "./AddDebtForm";

export default function AddDebtPage() {
  return (
    <div className="narrow">
      <h1 className="page-title">Add a debt</h1>
      <p className="page-intro">Type in a tab from your buku 555. It goes straight onto the ledger.</p>
      <AddDebtForm />
    </div>
  );
}
