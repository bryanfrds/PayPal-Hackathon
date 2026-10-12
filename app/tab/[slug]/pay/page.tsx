import { TabPay } from "../TabScreens";

export default async function TabPayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TabPay slug={slug} />;
}
