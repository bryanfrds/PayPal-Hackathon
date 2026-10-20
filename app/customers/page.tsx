import type { Metadata } from "next";
import { initialCustomerQuery } from "../customerLinks";
import CustomersScreen from "./CustomersScreen";

export const metadata: Metadata = { title: "Customers · 555 Buku" };

// ?q=<name> fills the search box: tapping a customer elsewhere in the app lands on their row.
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await searchParams;
  return <CustomersScreen initialQuery={initialCustomerQuery(q)} />;
}
