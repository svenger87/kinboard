// Home Assistant Types

import { safeRandomUUID } from "@/lib/uuid";

// Entity state from HA REST API
export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    icon?: string;
    brightness?: number;
    color_temp?: number;
    rgb_color?: [number, number, number];
    battery_level?: number;
    status?: string;
    fan_speed?: string;
    fan_speed_list?: string[];
    supported_features?: number;
    // Media player attributes
    media_title?: string;
    media_artist?: string;
    media_album_name?: string;
    media_content_type?: string;
    media_duration?: number;
    media_position?: number;
    entity_picture?: string;
    volume_level?: number;
    is_volume_muted?: boolean;
    source?: string;
    source_list?: string[];
    // Cover attributes
    current_position?: number;
    current_tilt_position?: number;
    // Person/tracker attributes
    latitude?: number;
    longitude?: number;
    gps_accuracy?: number;
    source_type?: string;
    // Weather attributes
    temperature?: number;
    humidity?: number;
    pressure?: number;
    wind_speed?: number;
    wind_bearing?: number;
    forecast?: WeatherForecast[];
    // Lock attributes
    changed_by?: string;
    code_format?: string;
    // Alarm attributes
    code_arm_required?: boolean;
    supported_features_alarm?: number;
    [key: string]: unknown;
  };
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

// Weather forecast from HA
export interface WeatherForecast {
  datetime: string;
  temperature: number;
  templow?: number;
  condition: string;
  precipitation_probability?: number;
  precipitation?: number;
  wind_speed?: number;
}

// Simplified entity for frontend
export interface HAEntity {
  entity_id: string;
  domain: string;
  name: string;
  state: string;
  attributes: HAEntityState["attributes"];
  last_changed: string;
}

// All supported domain types
export type HADomain =
  | "sensor"
  | "binary_sensor"
  | "switch"
  | "input_boolean"
  | "light"
  | "vacuum"
  | "climate"
  | "cover"
  | "fan"
  | "media_player"
  | "camera"
  | "lock"
  | "alarm_control_panel"
  | "water_heater"
  | "humidifier"
  | "scene"
  | "script"
  | "automation"
  | "person"
  | "device_tracker"
  | "weather";

// All supported card types
export type CardType =
  | "sensor"
  | "binary_sensor"
  | "switch"
  | "input_boolean"
  | "light"
  | "vacuum"
  | "climate"
  | "cover"
  | "fan"
  | "media_player"
  | "camera"
  | "lock"
  | "alarm_control_panel"
  | "water_heater"
  | "humidifier"
  | "scene"
  | "script"
  | "automation"
  | "person"
  | "device_tracker"
  | "weather"
  | "generic";

// Dashboard card configuration
export interface DashboardCard {
  id: string;
  entity_id: string;
  display_name?: string;
  card_type: CardType;
  position: number;
  size: "small" | "medium" | "large" | "full";
  show_graph?: boolean;
  graph_period?: "1h" | "6h" | "24h" | "7d";
}

// Dashboard configuration
export interface Dashboard {
  id: string;
  name: string;
  icon?: string;
  type: "custom" | "energy";
  cards: DashboardCard[];
  position: number;
  created_at: string;
}

// ===================
// ROOM CONFIGURATION
// ===================

// Room icon options (using Lucide icon names)
export type RoomIcon =
  | "home"
  | "bed-double"
  | "sofa"
  | "utensils"
  | "bath"
  | "car"
  | "tree"
  | "briefcase"
  | "baby"
  | "tv"
  | "door-open"
  | "warehouse"
  | "lamp"
  | "armchair"
  | "washing-machine"
  | "coffee"
  | "book";

