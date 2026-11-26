/**
 * The three install keys a family can set in Settings (RFC-023 §4.4): the
 * OpenWeatherMap API key, the Google OAuth client and the presence sensor's
 * token. Until 1.18 they came only from the server's environment
 * (`webapp/docker/.env`); now a family's own value comes first and the
 * environment is the fallback, so an install with keys in `.env` sees no
 * change.
 *
 * This file is the part the browser may import: names, shapes and the pure
 * precedence rule. Reading and writing the stored values is lib/api-keys.ts,
 * server only.
 */

export const API_KEY_NAMES = ["openweathermap", "google_oauth_client", "presence_sensor"] as const;
export type ApiKeyName = (typeof API_KEY_NAMES)[number];

export function isApiKeyName(value: unknown): value is ApiKeyName {
  return typeof value === "string" && (API_KEY_NAMES as readonly string[]).includes(value);
}

/**
 * The fields each key is stored as, in its `integration_secrets` row (whose
 * `key` column is the name above). The Google client is two values that only
 * work together, so it is one row with both, never one from the family and
 * the other from the environment.
 */
export const API_KEY_FIELDS = {
  openweathermap: ["api_key"],
  google_oauth_client: ["client_id", "client_secret"],
  presence_sensor: ["token"],
} as const satisfies Record<ApiKeyName, readonly string[]>;

/** The environment variables that were the only source before, in the same order as the fields. */
export const API_KEY_ENV = {
  openweathermap: ["OPENWEATHERMAP_API_KEY"],
  google_oauth_client: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  presence_sensor: ["PRESENCE_SENSOR_TOKEN"],
} as const satisfies Record<ApiKeyName, readonly string[]>;

/** Where the value in force comes from. */
export type ApiKeySource = "family" | "environment" | "none";

export interface ApiKeyStatus {
  source: ApiKeySource;
  /** The family's own value, shortened to its last four characters ("…a1b2"); null otherwise. */
  hint: string | null;
  /** Whether the server's environment has a value, i.e. what removing the family's own falls back to. */
  environment: boolean;
}

export type ApiKeysStatus = Record<ApiKeyName, ApiKeyStatus>;

/** What the browser is shown of a stored value: never the value, only enough to recognise it. */
export function maskHint(value: string): string {
  // A short value would be mostly given away by its last four characters.
  if (value.length < 12) return "…";
  return `…${value.slice(-4)}`;
}

/** A value fit to store: printable ASCII without spaces, as every one of these keys is. */
export const API_KEY_VALUE = /^[\x21-\x7e]{1,512}$/;

/** The presence token is a password the sensor presents, so it must not be guessable. */
export const PRESENCE_TOKEN_MIN_LENGTH = 16;

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The precedence rule, pure: the family's stored value when every field of it
 * is there, else the environment's when every variable is set, else nothing.
 * Never a mix of the two, which for the Google client would pair one
 * project's id with another's secret.
 */
export function pickCredential(
  name: ApiKeyName,
  stored: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined>,
): { source: ApiKeySource; values: string[] | null } {
  const fields = API_KEY_FIELDS[name];
  const own = fields.map((f) => stored?.[f]);
  // Returned as they are, not trimmed: the environment's values are used
  // exactly as before, and a stored one was refused if it had a space in it.
  if (own.every(present)) return { source: "family", values: own as string[] };
  const fromEnv = API_KEY_ENV[name].map((k) => env[k]);
  if (fromEnv.every(present)) return { source: "environment", values: fromEnv as string[] };
  return { source: "none", values: null };
}

/** The status the browser is shown for one key. */
export function statusOf(
  name: ApiKeyName,
  stored: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined>,
): ApiKeyStatus {
  const picked = pickCredential(name, stored, env);
  const environment = pickCredential(name, null, env).source === "environment";
  // The hint is of the last field: the secret, for the Google client.
  const hint = picked.source === "family" && picked.values ? maskHint(picked.values[picked.values.length - 1]) : null;
  return { source: picked.source, hint, environment };
}
