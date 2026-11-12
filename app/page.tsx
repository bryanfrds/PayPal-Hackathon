import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = { title: "Home · 555 Buku" };

export default function HomePage() {
  return <Dashboard />;
}
