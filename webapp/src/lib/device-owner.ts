/**
 * Who a device belongs to, and where it opens (RFC-017 §8.2).
 *
 * Under Settings -> Devices a parent can say a device belongs to a person.
 * A device that belongs to a child with a creature -- the child's own phone or
 * tablet -- opens on that child's Rewards page instead of the dashboard. A
 * kiosk ignores it: a kiosk is the family's screen, whoever it was set up for.
 *
 * "Opens" is the app's start, not the Home button: the redirect happens when
 * the app is opened on the dashboard (a cold start, the installed app's
 * start_url, a reload), never when someone taps Home inside the app. So the
 * dashboard is always one tap away, and Home keeps meaning the dashboard on
 * every device (lib/app-start.ts decides what counts as the start).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeviceOwnerPatch = { ok: true; personId: string | null } | { ok: false; error: string };

/** The body of PATCH /api/devices/[id]: `{ person_id: <uuid> | null }`, and nothing else. */
export function parseDeviceOwner(body: unknown): DeviceOwnerPatch {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const keys = Object.keys(body);
  const unknown = keys.find((k) => k !== "person_id");
  if (unknown) return { ok: false, error: `unknown field: ${unknown}` };
  if (!keys.includes("person_id")) return { ok: false, error: "person_id required" };
  const value = (body as { person_id: unknown }).person_id;
  if (value === null) return { ok: true, personId: null };
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    return { ok: false, error: "person_id must be a person's id or null" };
  }
  return { ok: true, personId: value.toLowerCase() };
}

export interface DeviceLike {
  is_kiosk?: boolean | null;
  person_id?: string | null;
}

export interface CreatureRowLike {
  person_id: string;
  enabled?: boolean | null;
}

/** The Rewards page of one child, the address the widget and the profile link to as well. */
export function rewardsHref(personId: string): string {
  return `/rewards?child=${encodeURIComponent(personId)}`;
}

/**
 * Where this device opens instead of the dashboard, or null for the
 * dashboard: the Rewards page of the child it belongs to, when that child has
 * a creature switched on and the device is not a kiosk.
 *
 * `creatures` are the family's creature rows as the screen read them (RLS
 * already leaves out a child in the recycle bin); undefined while loading,
 * which answers null -- the caller waits for them rather than guessing.
 */
export function startRouteFor(
  device: DeviceLike | null | undefined,
  creatures: readonly CreatureRowLike[] | undefined,
): string | null {
  if (!device || device.is_kiosk) return null;
  const owner = device.person_id;
  if (!owner || !creatures) return null;
  const creature = creatures.find((c) => c.person_id === owner && c.enabled !== false);
  return creature ? rewardsHref(owner) : null;
}

/**
 * Whether the dashboard should hold back its first paint while the creatures
 * load, because this device may be about to leave for a Rewards page: only a
 * non-kiosk device that belongs to someone. Every other device paints at once.
 */
export function mayStartElsewhere(device: DeviceLike | null | undefined): boolean {
  return Boolean(device && !device.is_kiosk && device.person_id);
}
