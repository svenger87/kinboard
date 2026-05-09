import type { ComponentType } from "react";
import type { Vehicle } from "@/types/database";

export interface VehicleDriver<TConfig = unknown> {
  /** Matches `vehicle.vendor` in the DB row. */
  id: Vehicle["vendor"];

  /** i18n key under `vehicles.drivers.<id>.displayName`. Used by the
   *  vendor picker in /settings/vehicles/new. */
  displayNameKey: string;

  /** Lucide icon shown in the vendor picker + tab label. */
  icon: ComponentType<{ className?: string; size?: number }>;

  /** Default config blob the new-vehicle flow inserts into the row. */
  defaultConfig: TConfig;

  /** Renders the vehicle's main card on `/vehicles`. */
  Card: ComponentType<{ vehicle: Vehicle }>;

  /** Form rendered on `/settings/vehicles/[id]` underneath the
   *  shared nickname/color inputs. Calls `onConfigChange` on every
   *  change so the parent settings page can debounce + save. */
  ConfigForm: ComponentType<{
    vehicle: Vehicle;
    onConfigChange: (config: TConfig) => void;
  }>;

  /** Predicate for "this vehicle's config is complete enough to render
   *  meaningfully". The Card renders an empty state when this returns
   *  false; settings list uses this to badge as "needs config". */
  isConfigured: (config: TConfig) => boolean;
}
