import { TabHistory } from "../TabScreens";

export default async function TabHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TabHistory slug={slug} />;
}
