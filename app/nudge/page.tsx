import type { Metadata } from "next";
import NudgeChat from "./NudgeChat";

export const metadata: Metadata = { title: "Nudge · 555 Buku" };

export default function NudgePage() {
  return <NudgeChat />;
}