// Room icon metadata for UI
export const ROOM_ICONS: { value: RoomIcon; label: string }[] = [
  { value: "home", label: "Haus" },
  { value: "bed-double", label: "Schlafzimmer" },
  { value: "sofa", label: "Wohnzimmer" },
  { value: "utensils", label: "Küche" },
  { value: "bath", label: "Badezimmer" },
  { value: "car", label: "Garage" },
  { value: "tree", label: "Garten" },
  { value: "briefcase", label: "Büro" },
  { value: "baby", label: "Kinderzimmer" },
  { value: "tv", label: "Medienraum" },
  { value: "door-open", label: "Flur" },
  { value: "warehouse", label: "Keller" },
  { value: "lamp", label: "Lampe" },
  { value: "armchair", label: "Lesezimmer" },
  { value: "washing-machine", label: "Waschküche" },
  { value: "coffee", label: "Esszimmer" },
  { value: "book", label: "Bibliothek" },
];

// Supported entity types in rooms (can be extended later)
export type RoomEntityType = "light" | "switch" | "input_boolean" | "sensor" | "binary_sensor";

// Entity reference within a room
export interface RoomEntity {
  entity_id: string;
  display_name?: string; // Optional custom name override
  position: number; // Order within room
}

// Room configuration
export interface RoomConfig {
  id: string;
  name: string;
  icon: RoomIcon;
  color?: string; // Optional custom color (hex)
  entities: RoomEntity[];
  position: number; // Order of rooms
  created_at: string;
}

// Configuration for rooms feature
export interface RoomsConfig {
  rooms: RoomConfig[];
  show_unassigned: boolean; // Show entities not in any room
  default_room_id?: string; // Which room opens by default
}

// Default rooms config
export const DEFAULT_ROOMS_CONFIG: RoomsConfig = {
  rooms: [],
  show_unassigned: true,
  default_room_id: undefined,
};

// Helper to generate a unique room ID
export function generateRoomId(): string {
  return `room_${safeRandomUUID().slice(0, 8)}`;
}

// Energy configuration for energy dashboard
export interface EnergyConfig {
  // Power sensors (W)
  solar_power?: string;
  battery_power?: string;              // Combined battery power (positive=charge, negative=discharge)
  battery_charge_power?: string;       // Separate charge power sensor
  battery_discharge_power?: string;    // Separate discharge power sensor
  grid_power?: string;                 // Combined grid power (positive=import, negative=export)
  grid_import_power?: string;          // Separate grid import power sensor
  grid_export_power?: string;          // Separate grid export power sensor
  grid_to_battery_power?: string;      // Power flowing from grid to battery (W)
  home_consumption?: string;           // Optional - calculated from power balance if not set

  // Energy sensors (kWh)
  solar_energy_today?: string;
  battery_energy_in?: string;
  battery_energy_out?: string;
  grid_import?: string;
  grid_export?: string;
  grid_to_battery_energy?: string;     // Energy loaded into battery from grid (kWh)

  // Battery state
  battery_soc?: string;

  // Cost configuration
  cost_per_kwh_import?: number;
  cost_per_kwh_export?: number;
  currency?: string;

  // Screensaver display option
  show_on_screensaver?: boolean;

  // Chart configuration - which entities to show in each chart
  power_chart_entities?: Array<{
    entity_id: string;
    label: string;
    color: string;
  }>;
  energy_chart_entities?: Array<{
    entity_id: string;
    label: string;
    color: string;
  }>;
}

// Tesla configuration is now owned by the Tesla driver. Re-exported
// here for back-compat with any imports of @/types/home-assistant
// that still reference the type. Once all callers import directly
// from the driver, this re-export can be deleted.
import type { TeslaConfig as _TeslaConfig } from "@/plugins/vehicles/drivers/tesla";
export type TeslaConfig = _TeslaConfig;

// Settings stored in Supabase
export interface HomeAssistantSettings {
  url: string;
  access_token: string;
  last_connected?: string;

  // Multi-dashboard support
  dashboards: Dashboard[];

  // Legacy single dashboard (for migration)
  dashboard_cards?: DashboardCard[];

  // Energy configuration
  energy_config?: EnergyConfig;

  // Tesla configuration
  tesla_config?: TeslaConfig;

  // Room configuration for FAB
  rooms_config?: RoomsConfig;
}

// Service call request
export interface HAServiceCall {
  domain: string;
  service: string;
  entity_id?: string;
  service_data?: Record<string, unknown>;
}

