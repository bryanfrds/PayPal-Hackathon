import SharedTab from "./SharedTab";
import { loadForPage } from "./load";

export const dynamic = "force-dynamic";

export default async function SharedTabPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTab data={await loadForPage(token)} screen={{ kind: "home" }} />;
}
