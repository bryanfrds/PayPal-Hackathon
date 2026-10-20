import type { Metadata } from "next";
import AddDebtForm, { AddDebtIntro } from "./AddDebtForm";

export const metadata: Metadata = { title: "Add debt · 555 Buku" };

export default function AddDebtPage() {
  return (
    <div className="narrow">
      <AddDebtIntro />
      <AddDebtForm />
    </div>
  );
}
