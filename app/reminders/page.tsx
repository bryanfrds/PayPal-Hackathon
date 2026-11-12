import type { Metadata } from "next";
import RemindersScreen from "./RemindersScreen";

export const metadata: Metadata = { title: "Reminders · 555 Buku" };

export default function RemindersPage() {
  return <RemindersScreen />;
}
