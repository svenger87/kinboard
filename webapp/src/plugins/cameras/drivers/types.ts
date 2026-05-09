import type { ComponentType } from "react";

/**
 * Single-instance camera driver contract. Cameras are one config per family
 * (a list of CameraConfig rows stored under the `cameras` settings key).
 * The Card and ConfigForm read and write config via their own hooks.
 */
export interface CameraDriver<TConfig = unknown> {
  /** Matches the driver id registered in CAMERA_DRIVERS. */
  id: string;

  /** i18n key under `cameras.drivers.<id>.displayName`. */
  displayNameKey: string;

  /** Lucide icon shown in the driver picker (future multi-driver UI). */
  icon: ComponentType<{ className?: string; size?: number }>;

  /** Renders the main /cameras grid. No props — single-instance. */
  Card: ComponentType<object>;

  /** Form rendered on /settings/cameras. Reads and saves config internally
   *  via hooks. No props — single-instance. */
  ConfigForm: ComponentType<object>;

  /** Predicate: is the driver's config complete enough to render.
   *  Used by the plugin's useOwnDataCount and the /cameras empty state. */
  isConfigured: (config: TConfig | undefined) => boolean;
}
