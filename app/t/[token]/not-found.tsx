"use client";

// Unknown, turned-off or mistyped link: a friendly page, in the visitor's language.

import Logo from "../../components/Logo";
import { LanguageProvider, useT } from "../../useT";
import { useVisitorLanguage } from "./SharedTab";

function Inactive() {
  const { t } = useT();
  return (
    <div className="tab-page">
      <div className="app-head">
        <Logo />
      </div>
      <div className="card empty-state">
        <h1 className="tab-empty-title">{t("sharedTab.inactiveTitle")}</h1>
        <p>{t("sharedTab.inactiveBody")}</p>
      </div>
    </div>
  );
}

export default function SharedTabNotFound() {
  return (
    <LanguageProvider lang={useVisitorLanguage()}>
      <Inactive />
    </LanguageProvider>
  );
}
