import { notFound } from "next/navigation";
import SharedTab from "../../SharedTab";
import { loadForPage } from "../../load";

export const dynamic = "force-dynamic";

export default async function SharedBillPage({ params }: { params: Promise<{ token: string; month: string }> }) {
  const { token, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();
  return <SharedTab data={await loadForPage(token)} screen={{ kind: "bill", month }} />;
}
