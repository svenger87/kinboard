import { redirect } from "next/navigation";

// Legacy single-Tesla route. Replaced by /vehicles which supports
// multiple cars and multiple vendors. Existing Tesla setups have been
// auto-migrated by migration_vehicles.sql; users keep all their data.
export default function TeslaPage() {
  redirect("/vehicles");
}
