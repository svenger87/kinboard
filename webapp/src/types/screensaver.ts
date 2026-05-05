export type PresenceControlMode = 'screensaver' | 'display_power';

export interface ScreensaverSettings {
  // Timeout in seconds before screensaver activates (0 = disabled)
  screensaverTimeout: number;
  // Seconds to wait after no presence before taking action
  presenceTimeout: number;
  // What to control when no presence is detected
  presenceControlMode: PresenceControlMode;
  // Photo rotation interval in seconds (how often photos change)
  photoRotationInterval: number;
}

export const DEFAULT_SCREENSAVER_SETTINGS: ScreensaverSettings = {
  screensaverTimeout: 120,
  presenceTimeout: 30,
  presenceControlMode: 'screensaver',
  photoRotationInterval: 30,
};

export interface PresenceState {
  detected: boolean;
  lastSeen: number | null;
  distance?: number;
  stale: boolean;
  isEnabled: boolean;
}
