"use client";

// Gives app/tabLinks.ts the latest ledger, so a publish sends current data, and refreshes
// already-shared tabs when the ledger or invoices change (debounced; only changed ones are sent,
// and a customer with no debts left loses their link). Never shares a tab by itself.
// Renders nothing. Not on a customer's shared tab (/t/...), which isn't the owner's device.

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { refreshPublishedTabs, registerTabData } from "./tabLinks";
import { useCollect } from "./useCollect";
import { useDebts } from "./useDebts";
import { useShop } from "./useShop";

export default function TabPublisher() {
  const pathname = usePathname();
  if (pathname.startsWith("/t/")) return null;
  return <Registrar />;
}

function Registrar() {
  const { debts } = useDebts();
  const { invoices } = useCollect();
  const { name } = useShop();
  const latest = useRef({ debts, invoices, shopName: name });
  useEffect(() => {
    latest.current = { debts, invoices, shopName: name };
  });
  useEffect(() => {
    registerTabData(() => latest.current);
    return () => registerTabData(null);
  }, []);
  useEffect(() => {
    refreshPublishedTabs();
  }, [debts, invoices, name]);
  return null;
}
