"use client";

// Signs the owner out and goes to the sign-in page. Shared by the account sheet and Settings.

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useT } from "./useT";

export function useSignOut() {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) throw new Error();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError(t("account.signOutFailed"));
      setBusy(false);
    }
  }, [router, t]);

  return { signOut, busy, error };
}

export type Me = { email: string; method: "email" | "paypal" };
