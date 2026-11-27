import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { putObject, removeObjects } from "@/lib/files/store";
import { publicStorageUrl } from "@/lib/db/public-url";
import { createAdminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/require-session";
import { safeFetch, BlockedAddressError } from "@/lib/safe-fetch";
import { hitLimit } from "@/lib/rate-limit";
import { isRemoteImage, keepRemoteImage, KeepImageError, KEEP_IMAGE_USER_AGENT, type KeepImageDeps } from "@/lib/recipe-image-keep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What can have a picture from the web, where its kept copy goes, and how
 * large it is kept: a recipe's picture fills the head of its page, the
 * others are shown as tiles.
 */
const KINDS = {
  recipe: { table: "recipes", bucket: "recipe-images", edge: 1600 },
  device: { table: "catalogue_items", bucket: "device-images", edge: 1200 },
  shopping: { table: "shopping_items", bucket: "shopping-images", edge: 600 },
  goal: { table: "pocket_money_goals", bucket: "goal-images", edge: 1200 },
} as const;
type Kind = keyof typeof KINDS;

/**
 * Remote address -> kept copy, per family and bucket, for as long as this
 * process runs. Twenty "Milch" on the list over a year share one catalogue
 * picture: it is fetched and stored once, not twenty times.
 */
const keptAs = new Map<string, string>();

const base: Omit<KeepImageDeps, "store" | "urlFor"> = {
  fetchRemote: (url, signal) =>
    safeFetch(url, {
      signal,
      headers: { "User-Agent": KEEP_IMAGE_USER_AGENT, Accept: "image/*" },
    }),
  isBlocked: (error) => error instanceof BlockedAddressError,
  scale: async (data, edge) =>
    new Uint8Array(
      await sharp(data, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
    ),
  stamp: () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
};

/** A source that would not give its picture is not asked again for a while. */
const failedUntil = new Map<string, number>();
const RETRY_AFTER_MS = 6 * 60 * 60_000;
/** One fetch per recipe at a time, however many screens ask. */
const inFlight = new Map<string, Promise<string>>();

/**
 * POST /api/recipes/keep-image  { id, kind?: "recipe" | "device" | "shopping" | "goal" }
 *
 * Brings one picture onto this server: if the recipe (or catalogued device,
 * shopping item, savings goal) of the caller's family still points at a
 * picture somewhere else, fetch it, store it and point the row at the
 * stored copy. Answers { url, kept }.
 *
 * Takes a row, not an address: the address fetched is the one already
 * saved on the family's own row, and what comes back is only ever written
 * to that row. Asked by the pages that show these pictures when they meet
 * such a row, so old ones are brought in the first time they are looked at.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;

  const body = (await request.json().catch(() => null)) as { id?: unknown; kind?: unknown } | null;
  const recipeId = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(recipeId)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const kind: Kind = body?.kind === undefined ? "recipe" : (body.kind as Kind);
  if (!Object.hasOwn(KINDS, kind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
  const { table, bucket, edge } = KINDS[kind];
  const deps: KeepImageDeps = {
    ...base,
    store: (key, data) => putObject(bucket, key, data),
    urlFor: (key) => publicStorageUrl(bucket, key),
  };

  // Each one is a download and an image decode.
  if (hitLimit(`keep-image:${familyId}`, 120, 60_000).limited) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const db = createAdminClient() as any;
  // The caller's own row. A savings goal has no family of its own: it hangs
  // on an account, and the account is the family's.
  const mine = (query: any) =>
    kind === "goal" ? query.eq("pocket_money_accounts.family_id", familyId) : query.eq("family_id", familyId);
  const { data: recipe, error } = await mine(
    db
      .from(table)
      .select(kind === "goal" ? "id, image_url, pocket_money_accounts!inner(family_id)" : "id, image_url")
      .eq("id", recipeId),
  ).maybeSingle();
  if (error) return NextResponse.json({ error: "could not read the row" }, { status: 500 });
  if (!recipe) return NextResponse.json({ error: "not found" }, { status: 404 });

  const remote = typeof recipe.image_url === "string" ? recipe.image_url : null;
  if (!isRemoteImage(remote)) return NextResponse.json({ url: remote, kept: false });

  const failed = failedUntil.get(remote);
  if (failed && failed > Date.now()) return NextResponse.json({ url: remote, kept: false, reason: "failed_recently" });

  const flightKey = `${kind}:${recipeId}`;
  let work = inFlight.get(flightKey);
  if (!work) {
    work = (async () => {
      const known = `${bucket}|${familyId}|${remote}`;
      let local = keptAs.get(known);
      if (!local) {
        local = await keepRemoteImage(remote, familyId, deps, edge);
        // Where it came from, written BEFORE any row is pointed at the copy
        // (migration 093): it is what lets a backup carry the original
        // address. If this cannot be written, the row is left as it is and
        // the stored copy removed; the picture loads from the web as before.
        const { error: recordError } = await db
          .from("kept_images")
          .upsert({ family_id: familyId, local_url: local, source_url: remote }, { onConflict: "family_id,local_url" });
        if (recordError) {
          const key = local.slice(local.indexOf(`/${bucket}/`) + bucket.length + 2);
          await removeObjects(bucket, [decodeURI(key)]).catch(() => {});
          throw new KeepImageError("storage", `kept_images: ${recordError.message}`);
        }
        if (keptAs.size > 5000) keptAs.clear();
        keptAs.set(known, local);
      }
      // Only if it still points where it did: an edit meanwhile wins. The
      // row was read as the caller's family's above; its id is the key here.
      const { error: writeError } = await db
        .from(table)
        .update({ image_url: local })
        .eq("id", recipeId)
        .eq("image_url", remote);
      if (writeError) throw new KeepImageError("storage", writeError.message);
      if (kind === "shopping") {
        // The family's own catalogue entry is where the next "Milch" takes
        // its picture from: point it at the kept copy too. Best effort.
        for (const column of ["image_url", "thumbnail_url"]) {
          const { error: catalogError } = await db
            .from("item_catalog")
            .update({ [column]: local })
            .eq("family_id", familyId)
            .eq(column, remote);
          if (catalogError) console.warn(`[recipes/keep-image] item_catalog.${column}: ${catalogError.message}`);
        }
      }
      return local;
    })().finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, work);
  }

  try {
    return NextResponse.json({ url: await work, kept: true });
  } catch (err) {
    const reason = err instanceof KeepImageError ? err.reason : "unreachable";
    // The recipe keeps its picture's address; the browser goes on loading it from there.
    if (failedUntil.size > 2000) failedUntil.clear();
    failedUntil.set(remote, Date.now() + RETRY_AFTER_MS);
    console.warn(`[recipes/keep-image] ${kind} ${recipeId}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ url: remote, kept: false, reason });
  }
}
