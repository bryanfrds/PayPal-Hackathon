import { slugFromParam } from "@/lib/customer-tab";
import { TabPay } from "../TabScreens";

export default async function TabPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ upto?: string | string[] }>;
}) {
  const { slug } = await params;
  const { upto } = await searchParams;
  return <TabPay slug={slugFromParam(slug)} upto={typeof upto === "string" ? upto : undefined} />;
}
