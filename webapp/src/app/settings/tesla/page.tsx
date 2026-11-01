import { redirect } from "next/navigation";

// Legacy single-Tesla settings route. Replaced by /settings/vehicles
// which lists all vehicles + supports multiple vendors. Existing Tesla
// setups have been auto-migrated by migrations/046_vehicles.sql.
export default function SettingsTeslaPage() {
  redirect("/settings/vehicles");
}
