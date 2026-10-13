import type { Metadata } from "next";
import CollectFlow from "./CollectFlow";

export const metadata: Metadata = { title: "Collect · 555 Buku" };

export default function CollectPage() {
  return <CollectFlow />;
}
