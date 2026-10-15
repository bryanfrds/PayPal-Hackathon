"use client";

// The round green chat button that opens the WhatsApp share sheet, and the one-time tip
// that points it out the first time someone sees it.

import { useCallback, useEffect, useState } from "react";
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
  return (
    <button
      type="button"
      className={`wa-btn ${className}`.trim()}
      aria-label={`Send ${customerName}'s tab on WhatsApp`}
      title="Send on WhatsApp"
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
  return (
    <div className="wa-tip-wrap">
      <p className="wa-tip" role="note">
        New: send their tab on WhatsApp
        <button type="button" className="wa-tip-close" aria-label="Dismiss tip" onClick={onDismiss}>
          <CloseIcon />
        </button>
      </p>
    </div>
  );
}
