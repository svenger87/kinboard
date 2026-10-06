/**
 * A child's creature, outside pocket money (RFC-017): what a write to it may
 * carry, and who may make it.
 *
 * Two kinds of field, as on the pocket-money account before:
 *
 *   PARENTAL  enabled, species, grows_with, shop_enabled -- the settings PIN
 *   KID-SIDE  style, look, best_tier, last_seen_tier -- the child's own
 *             screen: the look is theirs (RFC-016 §4), and the stage is
 *             recorded on every visit, so these never need the PIN
 *
 * Pure: the routes in src/app/api/creatures use it, and so do the specs.
 */

import avatarCatalog from "@/plugins/pocket-money/catalog/avatars.json";
import { hasClassicArt } from "@/lib/pocket-money/creatures/catalog";
import { isAvatarStyle, type AvatarStyle } from "@/lib/pocket-money/creatures/styles";
import { validateLook, type CreatureLook } from "@/lib/pocket-money/creatures/look";

/** What a creature grows with: task points (the default), or the money saved. */
export type GrowsWith = "points" | "money";

export const GROWS_WITH: ReadonlyArray<GrowsWith> = ["points", "money"];

export function isGrowsWith(value: unknown): value is GrowsWith {
  return value === "points" || value === "money";
}

const SPECIES: ReadonlySet<string> = new Set(avatarCatalog.species.map((s) => s.id));

export function isSpecies(value: unknown): value is string {
  return typeof value === "string" && SPECIES.has(value);
}

/**
 * The style a new creature starts in: one that exists only drawn starts in
 * Gumdrop, moving -- on Classic it would stand still. The dragon and the cat
 * start on Classic, as they always have.
 */
export function startingStyle(species: string): AvatarStyle {
  return hasClassicArt(species) ? "classic" : "gumdrop";
}

/** Fields that need the settings PIN. */
export const PARENTAL_FIELDS = ["enabled", "species", "grows_with", "shop_enabled"] as const;
/** Fields the child's own screen writes, with no PIN. */
export const KID_FIELDS = ["style", "look", "best_tier", "last_seen_tier"] as const;

export interface CreaturePatch {
  enabled?: boolean;
  species?: string;
  grows_with?: GrowsWith;
  shop_enabled?: boolean;
  style?: AvatarStyle;
  look?: CreatureLook;
  best_tier?: number;
  last_seen_tier?: number;
}

export type PatchResult =
  | { ok: true; patch: CreaturePatch; parental: boolean }
  | { ok: false; error: string };

/** A stage, clamped to 1..8; anything that is not a number is stage 1. */
export function clampTier(value: unknown): number {
  return Math.min(8, Math.max(1, Math.floor(Number(value)) || 1));
}

/**
 * A creature write, checked. Unknown keys are refused rather than ignored, so
 * a field that moved or was misspelt is an error, not a silent no-op.
 * `parental` says whether any field needs the PIN: one parental field in the
 * body puts the whole write behind it, so a look sent with a new species
 * writes neither without the PIN.
 */
export function parseCreaturePatch(body: unknown): PatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const input = body as Record<string, unknown>;
  const known = new Set<string>([...PARENTAL_FIELDS, ...KID_FIELDS, "family_id"]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return { ok: false, error: `unknown field: ${key}` };
  }

  const patch: CreaturePatch = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
    patch.enabled = input.enabled;
  }
  if (input.species !== undefined) {
    if (!isSpecies(input.species)) return { ok: false, error: `unknown species: ${String(input.species)}` };
    patch.species = input.species;
  }
  if (input.grows_with !== undefined) {
    if (!isGrowsWith(input.grows_with)) return { ok: false, error: "grows_with must be points or money" };
    patch.grows_with = input.grows_with;
  }
  if (input.shop_enabled !== undefined) {
    if (typeof input.shop_enabled !== "boolean") return { ok: false, error: "shop_enabled must be true or false" };
    patch.shop_enabled = input.shop_enabled;
  }
  if (input.style !== undefined) {
    if (!isAvatarStyle(input.style)) return { ok: false, error: `unknown style: ${String(input.style)}` };
    patch.style = input.style;
  }
  if (input.look !== undefined) {
    // The editor's fixed sets, exactly as #366 checks them: unknown keys and
    // values outside the sets are refused; the name is cleaned and cut.
    const look = validateLook(input.look);
    if (!look.ok) return { ok: false, error: look.error.replace(/avatar_look/g, "look") };
    patch.look = look.look;
  }
  if (input.best_tier !== undefined) patch.best_tier = clampTier(input.best_tier);
  if (input.last_seen_tier !== undefined) patch.last_seen_tier = clampTier(input.last_seen_tier);

  if (Object.keys(patch).length === 0) return { ok: false, error: "no updatable fields provided" };
  const parental = PARENTAL_FIELDS.some((f) => patch[f] !== undefined);
  return { ok: true, patch, parental };
}

/**
 * Whether "grows with saved money" can be offered for a child: only with the
 * pocket-money plugin on, and only for a child who has an account there
 * (RFC-017 §2.3). Points are always available.
 */
export function moneyAvailable(args: { pocketMoneyOn: boolean; hasAccount: boolean }): boolean {
  return args.pocketMoneyOn && args.hasAccount;
}

/** The plugin is on unless the family's enabled_plugins setting says false. */
export function pluginOn(enabledPlugins: unknown, pluginId: string): boolean {
  if (typeof enabledPlugins !== "object" || enabledPlugins === null) return true;
  return (enabledPlugins as Record<string, unknown>)[pluginId] !== false;
}
