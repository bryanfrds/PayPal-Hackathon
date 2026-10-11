import Link from "next/link";

const PARTS = [
  {
    href: "/scan",
    title: "Scan",
    body: "Photograph a page of your buku 555 and check the names, amounts and dates AI reads.",
  },
  {
    href: "/collect",
    title: "Collect",
    body: "Send each customer a PayPal invoice in one tap. Paid invoices tick themselves off.",
  },
  {
    href: "/ledger",
    title: "Chase & Ledger",
    body: "See who still owes you, overdue first, with totals and a quick filter.",
  },
];

export default function HomePage() {
  return (
    <>
      <h1 className="page-title">555 Buku</h1>
      <p className="page-intro">
        Snap your shop&apos;s 555 IOU notebook. We turn every handwritten debt into a PayPal invoice.
      </p>
      <div className="card-grid">
        {PARTS.map((part) => (
          <section className="card" key={part.href}>
            <h2>
              <Link href={part.href}>{part.title}</Link>
            </h2>
            <p>{part.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
