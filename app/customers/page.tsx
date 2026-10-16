import type { Metadata } from "next";
import CustomersScreen from "./CustomersScreen";

export const metadata: Metadata = { title: "Customers · 555 Buku" };

export default function CustomersPage() {
  return <CustomersScreen />;
}