// HA config info from /api/config
export interface HAConfig {
  location_name: string;
  version: string;
  state: string;
  components: string[];
  latitude: number;
  longitude: number;
  unit_system: {
    length: string;
    mass: string;
    temperature: string;
    volume: string;
  };
}

// History data types
export interface HistoryPoint {
  timestamp: string;
  state: number;
}

export interface EntityHistory {
  entity_id: string;
  history: HistoryPoint[];
}

export interface StatisticsPeriod {
  start: string;
  end: string;
  mean?: number;
  min?: number;
  max?: number;
  sum?: number;
  change?: number;
}

// Vacuum specific attributes
export interface VacuumAttributes {
  status?: string;
  battery_level?: number;
  battery_icon?: string;
  fan_speed?: string;
  fan_speed_list?: string[];
  supported_features?: number;
}

// Light specific attributes
export interface LightAttributes {
  brightness?: number;
  color_temp?: number;
  color_temp_kelvin?: number;
  min_mireds?: number;
  max_mireds?: number;
  rgb_color?: [number, number, number];
  hs_color?: [number, number];
  supported_color_modes?: string[];
  color_mode?: string;
  supported_features?: number;
}

// Climate specific attributes
export interface ClimateAttributes {
  hvac_modes?: string[];
  hvac_action?: string;
  current_temperature?: number;
  temperature?: number;
  target_temp_high?: number;
  target_temp_low?: number;
  preset_mode?: string;
  preset_modes?: string[];
  fan_mode?: string;
  fan_modes?: string[];
  supported_features?: number;
}

// Cover specific attributes
export interface CoverAttributes {
  current_position?: number;
  current_tilt_position?: number;
  supported_features?: number;
}

// Media player specific attributes
export interface MediaPlayerAttributes {
  media_title?: string;
  media_artist?: string;
  media_album_name?: string;
  media_content_type?: string;
  media_duration?: number;
  media_position?: number;
  entity_picture?: string;
  volume_level?: number;
  is_volume_muted?: boolean;
  source?: string;
  source_list?: string[];
  supported_features?: number;
}

// Lock specific attributes
export interface LockAttributes {
  changed_by?: string;
  code_format?: string;
  supported_features?: number;
}

// Alarm panel specific attributes
export interface AlarmAttributes {
  code_arm_required?: boolean;
  supported_features?: number;
}

// Sensor device classes with German translations
export const SENSOR_DEVICE_CLASSES: Record<string, string> = {
  battery: "Batterie",
  carbon_dioxide: "CO2",
  carbon_monoxide: "CO",
  current: "Strom",
  energy: "Energie",
  humidity: "Luftfeuchtigkeit",
  illuminance: "Helligkeit",
  power: "Leistung",
  power_factor: "Leistungsfaktor",
  pressure: "Druck",
  signal_strength: "Signalstärke",
  temperature: "Temperatur",
  voltage: "Spannung",
  gas: "Gas",
  moisture: "Feuchtigkeit",
  pm1: "PM1",
  pm10: "PM10",
  pm25: "PM2.5",
  timestamp: "Zeitstempel",
  monetary: "Kosten",
};

// Domain translations
export const DOMAIN_LABELS: Record<string, string> = {
  sensor: "Sensoren",
  binary_sensor: "Binärsensoren",
  switch: "Schalter",
  input_boolean: "Eingabe",
  light: "Lichter",
  vacuum: "Staubsauger",
  climate: "Klimaanlage",
  cover: "Rollläden",
  fan: "Ventilatoren",
  media_player: "Mediaplayer",
  camera: "Kameras",
  lock: "Schlösser",
  alarm_control_panel: "Alarmanlagen",
  water_heater: "Warmwasser",
  humidifier: "Luftbefeuchter",
  scene: "Szenen",
  script: "Skripte",
  automation: "Automatisierungen",
  person: "Personen",
  device_tracker: "Gerätetracker",
  weather: "Wetter",
};

