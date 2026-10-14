import { Suspense } from "react";
import SignInScreen from "./SignInScreen";

export const metadata = { title: "Sign in · 555 Buku" };

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInScreen />
    </Suspense>
  );
}
