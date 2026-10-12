import { TabBillDetail } from "../../TabScreens";

export default async function TabBillPage({ params }: { params: Promise<{ slug: string; month: string }> }) {
  const { slug, month } = await params;
  return <TabBillDetail slug={slug} month={month} />;
}
