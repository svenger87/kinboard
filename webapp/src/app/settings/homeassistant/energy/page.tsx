import { redirect } from "next/navigation";

/** Superseded by /settings/energy. See next.config.mjs for the 308 redirect. */
export default function LegacyEnergySettingsPage() {
  redirect("/settings/energy");
}
