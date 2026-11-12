"use client";

// The customer tab screens with a published snapshot instead of this device's ledger, in the
// visitor's own browser language (one of ours, else English).

import { useSyncExternalStore, type ReactNode } from "react";
import { pickLanguage, type Language } from "@/lib/i18n";
import { LanguageProvider } from "../../useT";
import { TabBillDetail, TabBills, TabHistory, TabHome, TabPay, TabSource } from "../../tab/[slug]/TabScreens";
import type { SharedTabProps } from "./load";

function browserLanguage(): Language {
  return pickLanguage(typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
}

const noSubscribe = () => () => {};

export function useVisitorLanguage(): Language {
  return useSyncExternalStore(noSubscribe, browserLanguage, () => "en" as Language);
}

export type Screen = { kind: "home" } | { kind: "bills" } | { kind: "bill"; month: string } | { kind: "history" } | { kind: "pay"; upto?: string };

export default function SharedTab({ data, screen }: { data: SharedTabProps; screen: Screen }) {
  const lang = useVisitorLanguage();
  const { slug, debts, invoices, shopName, base } = data;
  let body: ReactNode;
  switch (screen.kind) {
    case "bills":
      body = <TabBills slug={slug} />;
      break;
    case "bill":
      body = <TabBillDetail slug={slug} month={screen.month} />;
      break;
    case "history":
      body = <TabHistory slug={slug} />;
      break;
    case "pay":
      body = <TabPay slug={slug} upto={screen.upto} />;
      break;
    default:
      body = <TabHome slug={slug} />;
  }
  return (
    <LanguageProvider lang={lang}>
      <TabSource value={{ debts, invoices, shopName, base }}>{body}</TabSource>
    </LanguageProvider>
  );
}
