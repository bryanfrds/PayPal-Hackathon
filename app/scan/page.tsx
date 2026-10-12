import type { Metadata } from "next";
import ScanFlow from "./ScanFlow";

export const metadata: Metadata = { title: "Scan · 555 Buku" };

export default function ScanPage() {
  return <ScanFlow />;
}