// Vacuum status translations
export const VACUUM_STATUS: Record<string, string> = {
  cleaning: "Reinigt",
  docked: "Angedockt",
  paused: "Pausiert",
  idle: "Bereit",
  returning: "Kehrt zurück",
  error: "Fehler",
  charging: "Lädt",
};

// Cover states translations
export const COVER_STATES: Record<string, string> = {
  open: "Offen",
  opening: "Öffnet",
  closed: "Geschlossen",
  closing: "Schließt",
};

// Lock states translations
export const LOCK_STATES: Record<string, string> = {
  locked: "Verriegelt",
  unlocked: "Entriegelt",
  locking: "Verriegelt...",
  unlocking: "Entriegelt...",
  jammed: "Klemmt",
};

// Alarm states translations
export const ALARM_STATES: Record<string, string> = {
  disarmed: "Deaktiviert",
  armed_home: "Zuhause",
  armed_away: "Abwesend",
  armed_night: "Nacht",
  armed_vacation: "Urlaub",
  armed_custom_bypass: "Benutzerdefiniert",
  pending: "Ausstehend",
  arming: "Aktiviert...",
  disarming: "Deaktiviert...",
  triggered: "Ausgelöst",
};

// Media player states translations
export const MEDIA_PLAYER_STATES: Record<string, string> = {
  playing: "Spielt",
  paused: "Pausiert",
  idle: "Bereit",
  off: "Aus",
  standby: "Standby",
  buffering: "Puffert",
};

// Weather condition translations
export const WEATHER_CONDITIONS: Record<string, string> = {
  "clear-night": "Klare Nacht",
  cloudy: "Bewölkt",
  fog: "Nebel",
  hail: "Hagel",
  lightning: "Gewitter",
  "lightning-rainy": "Gewitter mit Regen",
  partlycloudy: "Teilweise bewölkt",
  pouring: "Starkregen",
  rainy: "Regen",
  snowy: "Schnee",
  "snowy-rainy": "Schneeregen",
  sunny: "Sonnig",
  windy: "Windig",
  "windy-variant": "Windig",
  exceptional: "Außergewöhnlich",
};

// Camera configuration
export type CameraStreamType = "webrtc" | "rtsp" | "mjpeg";

export interface CameraConfig {
  id: string;
  name: string;
  stream_type: CameraStreamType;
  stream_url: string;          // RTSP/MJPEG URL or WebRTC signaling URL
  snapshot_url?: string;       // Optional snapshot URL for thumbnail
  // Authentication (for cameras requiring digest/basic auth)
  auth?: {
    username: string;
    password: string;
    type: "basic" | "digest";
  };
  webrtc_config?: {
    stun_server?: string;      // STUN server URL
    turn_server?: string;      // TURN server URL
    turn_username?: string;
    turn_password?: string;
  };
  enabled: boolean;
  position: number;
  created_at: string;
}

export interface CameraSettings {
  cameras: CameraConfig[];
}

// Energy flow colors
export const ENERGY_COLORS = {
  solar: "#FFA500",
  solarLight: "#FFD700",
  batteryCharge: "#4CAF50",
  batteryDischarge: "#2196F3",
  gridImport: "#F44336",
  gridExport: "#22c55e",
  home: "#3b82f6", // Blue for better visibility
};

// Helper to get card type from domain
export function getCardTypeFromDomain(domain: string): CardType {
  const domainToCardType: Record<string, CardType> = {
    sensor: "sensor",
    binary_sensor: "binary_sensor",
    switch: "switch",
    input_boolean: "input_boolean",
    light: "light",
    vacuum: "vacuum",
    climate: "climate",
    cover: "cover",
    fan: "fan",
    media_player: "media_player",
    camera: "camera",
    lock: "lock",
    alarm_control_panel: "alarm_control_panel",
    water_heater: "water_heater",
    humidifier: "humidifier",
    scene: "scene",
    script: "script",
    automation: "automation",
    person: "person",
    device_tracker: "device_tracker",
    weather: "weather",
  };
  return domainToCardType[domain] || "generic";
}
