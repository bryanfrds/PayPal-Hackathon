import InvoiceTrack from "./InvoiceTrack";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep as given
  }
  return <InvoiceTrack id={decoded} />;
}
