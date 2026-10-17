import SharedTab from "../SharedTab";
import { loadForPage } from "../load";

export const dynamic = "force-dynamic";

export default async function SharedPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ upto?: string | string[] }>;
}) {
  const { token } = await params;
  const { upto } = await searchParams;
  return <SharedTab data={await loadForPage(token)} screen={{ kind: "pay", upto: typeof upto === "string" ? upto : undefined }} />;
}
