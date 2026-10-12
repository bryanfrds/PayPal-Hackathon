import { TabHome } from "./TabScreens";

export default async function TabHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TabHome slug={slug} />;
}
