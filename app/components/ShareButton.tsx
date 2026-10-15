"use client";

// The round green chat button that opens the WhatsApp share sheet, and the one-time tip
// that points it out the first time someone sees it.

import { useCallback, useEffect, useState } from "react";
import { useT } from "../useT";
import { ChatIcon, CloseIcon } from "./icons";

export function ShareButton({
  customerName,
  onOpen,
  className = "",
}: {
  customerName: string;
  onOpen: (button: HTMLButtonElement) => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      className={`wa-btn ${className}`.trim()}
      aria-label={t("tip.shareAria", { name: customerName })}
      title={t("tip.shareTitle")}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <ChatIcon />
    </button>
  );
}

const TIP_KEY = "buku.tip.whatsapp.v1";

/** Whether to show the tip, and a way to hide it for good. Storage errors just mean it shows again next time. */
export function useShareTip(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(TIP_KEY) === "1";
    } catch {
      seen = false;
    }
    // Read after mount so the server render and first paint match.
    if (!seen) setShow(true);
  }, []);
  const dismiss = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Private mode: the tip comes back next visit, which is fine.
    }
  }, []);
  return [show, dismiss];
}

export function ShareTip({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT();
  return (
    <div className="wa-tip-wrap">
      <p className="wa-tip" role="note">
        {t("tip.whatsapp")}
        <button type="button" className="wa-tip-close" aria-label={t("tip.dismiss")} onClick={onDismiss}>
          <CloseIcon />
        </button>
      </p>
    </div>
  );
}
