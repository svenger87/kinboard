import type { ComponentType } from "react";

/**
 * Single-instance energy driver contract. Unlike VehicleDriver, there is
 * no per-row props pattern — Energy is one config per family. The Card and
 * ConfigForm read config via their own hooks (e.g. useEnergyConfig).
 */
export interface EnergyDriver<TConfig = unknown> {
  /** Matches the driver id registered in ENERGY_DRIVERS. */
  id: string;

  /** i18n key under `energy.drivers.<id>.displayName`. */
  displayNameKey: string;

  /** Lucide icon shown in the driver picker (future multi-driver UI). */
  icon: ComponentType<{ className?: string; size?: number }>;

  /** Renders the main /energy dashboard. Reads config via useEnergyConfig
   *  (or a per-driver hook for non-HA drivers). No props — single-instance. */
  Card: ComponentType<object>;

  /** Form rendered on /settings/energy. Driver-specific entity mapping fields.
   *  No props — reads and saves config internally via hooks. */
  ConfigForm: ComponentType<object>;

  /** Predicate: is the driver's config complete enough to render meaningfully.
   *  Used by the plugin's useOwnDataCount and the /energy empty state. */
  isConfigured: (config: TConfig | undefined) => boolean;
}
