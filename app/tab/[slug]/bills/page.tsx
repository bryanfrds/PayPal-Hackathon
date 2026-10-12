import { TabBills } from "../TabScreens";

export default async function TabBillsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TabBills slug={slug} />;
}
