import type { Metadata } from "next";
import SettingsScreen from "./SettingsScreen";

export const metadata: Metadata = { title: "Settings · 555 Buku" };

export default function SettingsPage() {
  return <SettingsScreen />;
}
